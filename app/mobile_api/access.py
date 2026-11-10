"""Mobile API access endpoints for the Live Access feature.

Physical unlock is available only as an owner-confirmed command through the
commissioned connector. Direct ADMS takes priority over a paired legacy bridge,
and the response reports that a command was queued rather than claiming the
door has already opened.
"""
from __future__ import annotations

import logging
from datetime import timezone
from flask import g, jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.extensions import db, limiter
from app.mobile_api.middleware import roles_required, token_required
from app.models.bridge import BridgeCommand, BridgeInstallation
from app.models.member import Member
from app.models.mixins import utcnow
from app.services.access_event_service import (
    get_access_events,
    get_access_summary,
    get_members_inside,
    has_legacy_attendance_events,
    record_manual_access_event,
    _serialize_access_event,
)
from app.services.audit_service import audit
from app.services.bridge_service import (
    OWNER_CANCELLED_ERROR,
    OWNER_CANCELLED_MARKER,
    STALE_ENABLE_ERROR,
    STALE_ENABLE_MARKER,
    bridge_disable_must_be_cancelled_at_lease,
    bridge_enable_must_be_cancelled,
    cancel_adms_command,
    cancel_bridge_command,
    member_is_proven_enableable,
    queue_adms_create_user,
    queue_adms_membership_command,
    queue_gym_reconciliation,
    resolve_adms_command_member,
    resolve_adms_enroll_number,
    resolve_adms_member,
)
from app.services.idempotency_service import (
    begin_idempotency,
    record_idempotency,
    replay_after_conflict,
)

_logger = logging.getLogger(__name__)


# Membership-state actions a failed ADMS row may be retried as. Everything
# else is skipped, never re-driven: test actions never touch a real
# member, unlock_door is a physical door opening that must never be
# re-driven from a stale row (V9-L14), and the sync/enrollment-admin
# actions are not membership-state commands. V10-L9 adds create_user:
# a failed enrollment re-drives only for a member who is currently
# proven enableable (else the "not_enableable" skip). V11-L10 adds
# sync_users: a failed terminal-user scan re-drives as a fresh scan row
# (no member involved — see the special case in
# _requeue_one_failed_adms_row).
_ADMS_RETRYABLE_ACTIONS = frozenset({"block", "unblock", "create_user", "sync_users"})
# V10-L12: retry-sync processes at most this many failed rows per call
# and reports the remainder, so a large failed backlog cannot turn one
# request into an unbounded, all-or-nothing batch.
_ADMS_RETRY_BATCH_LIMIT = 50
_ADMS_RETRY_SKIP_TEST_ACTIONS = frozenset({
    "probe_info",
    "block_test",
    "unblock_test",
    "essl_group_block_test",
    "essl_group_unblock_test",
    "delete_biodata_test",
    "delete_fingertmp_test",
})


def _supersede_failed_adms_row(row, new_command_id):
    """Mark a retried failed row as superseded by the fresh command.

    The row keeps its original terminal reason where it fits: the retry
    note is appended to ``result_message`` when the 500-char column
    allows it, otherwise the note replaces it. The row is never deleted
    and never re-served — getrequest only serves queued/delivered.
    """
    note = f"Superseded by retry as command {new_command_id}."
    original = row.result_message or ""
    if original and len(original) + len("; " + note) <= 500:
        row.result_message = original + "; " + note
    else:
        row.result_message = note[:500]
    row.result_code = "superseded_by_retry"
    row.status = "cancelled"


def _adms_requeue_failure_reason(member):
    """Split a queue refusal into its cause (V10-L8).

    ``"no_terminal_identity"`` when the member has no enroll number —
    the common case, since commands-disabled / terminal-never-polled
    are pre-filtered before the loop — versus ``"requeue_failed"`` for
    anything else. The PWA renders the ``no_terminal_identity`` label
    (same string) in the retry-reasons breakdown.
    """
    try:
        enroll = resolve_adms_enroll_number(member)
    except ValueError:
        enroll = None
    return "no_terminal_identity" if not enroll else "requeue_failed"


