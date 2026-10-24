from __future__ import annotations

import re
import secrets
import zoneinfo
from datetime import datetime, timedelta, timezone

from flask import current_app
from sqlalchemy import and_, or_, select

from app.extensions import db
from app.models import BridgeCommand, BridgeInstallation, Member
from app.models import RRRAdmsCommand, RRRIdentityMapping, RRRIntegration
from app.models.mixins import utcnow
from app.services.audit_service import audit
from app.services.timezone_service import today_for_gym


_ENROLL_NUMBER_RE = re.compile(r"^[0-9]{1,10}$")

BRIDGE_DISABLE_COMMAND_TYPES = frozenset({"disable_user", "delete_user"})
# Every ADMS action whose wire text is a DELETE (see adms_command_text and
# the raw probe templates in app/mobile_api/adms_probe.py).  The 2026-10-23
# hotfix covered only {"block", "delete_user"}; block_test produces the
# identical "DATA DELETE USERINFO" bytes and the template-delete tests
# produce "DATA DELETE FINGERTMP", so omitting them let a test path delete
# any terminal user, including an active member (investigation C2).
# The probe_* names are not in the command-table action CHECK today, so
# they cannot be queued on a CHECK-enforced DB — they are listed here so
# they are guarded the moment that CHECK is ever widened, and getrequest
# additionally guards on the wire text itself (adms_command_is_delete).
ADMS_DISABLE_ACTIONS = frozenset({
    "block",
    "block_test",
    "delete_user",
    "delete_biodata_test",
    "delete_fingertmp_test",
    "probe_del_tmp_bare",
    "probe_del_tmp_fid0",
    "probe_del_tmp_fid1",
    "probe_del_bio_bare",
    "probe_del_bio_type1",
    "probe_del_auth",
})
# Enable-type actions/commands: serving one opens (or re-opens) the door.
# They get the mirror-image serve-time revalidation (H8): only a member
# who is currently active with an end date today or in the future may be
# enabled.  Bridge set_valid_date is included because setting a validity
# window is door-opening state, not a neutral read.
ADMS_ENABLE_ACTIONS = frozenset({"unblock", "unblock_test", "create_user", "restore_template"})
BRIDGE_ENABLE_COMMAND_TYPES = frozenset({"enable_user", "create_user", "set_valid_date"})
# Actions whose wire effect is a terminal DELETE (destructive: the user
# record — and, on X2008, its fingerprint templates — are gone until the
# member physically re-enrolls). Used for destructive-action labelling.
ADMS_DESTRUCTIVE_ACTIONS = frozenset(
    {"block", "delete_user", "block_test", "delete_biodata_test", "delete_fingertmp_test"}
)
ADMS_BLOCK_DESTRUCTIVE_NOTE = (
    "ADMS block deletes the user from the terminal — fingerprint "
    "re-enrollment is required on unblock (templates are not backed up "
    "on X2008)."
)
# Single stuck-command timeout shared by the ADMS getrequest reaper and the
# owner test-command endpoint (L5, aligned 2026-10-24). A delivered command
# is failed after this long without an ack; the same value bounds getrequest
# re-sends (L6) — a delivered command is re-served only inside this window.
ADMS_DELIVERED_TIMEOUT_MINUTES = 10
# Distinct devicecmd outcome for DELETE commands the terminal reports as
# already absent (Return -1/-2). Status stays "acked" (the desired end
# state — user not on terminal — is achieved) but the outcome is no longer
# silently recorded as a plain success (H4).
ADMS_ACKED_ABSENT_RESULT_CODE = "ACKED_ABSENT"
# Bridge JSON ingestion cap (M12), matching the 256 KB ADMS body cap.
BRIDGE_MAX_JSON_BYTES = 262144


def sanitize_terminal_name(name: object, max_len: int = 24) -> str:
    """Strip control characters from a name interpolated into command text.

    Member names are free text; a tab would inject an extra tab-separated
    field into the PUSH command and a newline would break the
    ``C:<id>:<text>`` getrequest envelope (M6). Control chars (including
    tab/CR/LF) are removed, the result is stripped and truncated. Returns
    "" when nothing survives — callers fall back to a safe default name.
    """

    cleaned = "".join(ch for ch in str(name or "") if ord(ch) >= 32 and ord(ch) != 127)
    return cleaned.strip()[:max_len]
