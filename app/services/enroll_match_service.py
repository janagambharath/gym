"""Smart enroll-number matching: terminal names -> member suggestions.

When a gym's biometric terminal already has users enrolled (names typed on the
device), staff shouldn't have to type each enroll ID by hand. The connector's
`sync_users` command snapshots the terminal user list; this service fuzzy-matches
those names against unlinked members and returns one-tap suggestions.

Nothing is linked automatically — staff confirms each match.
"""
from __future__ import annotations

import json
from difflib import SequenceMatcher

from app.extensions import db
from app.models.bridge import BridgeCommand
from app.models.member import Member
from app.services.audit_service import audit


# Minimum similarity (0-1) for a suggestion to be shown.
MATCH_THRESHOLD = 0.55

# Minimum similarity for AUTOMATIC linking (no manual confirmation).
# "jhon carl" vs "jhoncarl" = 0.94, so this catches spacing differences.
AUTO_LINK_THRESHOLD = 0.90


def _normalize_name(name: str | None) -> str:
    """Lowercase, remove ALL whitespace — for fuzzy comparison.
    
    "jhon carl" and "jhoncarl" both become "jhoncarl" for exact matching,
    while SequenceMatcher still handles typos and partial matches.
    """
    return "".join((name or "").lower().split())


def _similarity(a: str, b: str) -> float:
    a, b = _normalize_name(a), _normalize_name(b)
    if not a or not b:
        return 0.0
    # Exact match after normalization (handles spacing differences)
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def get_terminal_snapshot(gym_id: int) -> dict | None:
    """Return the latest acked sync_users snapshot for this gym, or None.

    The connector ships the terminal user list as resultData on the ack:
    {"users": [{"user_id": "42", "name": "Ramesh Kumar", ...}], "count": N}.
    """
    cmd = (
        BridgeCommand.query.filter_by(
            gym_id=gym_id, command_type="sync_users", status="acked"
        )
        .filter(BridgeCommand.result_data.isnot(None))
        .order_by(BridgeCommand.acknowledged_at.desc())
        .first()
    )
    if not cmd or not cmd.result_data:
        return None
    try:
        data = json.loads(cmd.result_data)
    except (json.JSONDecodeError, TypeError):
        return None
    users = data.get("users") if isinstance(data, dict) else None
    if not isinstance(users, list):
        return None
    return {
        "command_id": cmd.id,
        "source": "bridge",
        "acknowledged_at": cmd.acknowledged_at.isoformat() if cmd.acknowledged_at else None,
        "users": [
            {"enroll_number": str(u.get("user_id") or u.get("enroll_number") or "").strip(),
             "name": str(u.get("name") or "").strip()}
            for u in users
            if isinstance(u, dict)
        ],
    }


def get_adms_snapshot(gym_id: int) -> dict | None:
    """Return the latest ADMS USERINFO snapshot for this gym, or None.

    The terminal uploads its user table in response to our ``DATA QUERY
    USERINFO`` command; the cdata handler stores it on the sync_users
    command's result_data.  This is the PC-less path to smart matching.

    Also merges OPERLOG-derived enrollments (action="operlog_snapshot"):
    the X2008 pushes PIN + Name via OPERLOG on every enrollment even though
    it never answers USERINFO queries.
    """
    from app.models.rrr import RRRAdmsCommand, RRRIntegration

    integration = RRRIntegration.query.filter_by(
        gym_id=gym_id, connector_type="adms_direct"
    ).first()
    if not integration:
        return None
    cmd = (
        RRRAdmsCommand.query.filter_by(integration_id=integration.id, action="sync_users")
        .filter(RRRAdmsCommand.result_data.isnot(None))
        .order_by(RRRAdmsCommand.id.desc())
        .first()
    )
    users: list[dict] = []
    command_id = None
    acknowledged_at = None
    if cmd and cmd.result_data:
        try:
            data = json.loads(cmd.result_data)
        except (json.JSONDecodeError, TypeError):
            data = None
        raw_users = data.get("users") if isinstance(data, dict) else None
        if isinstance(raw_users, list):
            command_id = cmd.id
            acknowledged_at = cmd.acknowledged_at.isoformat() if cmd.acknowledged_at else None
            users = [
                {"enroll_number": str(u.get("enroll_number") or "").strip(),
                 "name": str(u.get("name") or "").strip()}
                for u in raw_users
                if isinstance(u, dict)
            ]
    # Merge OPERLOG-derived enrollments (X2008's working name channel)
    operlog_cmd = (
        RRRAdmsCommand.query.filter_by(integration_id=integration.id, action="operlog_snapshot")
        .filter(RRRAdmsCommand.result_data.isnot(None))
        .order_by(RRRAdmsCommand.id.desc())
        .first()
    )
    if operlog_cmd and operlog_cmd.result_data:
        try:
            odata = json.loads(operlog_cmd.result_data)
        except (json.JSONDecodeError, TypeError):
            odata = None
        oraw = odata.get("users") if isinstance(odata, dict) else None
        if isinstance(oraw, list):
            seen = {u["enroll_number"] for u in users}
            for u in oraw:
                if not isinstance(u, dict):
                    continue
                en = str(u.get("enroll_number") or "").strip()
                nm = str(u.get("name") or "").strip()
                if en and en not in seen:
                    users.append({"enroll_number": en, "name": nm})
                    seen.add(en)
            if command_id is None:
                command_id = operlog_cmd.id
    if not users:
        return None
    return {
        "command_id": command_id,
        "source": "adms",
        "acknowledged_at": acknowledged_at,
        "users": users,
    }