def _requeue_one_failed_adms_row(adms, row):
    """Re-derive a single failed ADMS row from current membership state.

    Returns ``(outcome, new_command, reason, resolution)`` where
    outcome is "queued" (a fresh command was created by this call),
    "already" (the desired state was already queued/delivered/acked —
    no fresh row), or "skipped" (``new_command`` is None and
    ``reason`` names why). ``resolution`` is "current_holder" when
    the member came from the live holder of the row's enroll number,
    "intended_member" when it fell back to the stamped intended
    member, else None (V10-L10). Raises on an unexpected failure so
    the caller can turn one bad row into a "requeue_failed" skip
    (V10-L12) instead of a 500 for the whole batch.
    """
    from app.models.rrr import RRRAdmsCommand

    # V11-L10: a failed terminal-user scan re-drives as a fresh sync_users
    # row — it has no member, so it cannot go through the membership
    # re-derivation below. Queued/delivered scans are returned as-is by
    # the dedupe (never stacked); only a failed scan mints a fresh row.
    if row.action == "sync_users":
        # V12-A4: a USERINFO_TOO_LARGE failure is deterministic — the
        # terminal re-uploads the same oversized snapshot on every
        # retry, so re-driving it can never succeed. Skip it with a
        # distinct reason instead of looping forever. Chunked snapshot
        # upload is out of scope (not built); the failure itself
        # already surfaces distinctly in the failed-commands data via
        # result_code (GET .../adms/commands returns result_code per
        # row), so the PWA crew can render it.
        from app.adms.routes import USERINFO_TOO_LARGE_CODE

        if row.result_code == USERINFO_TOO_LARGE_CODE:
            return "skipped", None, "userinfo_too_large", None
        if not adms.commands_enabled or adms.last_success_at is None:
            return "skipped", None, "requeue_failed", None
        max_id_before = db.session.query(db.func.max(RRRAdmsCommand.id)).scalar() or 0
        existing = (
            RRRAdmsCommand.query.filter_by(
                integration_id=adms.id, action="sync_users"
            )
            .filter(RRRAdmsCommand.status.in_(("queued", "delivered")))
            .order_by(RRRAdmsCommand.id.desc())
            .first()
        )
        if existing is not None:
            return "already", existing, None, None
        from app.services.bridge_service import adms_command_text

        new_command = RRRAdmsCommand(
            gym_id=adms.gym_id,
            integration_id=adms.id,
            action="sync_users",
            command_text=adms_command_text("sync_users", None),
            requested_by_id=None,
        )
        db.session.add(new_command)
        db.session.flush()
        audit(
            action="adms_membership_sync_users_queued",
            resource_type="rrr_adms_command",
            resource_id=new_command.id,
            gym_id=adms.gym_id,
            metadata={"retried_from_command_id": row.id},
        )
        outcome = "queued" if new_command.id > max_id_before else "already"
        return outcome, new_command, None, None

    if row.action not in _ADMS_RETRYABLE_ACTIONS:
        if row.action == "unlock_door":
            reason = "unlock_door"
        elif row.action in _ADMS_RETRY_SKIP_TEST_ACTIONS:
            reason = "test_action"
        else:
            reason = "unsupported_action"
        return "skipped", None, reason, None

    # V12-A2: a failed OWNER (manual) row is never re-derived from
    # membership state. Re-derivation maps an active member to an
    # unblock, so a failed manual misconduct block would come back as
    # a fresh unblock and be reported as a successful retry — the
    # block could never be re-driven through Retry All. The owner
    # re-queues via the member-page toggle; Retry All only reports
    # the row as skipped ("manual_action"). Placed after the
    # sync_users / test-action branches above: sync scans carry no
    # actor and test rows keep their own skip reason. create_user
    # rows are also safe here — they are queued with
    # requested_by_id=None, so only manual block/unblock rows match.
    if row.requested_by_id is not None:
        return "skipped", None, "manual_action", None

    # V10-L10: resolve the CURRENT holder of the terminal identity
    # first — the enroll may have been recycled since the failure, and
    # re-deriving from the stale intended member would stamp the wrong
    # member's intent on the fresh row. The stamped intended member is
    # only the fallback (the deleted-member case, which then stays
    # skipped as unresolvable).
    member = resolve_adms_member(adms.gym_id, row.test_enroll_number)
    if member is not None:
        resolution = "current_holder"
    else:
        member = resolve_adms_command_member(row)
        resolution = "intended_member" if member is not None else None
    if member is None:
        return "skipped", None, "unresolvable_member", None

    # V10-L9: a failed enrollment re-drives only for a member who is
    # currently proven enableable; anything else is a "not_enableable"
    # skip, never a blind re-enroll. The serve-time create_user
    # re-check (V7-L8) judges the re-queued creation a second time.
    if row.action == "create_user":
        if not member_is_proven_enableable(member):
            return "skipped", None, "not_enableable", resolution
        max_id_before = db.session.query(db.func.max(RRRAdmsCommand.id)).scalar() or 0
        new_command = queue_adms_create_user(member)
        if new_command is None:
            return "skipped", None, _adms_requeue_failure_reason(member), resolution
        outcome = "queued" if new_command.id > max_id_before else "already"
        return outcome, new_command, None, resolution

    max_id_before = db.session.query(db.func.max(RRRAdmsCommand.id)).scalar() or 0
    new_command = queue_adms_membership_command(member)
    if new_command is None:
        return "skipped", None, _adms_requeue_failure_reason(member), resolution
    # V10-L8: only a row freshly created by this call counts as
    # "queued" — a deduped queued/delivered/acked row means the desired
    # state was already in flight or achieved.
    outcome = "queued" if new_command.id > max_id_before else "already"
    return outcome, new_command, None, resolution