STALE_DISABLE_MARKER = "CANCELLED_STALE_STATE"
STALE_DISABLE_ERROR = (
    "CANCELLED_STALE_STATE: member is not proven blockable (fail-safe rule: "
    "active members are never blocked); disable command was not served."
)
STALE_ENABLE_MARKER = "CANCELLED_STALE_ENABLE"
STALE_ENABLE_ERROR = (
    "CANCELLED_STALE_ENABLE: member is not proven enableable (fail-safe rule: "
    "only a currently active member with an end date today or in the future "
    "may be enabled); enable command was not served."
)


def adms_command_is_delete(command: RRRAdmsCommand) -> bool:
    """True when an ADMS command would delete terminal state.

    Action-name check first; wire-text check second, so a DELETE produced
    by any builder (including a future action name not yet in
    ADMS_DISABLE_ACTIONS) is still caught at the point of no return.
    """

    if command.action in ADMS_DISABLE_ACTIONS:
        return True
    text = (command.command_text or "").strip().upper()
    return text.startswith("DATA DELETE")


def _as_utc(value: datetime) -> datetime:
    """Normalise DB timestamps from both PostgreSQL and SQLite."""

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def canonical_enroll_number(value: object) -> str:
    """Return a safe terminal Enroll Number, or raise ``ValueError``.

    The X990 access-control workflow uses a 32-bit numeric user ID for its
    time-zone APIs.  Keeping the online mapping numeric avoids a command that
    the local bridge could acknowledge but not enforce on the terminal.
    """

    text = str(value or "").strip()
    if not _ENROLL_NUMBER_RE.fullmatch(text):
        raise ValueError("Biometric Enroll Number must contain only digits.")
    number = int(text)
    if number < 1 or number > 2_147_483_647:
        raise ValueError("Biometric Enroll Number must be between 1 and 2147483647.")
    return str(number)


def desired_command_type(member: Member) -> str:
    """Translate the online membership state into a terminal access state."""

    gym_timezone = member.gym.timezone if member.gym else "Asia/Kolkata"
    try:
        local_today = datetime.now(zoneinfo.ZoneInfo(gym_timezone or "Asia/Kolkata")).date()
    except Exception:
        local_today = datetime.now(zoneinfo.ZoneInfo("Asia/Kolkata")).date()
    return (
        "enable_user"
        if member.status == "active" and not member.deleted_at and member.membership_end >= local_today
        else "disable_user"
    )


def member_is_proven_blockable(member: Member | None) -> bool:
    """The ONLY state in which a disable may reach a terminal (fail-safe).

    Bharath's hard invariant (2026-10-23): "Whatever u do, active members
    should not be blocked."  A member is proven blockable only when the row
    exists, is not deleted, and either:

    * ``status == "paused"`` — a deliberate freeze, blockable on any dates; or
    * ``membership_end`` is set, strictly before gym-local today, and
      ``status != "active"`` — a genuinely expired membership.

    Every other state fails safe (NOT blockable): status ``active`` on any
    date, end date today or in the future, a NULL end date, a deleted row,
    or a missing member.  The incident population — stored status ``expired``
    with a future end date — is not blockable under this rule.
    """

    if member is None or member.deleted_at is not None:
        return False
    if member.status == "paused":
        return True
    if member.membership_end is None or member.status == "active":
        return False
    gym_timezone = member.gym.timezone if member.gym else "Asia/Kolkata"
    return member.membership_end < today_for_gym(gym_timezone)


def disable_must_be_cancelled(member: Member | None) -> bool:
    """Serve/queue/retry guard: cancel unless the member is proven blockable."""

    return not member_is_proven_blockable(member)


def member_is_proven_enableable(member: Member | None) -> bool:
    """The ONLY state in which an enable may reach a terminal (fail-safe,
    H8 mirror of :func:`member_is_proven_blockable`).

    The member row must exist, not be deleted, have ``status == "active"``,
    and have ``membership_end`` set and on/after gym-local today.  Paused,
    expired, deleted, missing, and NULL-end members are all NOT enableable:
    a stale enable must never re-open the door after membership changed.
    """

    if member is None or member.deleted_at is not None:
        return False
    if member.status != "active" or member.membership_end is None:
        return False
    gym_timezone = member.gym.timezone if member.gym else "Asia/Kolkata"
    return member.membership_end >= today_for_gym(gym_timezone)