def upsert_terminal_snapshot(gym_id: int, enroll_number: str, name: str, source: str = "operlog") -> None:
    """Store a terminal user name from an OPERLOG enrollment record.

    The X2008 never uploads USERINFO via query, but OPERLOG pushes contain
    PIN + Name on every enrollment. This accumulates those into a snapshot
    that get_adms_snapshot() merges, enabling auto-link for future enrollments.

    Stored on a dedicated RRRAdmsCommand (action="operlog_snapshot") with
    result_data={"users": [...], "source": "operlog"}. Does not commit.

    Rollback safety: the row is flushed inside a SAVEPOINT
    (``db.session.begin_nested()``), so a flush failure — e.g. a CHECK
    violation on a database whose ``operlog_snapshot`` migration has not
    run yet — rolls back only the snapshot, never the caller's transaction.
    The failed row is expunged (new row) or expired (existing row) so a
    later flush cannot retry the same bad write, the failure is logged,
    and the caller can still commit the rest of its work (the cdata
    handler's other ingest results). Previously the failure surfaced only
    at the caller's final commit, poisoning the whole cdata POST with a
    PendingRollbackError. This function never raises for a snapshot
    failure; callers that need the snapshot must re-read it.
    """
    import json
    import logging

    from sqlalchemy.exc import IntegrityError

    from app.models.rrr import RRRAdmsCommand, RRRIntegration

    log = logging.getLogger(__name__)

    integration = RRRIntegration.query.filter_by(
        gym_id=gym_id, connector_type="adms_direct"
    ).first()
    if not integration:
        return
    enroll_number = str(enroll_number).strip()
    name = str(name).strip()
    if not enroll_number or not name:
        return

    cmd = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, action="operlog_snapshot"
    ).order_by(RRRAdmsCommand.id.desc()).first()

    users: dict[str, str] = {}
    if cmd and cmd.result_data:
        try:
            data = json.loads(cmd.result_data)
            for u in data.get("users", []):
                if isinstance(u, dict) and u.get("enroll_number"):
                    users[str(u["enroll_number"]).strip()] = str(u.get("name", "")).strip()
        except (json.JSONDecodeError, TypeError):
            pass
    users[enroll_number] = name

    payload = json.dumps({
        "users": [{"enroll_number": k, "name": v} for k, v in users.items()],
        "source": source,
        "count": len(users),
    })
    is_new = cmd is None
    if cmd:
        cmd.result_data = payload
    else:
        cmd = RRRAdmsCommand(
            gym_id=gym_id,
            integration_id=integration.id,
            action="operlog_snapshot",
            test_enroll_number=enroll_number,
            command_text="OPERLOG enrollment capture (automatic)",
            status="acked",
            result_data=payload,
        )
        db.session.add(cmd)
    # Flush here, inside a SAVEPOINT, rather than leaving the failure for
    # the caller's commit. This function always runs after a query above,
    # so a transaction is already active and begin_nested() is a true
    # SAVEPOINT (not an outer commit).
    try:
        with db.session.begin_nested():
            db.session.flush()
    except IntegrityError as exc:
        # Rollback of the SAVEPOINT has already happened on exit from the
        # block. Drop the failed write from the session so the caller's
        # later flush/commit cannot resurrect it.
        if is_new:
            db.session.expunge(cmd)
        else:
            db.session.expire(cmd)
        log.warning(
            "OPERLOG snapshot flush failed (skipping snapshot for "
            "gym %s, enroll %s): %s",
            gym_id, enroll_number, exc,
        )
        return