def _retry_failed_adms_commands(adms):
    """Retry this gym's failed Direct ADMS commands from current state.

    Each failed ``block``/``unblock``/``create_user``/``sync_users`` row is resolved
    back to its member (current holder of the terminal identity first,
    else the stamped intended member — V10-L10) and the action is
    RE-DERIVED from that member's current membership state via
    :func:`queue_adms_membership_command` / :func:`queue_adms_create_user`
    — the failed row's own action is never replayed. A failed block for
    a member who has since renewed therefore becomes a fresh unblock,
    and a failed unblock for a now-expired member becomes a fresh
    block, which the serve-time fail-safe guard still judges before it
    can reach the terminal (an active member is never blocked). The old
    failed row is stamped ``cancelled`` / ``superseded_by_retry``.

    Rows that cannot be safely re-derived are left ``failed`` and
    reported in ``skipped``: test actions, ``unlock_door``, other
    non-membership actions, owner (manual) rows (V12-A2 — the owner
    re-queues via the member-page toggle), unresolvable members,
    not-enableable enrollments, members with no terminal identity, and
    rows the queue refuses (commands disabled / terminal never polled). At most
    ``_ADMS_RETRY_BATCH_LIMIT`` rows are processed per call (V10-L12);
    the remainder is reported so the owner can tap Retry All again.
    Each row runs inside its own savepoint, so one bad row becomes a
    "requeue_failed" skip instead of a 500 for the whole batch.

    V10-M1: the audit is staged BEFORE the single commit below, so
    the retry audit row is persisted with the supersedes — never
    after the commit, where teardown would roll it back.
    """
    from app.models.rrr import RRRAdmsCommand

    total_failed = RRRAdmsCommand.query.filter_by(
        integration_id=adms.id, status="failed"
    ).count()
    failed_rows = (
        RRRAdmsCommand.query.filter_by(integration_id=adms.id, status="failed")
        .order_by(RRRAdmsCommand.id)
        .limit(_ADMS_RETRY_BATCH_LIMIT)
        .all()
    )
    remaining_failed_count = max(0, total_failed - len(failed_rows))

    retried_count = 0
    already_count = 0
    retried_ids = []  # V10-L8: ids of the FRESH commands queued by this call
    already_ids = []  # ids of pre-existing rows already in the desired state
    superseded_ids = []  # V10-L8: failed row ids this call superseded
    skipped = []
    member_resolution = {}  # V10-L10: failed row id -> resolution that won
    if not adms.commands_enabled:
        skipped = [
            {"command_id": row.id, "reason": "commands_disabled"}
            for row in failed_rows
        ]
    elif adms.last_success_at is None:
        skipped = [
            {"command_id": row.id, "reason": "terminal_never_polled"}
            for row in failed_rows
        ]
    else:
        for row in failed_rows:
            try:
                with db.session.begin_nested():
                    outcome, new_command, reason, resolution = (
                        _requeue_one_failed_adms_row(adms, row)
                    )
                    if outcome in ("queued", "already"):
                        _supersede_failed_adms_row(row, new_command.id)
            except Exception:
                _logger.warning(
                    "ADMS retry failed for command %s", row.id, exc_info=True
                )
                skipped.append({"command_id": row.id, "reason": "requeue_failed"})
                continue
            if outcome == "skipped":
                skipped.append({"command_id": row.id, "reason": reason})
                continue
            if resolution is not None:
                member_resolution[str(row.id)] = resolution
            superseded_ids.append(row.id)
            if outcome == "queued":
                retried_count += 1
                retried_ids.append(new_command.id)
            else:
                already_count += 1
                already_ids.append(new_command.id)

    audit(
        action="retry_failed_adms_syncs",
        resource_type="rrr_integration",
        resource_id=adms.id,
        gym_id=g.gym_id,
        actor_id=g.current_user.id,
        metadata={
            "retried_count": retried_count,
            "already_in_desired_state_count": already_count,
            "skipped_count": len(skipped),
            "retried_command_ids": retried_ids,
            "already_in_desired_state_ids": already_ids,
            "superseded_command_ids": superseded_ids,
            "member_resolution": member_resolution,
            "remaining_failed_count": remaining_failed_count,
            "skipped": skipped,
        },
    )
    db.session.commit()
    parts = []
    if retried_count:
        parts.append(f"Queued {retried_count} failed command(s) for retry")
    if already_count:
        parts.append(f"{already_count} already in the desired state")
    if skipped:
        parts.append(f"{len(skipped)} could not be retried")
    if remaining_failed_count:
        parts.append(
            f"{remaining_failed_count} still failed (retry again for the next batch)"
        )
    message = "; ".join(parts) + "." if parts else "No failed commands to retry."
    return jsonify({
        "success": True,
        "data": {
            "retried_count": retried_count,
            "already_in_desired_state_count": already_count,
            "skipped_count": len(skipped),
            "skipped": skipped,
            "remaining_failed_count": remaining_failed_count,
            "message": message,
        },
    })