def enable_must_be_cancelled(member: Member | None) -> bool:
    """Serve/lease/retry guard: cancel an enable unless proven enableable."""

    return not member_is_proven_enableable(member)


def resolve_bridge_command_member(command: BridgeCommand) -> Member | None:
    """Resolve a bridge command to its member, gym-checked (M2).

    A ``member_id`` pointing at a member of a DIFFERENT gym is treated as
    unresolvable (returns None), never as that other gym's member: the
    command's gym is the authority, and a cross-gym reference must fail
    safe under both the disable and the enable guard.  The enroll-number
    fallback is gym-scoped by construction.
    """

    member = None
    if command.member_id is not None:
        member = command.member or db.session.get(Member, command.member_id)
        if member is not None and member.gym_id != command.gym_id:
            return None
    if member is None and command.enroll_number:
        # Manual commands may carry only an enroll number; resolve it so the
        # command is judged on the member's real state.  Unresolvable stays
        # unproven and is cancelled below (fail-safe).
        member = Member.query.filter_by(
            gym_id=command.gym_id, device_enroll_number=command.enroll_number
        ).first()
    return member


def bridge_command_must_be_cancelled(command: BridgeCommand) -> bool:
    """Whether a bridge command is a disable for a non-blockable member."""

    if command.command_type not in BRIDGE_DISABLE_COMMAND_TYPES:
        return False
    return disable_must_be_cancelled(resolve_bridge_command_member(command))


def bridge_enable_must_be_cancelled(command: BridgeCommand) -> bool:
    """Whether a bridge command is an enable for a non-enableable member."""

    if command.command_type not in BRIDGE_ENABLE_COMMAND_TYPES:
        return False
    return enable_must_be_cancelled(resolve_bridge_command_member(command))


def cancel_bridge_command(
    command: BridgeCommand,
    *,
    marker: str = STALE_DISABLE_MARKER,
    error: str = STALE_DISABLE_ERROR,
) -> None:
    """Terminal-state a stale bridge disable/enable without a schema migration.

    Both command tables constrain ``status`` by database CHECK constraints,
    so this hotfix uses the existing ``failed`` terminal state plus an
    unmistakable marker.  ``failed`` is never leased or served again; the
    state-aware retry paths check the same guard before any resurrection.
    Pass the STALE_ENABLE_* pair when cancelling an enable.
    """

    command.status = "failed"
    command.last_error = error
    command.lease_token = None
    command.lease_expires_at = None
    command.acknowledged_at = utcnow()


def resolve_adms_member(gym_id: int, enroll_number: str | None) -> Member | None:
    """Resolve an ADMS command's terminal identity back to a member row.

    Gym-checked on both branches (M2): a confirmed mapping whose member
    belongs to a different gym is NEVER returned — resolution falls through
    to the gym-scoped ``device_enroll_number`` query, so a cross-gym
    mapping can only ever resolve to a member of this gym, or to None.
    """

    if not enroll_number:
        return None
    try:
        canonical = canonical_enroll_number(enroll_number)
    except ValueError:
        return None

    mapping = (
        RRRIdentityMapping.query.filter_by(
            gym_id=gym_id, external_id=canonical, status="confirmed"
        )
        .order_by(RRRIdentityMapping.id.desc())
        .first()
    )
    if mapping is not None and mapping.member_id is not None:
        member = db.session.get(Member, mapping.member_id)
        if member is not None and member.gym_id == gym_id:
            return member
    return Member.query.filter_by(
        gym_id=gym_id, device_enroll_number=canonical
    ).first()


def cancel_adms_command(
    command: RRRAdmsCommand,
    *,
    marker: str = STALE_DISABLE_MARKER,
    error: str = STALE_DISABLE_ERROR,
) -> None:
    """Terminal-state a stale ADMS disable/enable (see :func:`cancel_bridge_command`).

    Pass the STALE_ENABLE_* pair when cancelling an enable.
    """

    command.status = "failed"
    command.result_code = marker
    command.result_message = error
    command.acknowledged_at = utcnow()


def _active_installation(gym_id: int) -> BridgeInstallation | None:
    return BridgeInstallation.query.filter_by(gym_id=gym_id, is_active=True).first()


# ─── Direct ADMS automatic block/unblock ─────────────────────────────────────

