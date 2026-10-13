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


def _normalize_name(name: str | None) -> str:
    """Lowercase, collapse whitespace — for fuzzy comparison."""
    return " ".join((name or "").lower().split())


def _similarity(a: str, b: str) -> float:
    a, b = _normalize_name(a), _normalize_name(b)
    if not a or not b:
        return 0.0
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
        "acknowledged_at": cmd.acknowledged_at.isoformat() if cmd.acknowledged_at else None,
        "users": [
            {"enroll_number": str(u.get("user_id") or u.get("enroll_number") or "").strip(),
             "name": str(u.get("name") or "").strip()}
            for u in users
            if isinstance(u, dict)
        ],
    }


def suggest_matches(gym_id: int) -> dict:
    """Fuzzy-match unlinked terminal users against unlinked members.

    Returns {"suggestions": [...], "unmatched_terminal": [...], "snapshot": {...}}.
    Each suggestion: {enroll_number, terminal_name, member_id, member_name,
    member_phone, confidence (0-100)}.
    """
    snapshot = get_terminal_snapshot(gym_id)
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
                         "terminal_user_count": len(snapshot["users"])}}


def confirm_match(gym_id: int, member_id: int, enroll_number: str, actor_id: int) -> Member:
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