def register_access_routes(bp):
    @bp.route("/access/summary", methods=["GET"])
    @bp.route("/access/status", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def access_summary():
        """Live Access summary: inside count, entries/exits/denied today, device & bridge status."""
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        summary = get_access_summary(g.gym_id, gym_timezone)
        # Telemetry and hardware health
        bridge = BridgeInstallation.query.filter_by(gym_id=g.gym_id).first()
        if bridge:
            now = utcnow()
            hb = bridge.last_heartbeat_at
            if hb and hb.tzinfo is None:
                hb = hb.replace(tzinfo=timezone.utc)
            hb_age = (now - hb).total_seconds() if hb else None
            is_online = hb_age is not None and hb_age <= 120 and bridge.is_active

            pending_count = BridgeCommand.query.filter_by(bridge_id=bridge.id, status="pending").count()
            failed_count = BridgeCommand.query.filter_by(bridge_id=bridge.id, status="failed").count()

            summary["remote_unlock_available"] = is_online
            summary["remote_unlock_reason"] = None if is_online else "Bridge PC is currently offline."
            summary["bridge_provisioned"] = True
            summary["bridge_online"] = is_online
            summary["device_online"] = is_online
            summary["device_serial"] = bridge.device_serial
            summary["installed_version"] = bridge.installed_version
            summary["pending_commands"] = pending_count
            summary["failed_commands"] = failed_count
            summary["heartbeat_age_seconds"] = int(hb_age) if hb_age is not None else None
        else:
            summary["remote_unlock_available"] = False
            # Don't show "No biometric bridge paired" when Direct Cloud is active
            if summary.get("adms_integration_id"):
                summary["remote_unlock_reason"] = "Remote unlock needs the bridge PC. Direct Cloud terminal is connected for attendance."
            else:
                summary["remote_unlock_reason"] = "No biometric bridge paired."
            summary["bridge_provisioned"] = False
            summary["bridge_online"] = False
            summary["device_online"] = False
            summary["pending_commands"] = 0
            summary["failed_commands"] = 0
            summary["heartbeat_age_seconds"] = None

        # Include direct ADMS integration status for the sync button.
        from app.models.rrr import RRRIntegration
        adms = RRRIntegration.query.filter_by(
            gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if adms:
            from app.models.rrr import RRRAdmsCommand
            from app.services.access_event_service import adms_device_status

            summary["adms_integration_id"] = adms.id
            # A prior successful connection is not proof that the terminal
            # can receive commands now. Use the same five-minute authenticated
            # poll check as Direct Cloud commissioning (shared helper, also
            # used by get_access_summary for the dashboard — V3-M12).
            adms_status = adms_device_status(g.gym_id) or {}
            summary["adms_online"] = adms_status.get("adms_online", False)
            summary["adms_last_seen_at"] = adms_status.get("adms_last_seen_at")
            summary["adms_commands_enabled"] = bool(adms.commands_enabled)
            summary["adms_device_name"] = adms_status.get("adms_device_name")
            # Direct ADMS is authoritative when configured, even if a legacy
            # bridge is still paired. Never advertise or operate its TCP path.
            summary["remote_unlock_available"] = bool(
                summary["adms_online"] and adms.commands_enabled
            )
            summary["remote_unlock_path"] = "adms"
            summary["remote_unlock_reason"] = (
                None if summary["remote_unlock_available"]
                else "Complete supervised Direct ADMS setup and reconnect the terminal before remote unlock."
            )
            # V4-L11: only let ADMS override the bridge's device state
            # when the terminal is actually online. A disconnected ADMS
            # integration used to force device_online=False (and its
            # name) over a live bridge. When ADMS is offline, the bridge
            # heartbeat set above stands.
            if summary["adms_online"]:
                summary["device_online"] = True
                summary["device_name"] = summary["adms_device_name"]
                summary["device_serial"] = adms.device_serial
            # Hide stale legacy bridge queues from the ADMS-only access UI.
            summary["pending_commands"] = RRRAdmsCommand.query.filter(
                RRRAdmsCommand.integration_id == adms.id,
                RRRAdmsCommand.status.in_(["queued", "delivered"]),
            ).count()
            # V9-L24: count the real failed ADMS commands for this
            # integration — the hardcoded 0 hid failed Direct Cloud
            # commands from the owner (no banner, no count). Retry /
            # Clear still 409 for ADMS gyms; failed blocks auto-retry
            # on the scheduler.
            summary["failed_commands"] = RRRAdmsCommand.query.filter(
                RRRAdmsCommand.integration_id == adms.id,
                RRRAdmsCommand.status == "failed",
            ).count()
            # V10-L33: queued ADMS commands for the Live Access screen —
            # the stuck-queued wedge (V9-L14) has an owner Cancel
            # endpoint but no operator surface. Latest ~20 queued rows,
            # newest first; count is the full queued total.
            queued_rows = (
                RRRAdmsCommand.query.filter_by(
                    integration_id=adms.id, status="queued"
                )
                .order_by(RRRAdmsCommand.id.desc())
                .limit(20)
                .all()
            )
            summary["queued_adms_commands"] = {
                "count": RRRAdmsCommand.query.filter_by(
                    integration_id=adms.id, status="queued"
                ).count(),
                "commands": [
                    {
                        "id": row.id,
                        "action": row.action,
                        "enroll_number": row.test_enroll_number,
                        "queued_at": row.created_at.isoformat() if row.created_at else None,
                    }
                    for row in queued_rows
                ],
            }
        else:
            summary["adms_integration_id"] = None
            summary["adms_online"] = False
            summary["adms_last_seen_at"] = None
            summary["adms_commands_enabled"] = False
            summary["adms_device_name"] = None
            summary["queued_adms_commands"] = {"count": 0, "commands": []}

        # The top status card should show live if EITHER the bridge or the
        # direct ADMS terminal is online. Prefer the ADMS device name when
        # only ADMS is connected.
        if summary.get("adms_online") and not summary.get("device_online"):
            summary["device_online"] = True
            summary["device_name"] = summary.get("adms_device_name")
            summary["device_serial"] = adms.device_serial if adms else None

        resp = jsonify({"success": True, "data": summary})
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/access/events", methods=["GET"])
    @bp.route("/access/log", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def access_events():
        """Paginated access event feed with filters."""
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        page = request.args.get("page", 1, type=int)
        per_page = min(
            request.args.get("per_page", request.args.get("page_size", 25, type=int), type=int),
            100,
        )
        event_type = request.args.get("type", None)
        search = request.args.get("search", None)
        date_filter = request.args.get("date", "today")

        if event_type and event_type not in ("entry", "exit", "denied"):
            event_type = None

        try:
            result = get_access_events(
                g.gym_id,
                gym_timezone,
                page=page,
                per_page=per_page,
                event_type=event_type,
                search=search,
                date_filter=date_filter,
            )
        except ValueError as exc:
            # V3-L12: unknown date_filter values are a 400, not an
            # all-time feed.
            from app.mobile_api.errors import error_response

            # V9-L3: the service message echoes the caller-supplied
            # value — return one fixed message, log the detail.
            _logger.warning("Invalid date_filter on access feed: %s", exc)
            return error_response("VALIDATION_ERROR", "Invalid date filter.", 400)
        result["log"] = result.get("events", [])
        resp = jsonify({"success": True, "data": result})
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/access/inside", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def access_inside():
        """Paginated list of members currently inside the gym."""
        page = request.args.get("page", 1, type=int)
        per_page = min(
            request.args.get("per_page", request.args.get("page_size", 50, type=int), type=int),
            100,
        )
        search = request.args.get("search", None)

        result = get_members_inside(
            g.gym_id,
            page=page,
            per_page=per_page,
            search=search,
        )
        resp = jsonify({"success": True, "data": result})
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/access/checkin", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @limiter.limit("10 per minute")
    def access_checkin():
        """Record manual member check-in or check-out directly from the app."""
        data = request.get_json(silent=True) or {}
        member_id = data.get("member_id")
        # V9-L26: validate input types before use — a non-string type
        # 500d on .upper(), and a non-integer member_id 500d on
        # Postgres (invalid input syntax for integer) in filter_by.
        # Malformed client input is a 400, not a 500.
        raw_type = data.get("type") or data.get("event_type") or "ENTRY"
        if not isinstance(raw_type, str):
            return jsonify({"success": False, "error": {"message": "type must be a string"}}), 400
        event_type = raw_type.upper()
        if isinstance(member_id, bool) or not isinstance(member_id, int):
            return jsonify({"success": False, "error": {"message": "member_id must be an integer"}}), 400
        if not member_id:
            return jsonify({"success": False, "error": {"message": "member_id is required"}}), 400

        member = Member.query.filter_by(id=member_id, gym_id=g.gym_id).filter(Member.deleted_at.is_(None)).first()
        if not member:
            return jsonify({"success": False, "error": {"message": "Member not found"}}), 404

        # A retry after a successful check-in must replay the stored
        # event instead of recording a second ENTRY (which would flip
        # the member's inside/outside state and double-count
        # attendance). NOTE: record_manual_access_event commits
        # internally, so the key record below is a second commit —
        # sequential-retry protection, not concurrent.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="access_checkin",
            headers=request.headers,
            payload=data,
        )
        if replay is not None:
            return replay

        actor_name = g.current_user.full_name if hasattr(g, "current_user") and g.current_user else "Front Desk"
        evt = record_manual_access_event(
            gym_id=g.gym_id,
            member_id=member.id,
            event_type=event_type,
            actor_name=actor_name,
        )
        is_entry = evt.event_type in ("ENTRY", "ATTENDANCE")
        msg = f"{member.full_name} checked in successfully" if is_entry else (f"Access denied: {member.full_name} membership is expired" if evt.event_type == "ACCESS_DENIED" else f"{member.full_name} checked out")
        response_body = {
            "success": True,
            "data": _serialize_access_event(evt),
            "message": msg,
        }
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="access_checkin",
            key=idempotency_key,
            request_hash=request_hash,
            status_code=200,
            response_body=response_body,
        )
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            replayed = replay_after_conflict(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="access_checkin",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)

    @bp.route("/access/remote-unlock", methods=["POST"])
    @bp.route("/access/unlock", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    @limiter.limit("10 per minute")
    def remote_unlock():
        """Queue an explicitly confirmed unlock through the gym's active connector.

        Direct ADMS always takes priority over a paired bridge. The owner
        must confirm the physical action; success means the command was
        queued, not that the terminal has acknowledged it yet.

        V11-L3: honours Idempotency-Key (scope ``remote_unlock``,
        fingerprinted on confirm + delay) so a lost-response retry
        replays instead of firing the door a second time, and the
        pending-command guard runs under a row lock on the
        integration/bridge so two concurrent submits cannot both pass
        it before either commits.
        """
        data = request.get_json(silent=True) or {}
        # Idempotency first: only success responses are recorded, so a
        # validation/conflict failure never consumes the key and a
        # corrected retry still works.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="remote_unlock",
            headers=request.headers,
            payload={"confirm": data.get("confirm"), "delay_seconds": data.get("delay_seconds")},
        )
        if replay is not None:
            return replay
        from app.models.rrr import RRRAdmsCommand, RRRIntegration
        integration = RRRIntegration.query.filter_by(
            gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if integration is not None:
            from app.services.bridge_service import adms_command_text
            from app.services.rrr_service import direct_adms_terminal_is_online

            if not integration.commands_enabled:
                return jsonify({"success": False, "error": {
                    "code": "NOT_COMMISSIONED",
                    "message": "Complete supervised Direct ADMS setup before remote unlock.",
                }}), 403
            if not direct_adms_terminal_is_online(integration):
                return jsonify({"success": False, "error": {
                    "code": "DEVICE_OFFLINE",
                    "message": "The Direct ADMS terminal is not polling. No command was queued.",
                }}), 409
            if data.get("confirm") is not True:
                return jsonify({"success": False, "error": {
                    "code": "CONFIRMATION_REQUIRED",
                    "message": "Confirm the door unlock by sending confirm=true.",
                }}), 422
            try:
                delay_seconds = max(1, min(30, int(data.get("delay_seconds") or 5)))
            except (TypeError, ValueError):
                delay_seconds = 5
            # V11-L3: hold the integration row lock across the
            # guard + insert so two concurrent unlocks cannot both
            # pass the guard before either commits.
            integration = (
                db.session.execute(
                    select(RRRIntegration).where(RRRIntegration.id == integration.id).with_for_update()
                ).scalar_one()
            )
            existing = RRRAdmsCommand.query.filter(
                RRRAdmsCommand.integration_id == integration.id,
                RRRAdmsCommand.status.in_(["queued", "delivered"]),
            ).first()
            if existing is not None:
                return jsonify({"success": False, "error": {
                    "code": "COMMAND_PENDING",
                    "message": "Wait for the current Direct ADMS command acknowledgement before unlocking.",
                }}), 409
            command = RRRAdmsCommand(
                gym_id=g.gym_id,
                integration_id=integration.id,
                action="unlock_door",
                command_text=adms_command_text("unlock_door", None, delay_seconds=delay_seconds),
                requested_by_id=g.current_user.id,
            )
            db.session.add(command)
            db.session.flush()
            reason = str(data.get("reason") or "").strip()[:500] or None
            audit(
                action="remote_door_unlock_dispatched",
                resource_type="rrr_adms_command",
                resource_id=command.id,
                gym_id=g.gym_id,
                actor_id=g.current_user.id,
                metadata={"delay_seconds": delay_seconds, "command_id": command.id,
                          **({"reason": reason} if reason else {})},
            )
            response_body = {"success": True, "data": {
                "command_id": command.id,
                "delay_seconds": delay_seconds,
                "status": command.status,
                "message": "Direct ADMS unlock command queued; waiting for the terminal acknowledgement.",
            }}
            record_idempotency(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="remote_unlock",
                key=idempotency_key,
                request_hash=request_hash,
                status_code=201,
                response_body=response_body,
            )
            db.session.commit()
            return jsonify(response_body), 201

        bridge = BridgeInstallation.query.filter_by(gym_id=g.gym_id, is_active=True).first()
        if not bridge:
            return jsonify({
                "success": False,
                "error": {
                    "code": "BRIDGE_NOT_CONNECTED",
                    "message": "No active biometric bridge found for this gym. Please ensure the Windows connector is running.",
                },
            }), 404

        if data.get("confirm") is not True:
            return jsonify({"success": False, "error": {
                "code": "CONFIRMATION_REQUIRED",
                "message": "Confirm the door unlock by sending confirm=true.",
            }}), 422
        heartbeat = bridge.last_heartbeat_at
        if heartbeat and heartbeat.tzinfo is None:
            heartbeat = heartbeat.replace(tzinfo=timezone.utc)
        if heartbeat is None or (utcnow() - heartbeat).total_seconds() > 120:
            return jsonify({"success": False, "error": {
                "code": "DEVICE_OFFLINE",
                "message": "The bridge is offline. No unlock command was queued.",
            }}), 409
        try:
            delay_seconds = max(1, min(30, int(data.get("delay_seconds") or 5)))
        except (TypeError, ValueError):
            delay_seconds = 5
        reason = str(data.get("reason") or "").strip()[:500] or None
        # V11-L3: hold the bridge row lock across the guard + insert
        # (same race as the ADMS branch).
        bridge = (
            db.session.execute(
                select(BridgeInstallation).where(BridgeInstallation.id == bridge.id).with_for_update()
            ).scalar_one()
        )
        # V10-L1: mirror the ADMS branch's pending-command guard — a
        # double-tap (or a retried request after a slow response) must
        # not queue two unlock_door bridge commands.
        existing_unlock = BridgeCommand.query.filter(
            BridgeCommand.bridge_id == bridge.id,
            BridgeCommand.command_type == "unlock_door",
            BridgeCommand.status.in_(["pending", "leased"]),
        ).first()
        if existing_unlock is not None:
            return jsonify({"success": False, "error": {
                "code": "COMMAND_PENDING",
                "message": "Wait for the current bridge unlock command acknowledgement before unlocking.",
            }}), 409

        cmd = BridgeCommand(
            bridge_id=bridge.id,
            gym_id=g.gym_id,
            command_type="unlock_door",
            enroll_number="SYSTEM",
            delay_seconds=delay_seconds,
        )
        db.session.add(cmd)
        db.session.flush()
        audit(
            action="remote_door_unlock_dispatched",
            resource_type="bridge",
            resource_id=bridge.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"delay_seconds": delay_seconds, "command_id": cmd.id,
                      **({"reason": reason} if reason else {})},
        )
        response_body = {"success": True, "data": {
            "command_id": cmd.id,
            "delay_seconds": delay_seconds,
            "message": f"Door unlock command queued for {delay_seconds} seconds.",
        }}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="remote_unlock",
            key=idempotency_key,
            request_hash=request_hash,
            status_code=201,
            response_body=response_body,
        )
        db.session.commit()

        return jsonify(response_body), 201

    @bp.route("/access/retry-sync", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    @limiter.limit("10 per minute")
    def retry_sync():
        """Retry all failed biometric commands for this gym.

        Owner-only (V10-L11): the ADMS branch re-derives and queues
        door commands. Reconcile (V11-L5) is owner-only for the same
        reason — no door-command-queueing endpoint is open to staff.
        """
        from app.models.rrr import RRRIntegration
        adms = RRRIntegration.query.filter_by(
            gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if adms is not None:
            # Direct ADMS gyms retry from current membership state
            # (failed rows are superseded, never re-served).
            return _retry_failed_adms_commands(adms)
        bridge = BridgeInstallation.query.filter_by(gym_id=g.gym_id, is_active=True).first()
        if not bridge:
            return jsonify({
                "success": True,
                "data": {
                    "retried_count": 0,
                    "message": "No active biometric bridge connected.",
                },
            })

        failed_cmds = BridgeCommand.query.filter_by(bridge_id=bridge.id, status="failed").all()
        retried_count = 0
        for cmd in failed_cmds:
            # Fail-safe: never resurrect a disable unless the member is
            # proven blockable (paused, or expired with a past end date).
            # Stamp the cancellation so the skip is auditable.
            # V8-M5: judge disables with the including-deleted lease
            # guard (the V7-L9 fix on the admin path), not the strict
            # guard — a failed delete-time block for a soft-deleted
            # member must be re-driven, not re-stamped cancelled.
            if bridge_disable_must_be_cancelled_at_lease(cmd):
                cancel_bridge_command(cmd)
                continue
            # H8 mirror: never resurrect a stale enable either.
            if bridge_enable_must_be_cancelled(cmd):
                cancel_bridge_command(cmd, marker=STALE_ENABLE_MARKER, error=STALE_ENABLE_ERROR)
                continue
            cmd.status = "pending"
            cmd.retry_attempt += 1
            cmd.lease_token = None
            cmd.lease_expires_at = None
            cmd.last_error = None
            retried_count += 1

        # V10-M1: audit BEFORE the commit — an audit staged after the
        # final commit is rolled back by teardown and lost in prod.
        audit(
            action="retry_failed_biometric_syncs",
            resource_type="bridge",
            resource_id=bridge.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"retried_count": retried_count},
        )
        db.session.commit()

        return jsonify({
            "success": True,
            "data": {
                "retried_count": retried_count,
                "message": f"Queued {retried_count} failed command(s) for immediate retry.",
            },
        })

    @bp.route("/access/clear-failed", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    @limiter.limit("10 per minute")
    def clear_failed():
        """Permanently delete failed biometric commands for this gym.

        Bridge gyms: deletes failed rows (existing behaviour). Scoped:
        only status='failed', only this gym's bridge. Used when
        migrating a gym off the bridge (e.g. to ADMS direct).
        Irreversible — failed commands are undelivered and cannot be
        retried after.

        ADMS-direct gyms: cancels failed rows instead (status=
        'cancelled', result_code='owner_cleared') — rows are never
        deleted, so the door-command audit history survives and the
        failed count drops to zero.
        """
        from app.models.rrr import RRRAdmsCommand, RRRIntegration
        adms = RRRIntegration.query.filter_by(
            gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if adms is not None:
            failed_rows = RRRAdmsCommand.query.filter_by(
                integration_id=adms.id, status="failed"
            ).all()
            cleared_count = len(failed_rows)
            for row in failed_rows:
                # Cancel, never delete: door-command history is audit
                # history. The row keeps its original terminal reason;
                # only the status/result_code change.
                row.status = "cancelled"
                row.result_code = "owner_cleared"
            # V10-M1: audit BEFORE the commit.
            audit(
                action="clear_failed_adms_commands",
                resource_type="rrr_integration",
                resource_id=adms.id,
                gym_id=g.gym_id,
                actor_id=g.current_user.id,
                metadata={"cleared_count": cleared_count},
            )
            db.session.commit()
            return jsonify({
                "success": True,
                "data": {
                    "cleared_count": cleared_count,
                    "message": f"Cleared {cleared_count} failed command(s).",
                },
            })
        bridge = BridgeInstallation.query.filter_by(gym_id=g.gym_id, is_active=True).first()
        if not bridge:
            return jsonify({
                "success": True,
                "data": {"cleared_count": 0, "message": "No active biometric bridge connected."},
            })

        failed_cmds = BridgeCommand.query.filter_by(bridge_id=bridge.id, status="failed").all()
        cleared_count = len(failed_cmds)
        for cmd in failed_cmds:
            db.session.delete(cmd)

        # V10-M1: audit BEFORE the commit.
        audit(
            action="clear_failed_biometric_commands",
            resource_type="bridge",
            resource_id=bridge.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"cleared_count": cleared_count},
        )
        db.session.commit()

        return jsonify({
            "success": True,
            "data": {
                "cleared_count": cleared_count,
                "message": f"Cleared {cleared_count} failed command(s).",
            },
        })

    @bp.route("/access/adms-commands/<int:command_id>/cancel", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    @limiter.limit("10 per minute")
    def cancel_adms_command_route(command_id: int):
        """Owner-cancel a queued Direct ADMS command (V9-L14).

        Only ``queued`` rows can be cancelled — a ``delivered`` row has
        already been handed to the terminal and cannot be recalled, and
        terminal rows (``acked``/``failed``/``cancelled``) are history.
        The cancelled row is stamped status='cancelled'
        (result_code CANCELLED_BY_OWNER), so it stops counting toward
        the failed-commands banner. Cancelling the queued row frees the
        ADMS pipe: the COMMAND_PENDING guards block new test / advanced
        / unlock commands while any queued or delivered row exists, so a
        stuck unlock otherwise wedges every other ADMS command.
        Gym-scoped: a row from another gym is 404.
        """
        from app.models.rrr import RRRAdmsCommand

        command = RRRAdmsCommand.query.filter_by(
            id=command_id, gym_id=g.gym_id
        ).first()
        if command is None:
            return jsonify({"success": False, "error": {
                "code": "NOT_FOUND",
                "message": "Direct ADMS command was not found.",
            }}), 404
        if command.status != "queued":
            return jsonify({"success": False, "error": {
                "code": "COMMAND_NOT_QUEUED",
                "message": f"Only a queued command can be cancelled (status is {command.status}).",
            }}), 409
        cancel_adms_command(
            command, marker=OWNER_CANCELLED_MARKER, error=OWNER_CANCELLED_ERROR
        )
        # V10-M1: audit BEFORE the commit.
        audit(
            action="adms_command_cancelled_by_owner",
            resource_type="rrr_adms_command",
            resource_id=command.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"action": command.action},
        )
        db.session.commit()
        return jsonify({
            "success": True,
            "data": {
                "command_id": command.id,
                "action": command.action,
                "status": command.status,
                "message": "Queued Direct ADMS command cancelled.",
            },
        })

    @bp.route("/access/reconcile", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    @limiter.limit("10 per minute")
    def reconcile_all():
        """Re-sync all active gym members' access states to the biometric device.

        Owner-only (V11-L5, like retry-sync): reconcile force-queues door
        commands for every enrolled member, with a wider blast radius
        than retry — staff must not trigger it.
        """
        from app.models.rrr import RRRIntegration
        adms = RRRIntegration.query.filter_by(
            gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if adms is not None and not adms.commands_enabled:
            return jsonify({"success": False, "error": {
                "code": "NOT_COMMISSIONED",
                "message": "Complete supervised Direct ADMS setup before reconciling access.",
            }}), 403
        # V11-L11: batched (100 members/call) with per-row isolation —
        # the result reports remaining + the cursor for the next batch.
        result = queue_gym_reconciliation(g.gym_id)
        count = result["queued"]
        # V10-M1: audit BEFORE the commit.
        audit(
            action="reconcile_biometric_all_mobile",
            resource_type="rrr_integration" if adms is not None else "bridge",
            resource_id=adms.id if adms is not None else None,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"queued_count": count, "remaining_count": result["remaining"],
                      "failed_member_ids": result["failed"]},
        )
        db.session.commit()
        message = f"Re-sync queued for {count} enrolled member(s)."
        if result["remaining"]:
            message += (
                f" {result['remaining']} member(s) remaining — tap Re-sync again "
                "to continue."
            )
        return jsonify({
            "success": True,
            "data": {
                "queued_count": count,
                "remaining_count": result["remaining"],
                "total_count": result["total"],
                "skipped_manual_block_count": result["skipped_manual_block"],
                "failed_member_ids": result["failed"],
                "next_start_after_member_id": result["next_start_after_member_id"],
                "message": message,
            },
        })