def adms_command_text(
    action: str,
    enroll_number: str | None,
    *,
    member_name: str | None = None,
    delay_seconds: int = 5,
) -> str:
    """Return the PUSH SDK wire text for a direct-ADMS terminal command.

    ``block``/``unblock`` are the automatic membership commands; the ``*_test``
    variants are the owner-driven commissioning commands.  Both spellings share
    the same wire format: Pri=1 is the vendor's inactive-user value and Pri=0
    is a normal user.

    Advanced commands added for the no-laptop direct-ADMS path:

    * ``create_user`` — ``DATA UPDATE USERINFO PIN=<id>\tName=<name>``
    * ``delete_user`` — ``DATA DELETE USERINFO PIN=<id>``
    * ``unlock_door`` — ``CONTROL DEVICE 1 <delay_tenths>``
    * ``clear_log``   — ``CLEAR LOG``
    * ``reboot``      — ``REBOOT``
    * ``check``       — ``CHECK``
    * ``sync_users``  — ``DATA QUERY USERINFO`` (terminal uploads its user table;
      the cdata handler stores it as the command's result_data for smart matching)
    """

    if action == "sync_users":
        # X2008 (ZAM180_TFT classic) may need explicit PIN=ALL to upload USERINFO
        return "DATA QUERY USERINFO PIN=ALL"

    if action == "probe_info":
        return "INFO"
    if action == "check":
        return "CHECK"
    if action == "reboot":
        return "REBOOT"
    if action == "clear_log":
        return "CLEAR LOG"

    if action == "unlock_door":
        # CONTROL DEVICE <operation> <param>
        # operation=1 = unlock door, param = delay in tenths of a second
        delay_tenths = max(10, delay_seconds * 10)  # minimum 1 second
        return f"CONTROL DEVICE 1 {delay_tenths}"

    if action == "create_user":
        name = sanitize_terminal_name(member_name) or "Member"
        return f"DATA UPDATE USERINFO PIN={enroll_number}\tName={name}\tPri=0"

    if action == "delete_user":
        return f"DATA DELETE USERINFO PIN={enroll_number}"

    if action in {"block", "block_test"}:
        # DELETE is the only proven block on X2008. NOTE: fingerprint
        # templates are NOT backed up — the X2008 never uploads USERINFO/
        # templates via query, so unblock recreates the user and the member
        # must re-scan their finger.
        return f"DATA DELETE USERINFO PIN={enroll_number}"
    elif action in {"delete_biodata_test"}:
        # Delete all fingerprint templates for the user, keeping the user record.
        # X2008 runs ZAM180_TFT (classic ADMS dialect) — uses FINGERTMP table,
        # not the unified 'biodata' table (which returns -1 on this firmware).
        #   DATA DELETE FINGERTMP PIN=<pin>
        return f"DATA DELETE FINGERTMP PIN={enroll_number}"
    elif action in {"delete_fingertmp_test"}:
        # Per-finger delete (FID-scoped). FID is mandatory in QUERY, may be
        # required for DELETE too. Try FID=0 first.
        #   DATA DELETE FINGERTMP PIN=<pin>\tFID=0
        return f"DATA DELETE FINGERTMP PIN={enroll_number}\tFID=0"
    elif action in {"unblock", "unblock_test"}:
        # Recreate the user. Fingerprint restore commands are queued
        # separately by queue_adms_membership_command.
        name = sanitize_terminal_name(member_name) or "Test User"
        return f"DATA UPDATE USERINFO PIN={enroll_number}\tName={name}\tPri=0"
    else:
        raise ValueError(f"Unknown ADMS command action: {action!r}")


def resolve_adms_enroll_number(member: Member) -> str | None:
    """Return the terminal enroll number for a member on the direct-ADMS path.

    Prefers the confirmed RRR identity mapping (the biometric ID the terminal
    actually reported), then falls back to the member's device enroll number.
    Returns ``None`` when the member has no usable terminal identity.
    """

    mapping = (
        RRRIdentityMapping.query.filter_by(
            gym_id=member.gym_id, member_id=member.id, status="confirmed"
        )
        .order_by(RRRIdentityMapping.id.desc())
        .first()
    )
    candidate = (mapping.external_id if mapping else None) or member.device_enroll_number
    if not candidate:
        return None
    return canonical_enroll_number(candidate)