def suggest_matches(gym_id: int) -> dict:
    """Fuzzy-match unlinked terminal users against unlinked members.

    Returns {"suggestions": [...], "unmatched_terminal": [...], "snapshot": {...}}.
    Each suggestion: {enroll_number, terminal_name, member_id, member_name,
    member_phone, confidence (0-100)}.
    """
    snapshot = get_terminal_snapshot(gym_id) or get_adms_snapshot(gym_id)
    if not snapshot:
        return {"suggestions": [], "unmatched_terminal": [], "snapshot": None,
                "error": "no_snapshot",
                "message": "No terminal user list yet. Run 'Scan terminal users' first."}

    # Members already linked (or deleted) are out of the candidate pool.
    members = (
        Member.query.filter_by(gym_id=gym_id)
        .filter(Member.deleted_at.is_(None), Member.device_enroll_number.is_(None))
        .all()
    )
    linked_enrolls = {
        m.device_enroll_number
        for m in Member.query.filter_by(gym_id=gym_id)
        .filter(Member.deleted_at.is_(None), Member.device_enroll_number.isnot(None))
        .all()
    }

    suggestions = []
    unmatched = []
    used_member_ids: set[int] = set()

    for tu in snapshot["users"]:
        enroll = tu["enroll_number"]
        tname = tu["name"]
        if not enroll or enroll in linked_enrolls:
            continue  # already linked — nothing to do
        best: Member | None = None
        best_score = 0.0
        for m in members:
            if m.id in used_member_ids:
                continue
            score = _similarity(tname, m.full_name)
            if score > best_score:
                best_score, best = score, m
        if best is not None and best_score >= MATCH_THRESHOLD:
            used_member_ids.add(best.id)
            suggestions.append({
                "enroll_number": enroll,
                "terminal_name": tname,
                "member_id": best.id,
                "member_name": best.full_name,
                "member_phone": best.phone,
                "confidence": round(best_score * 100),
            })
        else:
            unmatched.append({"enroll_number": enroll, "terminal_name": tname,
                              "best_guess_score": round(best_score * 100)})

    suggestions.sort(key=lambda s: s["confidence"], reverse=True)
    return {"suggestions": suggestions, "unmatched_terminal": unmatched,
            "snapshot": {"command_id": snapshot["command_id"],
                         "acknowledged_at": snapshot["acknowledged_at"],
                         "terminal_user_count": len(snapshot["users"]),
                         "source": snapshot.get("source", "adms")}}


def auto_link_high_confidence(
    gym_id: int, actor_id: int | None = None, skip_command_for_active: bool = False
) -> dict:
    """Automatically link terminal users to members with very high name similarity.
    
    This handles cases like "jhon carl" (app) vs "jhoncarl" (terminal) —
    after normalization they're identical, so we can safely auto-link.
    
    Returns {"linked": [...], "skipped": [...]}.
    Only links when similarity >= AUTO_LINK_THRESHOLD (0.90).
    """
    result = suggest_matches(gym_id)
    if result.get("error"):
        return {"linked": [], "skipped": [], "error": result["error"]}
    
    linked = []
    skipped = []
    
    for sugg in result["suggestions"]:
        if sugg["confidence"] >= AUTO_LINK_THRESHOLD * 100:
            try:
                member = confirm_match(
                    gym_id=gym_id,
                    member_id=sugg["member_id"],
                    enroll_number=sugg["enroll_number"],
                    actor_id=actor_id or 0,
                    skip_command_for_active=skip_command_for_active,
                )
                linked.append({
                    "enroll_number": sugg["enroll_number"],
                    "member_name": sugg["member_name"],
                    "confidence": sugg["confidence"],
                })
            except ValueError as e:
                skipped.append({
                    "enroll_number": sugg["enroll_number"],
                    "reason": str(e),
                })
        else:
            skipped.append({
                "enroll_number": sugg["enroll_number"],
                "terminal_name": sugg["terminal_name"],
                "member_name": sugg["member_name"],
                "confidence": sugg["confidence"],
                "reason": "below auto-link threshold, needs manual confirm",
            })
    
    return {"linked": linked, "skipped": skipped}


def confirm_match(
    gym_id: int,
    member_id: int,
    enroll_number: str,
    actor_id: int,
    skip_command: bool = False,
    skip_command_for_active: bool = False,
) -> Member:
    """Link a member to a terminal enroll number. Raises ValueError on conflict.

    Reuses the same guards as the bridge enrollment confirm: no silent
    reassign, no duplicates.
    """
    from app.services.bridge_service import canonical_enroll_number, queue_membership_command

    enroll_number = canonical_enroll_number(enroll_number)
    member = Member.query.filter_by(id=member_id, gym_id=gym_id).first()
    if member is None or member.deleted_at is not None:
        raise ValueError("Member not found.")
    if member.device_enroll_number and member.device_enroll_number != enroll_number:
        raise ValueError(
            f"This member already has enroll number {member.device_enroll_number}. "
            "Remove it first to reassign."
        )
    duplicate = (
        Member.query.filter_by(gym_id=gym_id, device_enroll_number=enroll_number)
        .filter(Member.id != member.id, Member.deleted_at.is_(None))
        .first()
    )
    if duplicate is not None:
        raise ValueError(
            f"Enroll number {enroll_number} is already linked to {duplicate.full_name}."
        )
    member.device_enroll_number = enroll_number
    # M4: when the link comes from a fresh OPERLOG enrollment, the terminal
    # already holds the correct state for active members — skip the redundant
    # UPDATE (which would also clobber a 90-99% matched name). Always queue
    # when the desired state differs (expired -> block).
    _skip = skip_command
    if not _skip and skip_command_for_active:
        from app.services.bridge_service import desired_command_type
        _skip = desired_command_type(member) == "enable_user"
    if not _skip:
        queue_membership_command(member)  # terminal gets enable/disable for the new link
    audit(
        action="enroll_match_confirmed",
        resource_type="member",
        resource_id=member.id,
        gym_id=gym_id,
        actor_id=actor_id,
        metadata={"enroll_number": enroll_number},
    )
    db.session.commit()
    return member