def _adms_integration(gym_id: int) -> RRRIntegration | None:
    return RRRIntegration.query.filter_by(gym_id=gym_id, connector_type="adms_direct").first()


def queue_adms_membership_command(member: Member, *, force: bool = False) -> RRRAdmsCommand | None:
    """Queue an automatic block/unblock for the direct-ADMS terminal.

    This is the direct-path twin of :func:`queue_membership_command`.  It is
    deliberately gated on ``commands_enabled``: the owner must finish the
    supervised commissioning (mapped real attendance + acknowledged test
    command + physical door test) before any automatic command is queued.

    Delivery is pull-based (the terminal polls ``/iclock/getrequest`` and
    re-sends ``delivered`` commands until acknowledged), so queueing while the
    terminal is temporarily offline is safe.  Commands are never queued for a
    terminal that has never connected.

    Like the bridge twin, this function does not commit.
    """

    integration = _adms_integration(member.gym_id)
    if integration is None or not integration.commands_enabled:
        return None
    if integration.last_success_at is None:
        # The terminal never checked in; do not pile commands into the void.
        return None

    try:
        enroll_number = resolve_adms_enroll_number(member)
    except ValueError:
        return None
    if not enroll_number:
        return None

    action = "block" if desired_command_type(member) == "disable_user" else "unblock"
    command_text = adms_command_text(action, enroll_number, member_name=member.full_name)

    # Lock the latest command for this terminal identity so a concurrent
    # renewal/expiry cannot reorder or duplicate the terminal's final state.
    latest = db.session.execute(
        select(RRRAdmsCommand)
        .where(
            RRRAdmsCommand.integration_id == integration.id,
            RRRAdmsCommand.test_enroll_number == enroll_number,
            # M1: only membership-state commands participate in dedup.
            # OPERLOG snapshot rows (action="operlog_snapshot") share the
            # table and must not shadow the real block/unblock state.
            RRRAdmsCommand.action.in_(["block", "unblock", "delete_user", "create_user"]),
        )
        .order_by(RRRAdmsCommand.id.desc())
        .limit(1)
        .with_for_update()
    ).scalar_one_or_none()

    if latest is not None:
        if latest.status == "queued":
            if latest.action == action:
                return latest
            # A not-yet-delivered command can be replaced by the newest state.
            latest.action = action
            latest.test_enroll_number = enroll_number
            latest.command_text = command_text
            latest.result_code = None
            latest.result_message = None
            latest.requested_by_id = None
            audit(
                action=f"adms_membership_{action}_queued",
                resource_type="rrr_adms_command",
                resource_id=latest.id,
                gym_id=member.gym_id,
                metadata={"member_id": member.id, "enroll_number": enroll_number, "replaced": True,
                          **({"destructive": True, "destructive_note": ADMS_BLOCK_DESTRUCTIVE_NOTE}
                             if action == "block" else {})},
            )
            return latest
        if latest.status == "delivered":
            if latest.action == action:
                # The terminal holds it and getrequest re-sends until acked.
                return latest
            # A different-state command is already in flight; queue the
            # follow-up.  getrequest serves older IDs first, so the terminal
            # converges on the newest state.
        elif latest.status == "acked" and latest.action == action and not force:
            return latest
        # "failed" (or a forced repair) always queues a fresh command below.

    command = RRRAdmsCommand(
        gym_id=member.gym_id,
        integration_id=integration.id,
        action=action,
        test_enroll_number=enroll_number,
        command_text=command_text,
        requested_by_id=None,
    )
    db.session.add(command)
    db.session.flush()
    audit(
        action=f"adms_membership_{action}_queued",
        resource_type="rrr_adms_command",
        resource_id=command.id,
        gym_id=member.gym_id,
        metadata={"member_id": member.id, "enroll_number": enroll_number,
                  **({"destructive": True, "destructive_note": ADMS_BLOCK_DESTRUCTIVE_NOTE}
                     if action == "block" else {})},
    )
    # On unblock, queue fingerprint restore commands after the user recreation.
    # The terminal processes commands in ID order, so templates are restored
    # after the user exists.
    if action == "unblock":
        _queue_template_restore_commands(member, integration, enroll_number)
    return command


def _queue_template_restore_commands(member: Member, integration, enroll_number: str) -> int:
    """Queue BIODATA restore commands for backed-up fingerprint templates.

    Returns the number of restore commands queued.
    """
    from app.models.rrr import RRRBiometricTemplate

    templates = RRRBiometricTemplate.query.filter_by(
        gym_id=member.gym_id,
        integration_id=integration.id,
        enroll_number=enroll_number,
    ).all()
    count = 0
    for tmpl in templates:
        # Classic ADMS dialect (X2008/ZAM180_TFT) FINGERTMP restore format.
        # Verified Return=0 by khaledbinamir/biometric_integration.
        # Critical: Size must be the DECODED byte length, not base64 length.
        #   DATA UPDATE FINGERTMP\tPIN=<pin>\tFID=<n>\tSize=<decoded_len>\tValid=1\tTMP=<base64>
        # H2: templates are stored encrypted; decrypt here (the only read
        # site) so the terminal receives the plaintext TMP it requires. A
        # row that cannot be decrypted (key rotation without re-encryption)
        # is skipped, never shipped as ciphertext.
        import base64
        import logging

        try:
            from app.services.template_crypto import decrypt_template

            template_plaintext = decrypt_template(tmpl.template_data)
        except ValueError:
            logging.getLogger(__name__).warning(
                "Skipping undecryptable fingerprint template for enroll %s "
                "(key rotation without re-encryption?)",
                enroll_number,
            )
            continue
        try:
            decoded_len = len(base64.b64decode(template_plaintext))
        except Exception:
            decoded_len = 0
        restore_text = (
            f"DATA UPDATE FINGERTMP\tPIN={enroll_number}\t"
            f"FID={tmpl.finger_id}\tSize={decoded_len}\tValid=1\t"
            f"TMP={template_plaintext}"
        )
        cmd = RRRAdmsCommand(
            gym_id=member.gym_id,
            integration_id=integration.id,
            action="restore_template",
            test_enroll_number=enroll_number,
            command_text=restore_text,
            requested_by_id=None,
        )
        db.session.add(cmd)
        count += 1
    if count:
        db.session.flush()
        audit(
            action="adms_template_restore_queued",
            resource_type="rrr_adms_command",
            resource_id=None,
            gym_id=member.gym_id,
            metadata={"member_id": member.id, "enroll_number": enroll_number, "templates": count},
        )
    return count


def queue_manual_adms_member_command(
    member: Member, action: str, actor_id: int | None
) -> RRRAdmsCommand | None:
    """Queue an owner-initiated block/unblock for one member's terminal identity.

    Unlike :func:`queue_adms_membership_command` (which derives the action
    from membership state), the owner explicitly chooses ``block`` or
    ``unblock`` here — e.g. blocking a member for misconduct while their
    membership is still active.  Gated on supervised commissioning exactly
    like the automatic path.  Returns ``None`` when there is no commissioned
    direct-ADMS terminal or the member has no terminal identity.
    Does not commit.
    """
    if action not in {"block", "unblock"}:
        raise ValueError(f"Unknown manual ADMS action: {action!r}")
    integration = _adms_integration(member.gym_id)
    if integration is None or not integration.commands_enabled:
        return None
    if integration.last_success_at is None:
        return None
    try:
        enroll_number = resolve_adms_enroll_number(member)
    except ValueError:
        return None
    if not enroll_number:
        return None

    command_text = adms_command_text(action, enroll_number, member_name=member.full_name)
    command = RRRAdmsCommand(
        gym_id=member.gym_id,
        integration_id=integration.id,
        action=action,
        test_enroll_number=enroll_number,
        command_text=command_text,
        requested_by_id=actor_id,
    )
    db.session.add(command)
    db.session.flush()
    audit(
        action=f"adms_manual_{action}_queued",
        resource_type="rrr_adms_command",
        resource_id=command.id,
        gym_id=member.gym_id,
        actor_id=actor_id,
        metadata={"member_id": member.id, "enroll_number": enroll_number,
                  **({"destructive": True, "destructive_note": ADMS_BLOCK_DESTRUCTIVE_NOTE}
                     if action == "block" else {})},
    )
    return command


def queue_membership_command(member: Member, *, force: bool = False) -> BridgeCommand | None:
    """Queue the latest required terminal state, without duplicating work.

    This function deliberately does not commit.  Call it in the same database
    transaction as the membership change, so a renewal/expiry can never be
    saved without its corresponding device command.

    Every membership change fans out to both connector paths: the legacy
    Windows-bridge installation (when present) and the direct-ADMS terminal
    (when commissioned).  The direct-ADMS leg is a no-op unless the gym's
    direct integration has ``commands_enabled`` set by supervised
    commissioning.
    """

    bridge_command = _queue_bridge_membership_command(member, force=force)
    queue_adms_membership_command(member, force=force)
    return bridge_command


def _queue_bridge_membership_command(member: Member, *, force: bool = False) -> BridgeCommand | None:
    if not member.device_enroll_number:
        return None

    installation = _active_installation(member.gym_id)
    if installation is None:
        return None

    enroll_number = canonical_enroll_number(member.device_enroll_number)
    command_type = desired_command_type(member)
    # This lock is essential: a dashboard renewal must never mutate a command
    # that the polling request has already leased and handed to the laptop.
    latest = db.session.execute(
        select(BridgeCommand)
        .where(BridgeCommand.bridge_id == installation.id, BridgeCommand.member_id == member.id)
        .order_by(BridgeCommand.created_at.desc(), BridgeCommand.id.desc())
        .limit(1)
        .with_for_update()
    ).scalar_one_or_none()

    if latest is not None:
        if (
            latest.status in {"pending", "leased"}
            and latest.command_type == command_type
            and latest.enroll_number == enroll_number
        ):
            if force and latest.status == "pending":
                latest.not_before = None
            return latest
        if latest.status == "pending":
            # A not-yet-delivered command can safely be replaced by the most
            # recent membership state.  A leased command is left immutable;
            # its follow-up command preserves correct final ordering.
            latest.command_type = command_type
            latest.enroll_number = enroll_number
            latest.member_name = member.full_name
            latest.delay_seconds = None
            latest.last_error = None
            latest.retry_attempt = 0
            latest.not_before = None
            return latest
        if (
            latest.status == "acked"
            and latest.command_type == command_type
            and latest.enroll_number == enroll_number
        ):
            # A normal membership edit has nothing new to deliver once the
            # terminal acknowledged the required state.  A reconciliation is
            # different: it deliberately re-sends the present state so a
            # terminal that was manually changed can be repaired.
            if not force:
                return latest

    command = BridgeCommand(
        bridge_id=installation.id,
        gym_id=member.gym_id,
        member_id=member.id,
        command_type=command_type,
        enroll_number=enroll_number,
        member_name=member.full_name,
    )
    db.session.add(command)
    return command


def queue_gym_reconciliation(gym_id: int) -> int:
    """Queue access state for every enrolled member of one installed gym."""

    if _active_installation(gym_id) is None:
        return 0
    members = (
        Member.query.filter(
            Member.gym_id == gym_id,
            Member.device_enroll_number.is_not(None),
        )
        .order_by(Member.id.asc())
        .all()
    )
    queued = 0
    for member in members:
        if queue_membership_command(member, force=True) is not None:
            queued += 1
    return queued


def lease_pending_commands(installation: BridgeInstallation) -> list[BridgeCommand]:
    """Lease due commands for one short polling interval.

    Commands are never removed by a GET.  If the laptop loses power or an ACK
    fails, the expired lease is delivered again with a new token.
    """

    now = utcnow()
    lease_seconds = max(30, int(current_app.config["BRIDGE_COMMAND_LEASE_SECONDS"]))
    ready = (
        BridgeCommand.query.filter(
            BridgeCommand.bridge_id == installation.id,
            or_(
                BridgeCommand.status == "pending",
                and_(
                    BridgeCommand.status == "leased",
                    BridgeCommand.lease_expires_at.is_not(None),
                    BridgeCommand.lease_expires_at <= now,
                ),
            ),
            or_(BridgeCommand.not_before.is_(None), BridgeCommand.not_before <= now),
        )
        .order_by(BridgeCommand.created_at.asc(), BridgeCommand.id.asc())
        .limit(max(1, int(current_app.config["BRIDGE_COMMAND_BATCH_SIZE"])))
        .with_for_update()
        .all()
    )
    leased: list[BridgeCommand] = []
    for command in ready:
        # Final guard at the point of no return (fail-safe): hand a disable
        # to the bridge only for a proven-blockable member — paused, or
        # expired with a past end date.  Everything else (active on any
        # date, future/NULL end, missing member) is cancelled here.
        if bridge_command_must_be_cancelled(command):
            cancel_bridge_command(command)
            continue
        # Mirror guard for enables (H8): hand an enable to the bridge only
        # for a proven-enableable member — active with an end date today
        # or in the future.  A stale enable for a paused/expired member
        # must never re-open the door.
        if bridge_enable_must_be_cancelled(command):
            cancel_bridge_command(
                command, marker=STALE_ENABLE_MARKER, error=STALE_ENABLE_ERROR
            )
            continue
        command.lease(secrets.token_urlsafe(32), now + timedelta(seconds=lease_seconds))
        leased.append(command)
    return leased


def schedule_retry_after_failed_command(command: BridgeCommand) -> BridgeCommand | None:
    """Schedule a bounded new-ID retry after a physical device failure.

    The laptop persists command outcomes by command ID, so the same failed ID
    must never be re-executed.  A retry is therefore a delayed command with a
    new ID.  This avoids a tight loop while still recovering from transient
    Wi-Fi, terminal, or power failures.
    """

    max_attempts = max(1, int(current_app.config["BRIDGE_COMMAND_MAX_EXECUTION_ATTEMPTS"]))
    if command.retry_attempt + 1 >= max_attempts or command.member_id is None:
        return None
    member = db.session.get(Member, command.member_id)
    if member is None or not member.device_enroll_number:
        return None
    if member.gym_id != command.gym_id:
        # M2: a cross-gym member reference must never authorise a retry.
        return None
    if (
        command.command_type in BRIDGE_DISABLE_COMMAND_TYPES
        and disable_must_be_cancelled(member)
    ):
        # Fail-safe: never schedule a retry disable for a member who is not
        # proven blockable, even if the plain desired-state check agrees.
        return None
    if (
        command.command_type in BRIDGE_ENABLE_COMMAND_TYPES
        and enable_must_be_cancelled(member)
    ):
        # H8 mirror: never schedule a retry enable for a member who is not
        # proven enableable.
        return None
    if (
        desired_command_type(member) != command.command_type
        or canonical_enroll_number(member.device_enroll_number) != command.enroll_number
    ):
        # A later membership transaction will queue the correct current state.
        return None

    base_delay = max(30, int(current_app.config["BRIDGE_COMMAND_RETRY_SECONDS"]))
    delay_seconds = min(3600, base_delay * (2 ** command.retry_attempt))
    retry = BridgeCommand(
        bridge_id=command.bridge_id,
        gym_id=command.gym_id,
        member_id=command.member_id,
        command_type=command.command_type,
        enroll_number=command.enroll_number,
        member_name=command.member_name,
        retry_attempt=command.retry_attempt + 1,
        not_before=utcnow() + timedelta(seconds=delay_seconds),
    )
    db.session.add(retry)
    return retry


def acknowledge_command(
    command: BridgeCommand,
    *,
    status: str,
    lease_token: str,
    error_message: str | None,
    result_data: str | None = None,
) -> tuple[bool, str | None]:
    """Apply a bridge ACK.  Returns ``(accepted, error_code)``."""

    if status not in {"acked", "failed", "accepted"}:
        return False, "invalid_status"

    if command.status in {"acked", "failed"}:
        # Retrying an already received ACK is safe only when it agrees with
        # the durable result.  It must never mutate a completed command.
        return (command.status == status, None if command.status == status else "already_final")

    if command.status != "leased":
        return False, "not_leased"
    if not lease_token or not secrets.compare_digest(command.lease_token or "", lease_token):
        return False, "lease_mismatch"
    if command.lease_expires_at is None or _as_utc(command.lease_expires_at) < utcnow():
        return False, "lease_expired"

    if status == "accepted":
        # The connector's server accepted the command but device delivery is
        # unconfirmed (e.g. eBioServer queues the push for the terminal's next
        # poll). Keep the command pending so it is re-leased and retried;
        # never report it as done. Escalate if the device never confirms.
        command.lease_token = None
        command.lease_expires_at = None
        note = (error_message or "Accepted by server; device delivery unconfirmed.").strip()[:1000]
        if command.delivery_attempts >= 10:
            command.acknowledge(
                "failed",
                f"Device did not confirm delivery after {command.delivery_attempts} attempts: {note}",
            )
        else:
            command.status = "pending"
            command.last_error = note
        return True, None
    command.acknowledge(status, error_message, result_data=result_data)
    return True, None

