"""Tests for smart enroll-number matching (2026-10-13 feature).

Terminal user list (names) -> fuzzy match against unlinked members ->
one-tap confirm. Nothing links automatically.
"""
import json
from datetime import date, timedelta

import pytest

from app.extensions import db
from app.models import Member
from app.models.bridge import BridgeCommand, BridgeInstallation
from app.services import enroll_match_service
from app.mobile_api.token_service import create_access_token


def _owner_headers(seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    token = create_access_token(user_id=owner.id, gym_id=gym.id, role="gym_owner")
    return {"Authorization": f"Bearer {token}"}


def _seed_bridge_and_snapshot(app, seed_gym, terminal_users):
    """Create a bridge + an acked sync_users command carrying a terminal snapshot."""
    gym = seed_gym["gym"]
    with app.app_context():
        bridge = BridgeInstallation(
            gym_id=gym.id,
            public_id="test-pub-id",
            api_key_hash="x" * 64,
            device_serial="TEST-SERIAL",
            display_name="Test Bridge",
            is_active=True,
        )
        db.session.add(bridge)
        db.session.flush()
        cmd = BridgeCommand(
            bridge_id=bridge.id,
            gym_id=gym.id,
            command_type="sync_users",
            enroll_number="SYSTEM",
            status="acked",
            result_data=json.dumps({"users": terminal_users, "count": len(terminal_users)}),
        )
        db.session.add(cmd)
        db.session.commit()
        return bridge.id, cmd.id


def test_suggest_matches_name_similarity(app, seed_gym, seed_member):
    gym = seed_gym["gym"]
    # seed_member is "John Doe" with no enroll number
    _seed_bridge_and_snapshot(app, seed_gym, [
        {"user_id": "42", "name": "John Doe"},      # exact match
        {"user_id": "43", "name": "Jon Do"},        # fuzzy match
        {"user_id": "44", "name": "Someone Else"},  # no member like this
    ])
    with app.app_context():
        result = enroll_match_service.suggest_matches(gym.id)
    suggestions = {s["enroll_number"]: s for s in result["suggestions"]}
    assert "42" in suggestions
    assert suggestions["42"]["member_id"] == seed_member.id
    assert suggestions["42"]["confidence"] == 100
    # 43 ("Jon Do") would also match John Doe, but he's already used by 42,
    # so 43 lands in unmatched (no other members to match).
    unmatched = {u["enroll_number"] for u in result["unmatched_terminal"]}
    assert "43" in unmatched
    assert "44" in unmatched


def test_suggest_skips_already_linked(app, seed_gym, seed_member):
    gym = seed_gym["gym"]
    with app.app_context():
        seed_member.device_enroll_number = "42"
        db.session.commit()
    _seed_bridge_and_snapshot(app, seed_gym, [
        {"user_id": "42", "name": "John Doe"},
        {"user_id": "43", "name": "John Doe"},
    ])
    with app.app_context():
        result = enroll_match_service.suggest_matches(gym.id)
    # 42 already linked -> skipped entirely; 43 has no unlinked member to match
    assert result["suggestions"] == []
    assert {u["enroll_number"] for u in result["unmatched_terminal"]} == {"43"}


def test_suggest_no_snapshot(app, seed_gym):
    gym = seed_gym["gym"]
    with app.app_context():
        result = enroll_match_service.suggest_matches(gym.id)
    assert result["suggestions"] == []
    assert result["error"] == "no_snapshot"


def test_confirm_match_links_and_queues_command(app, seed_gym, seed_member):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    _seed_bridge_and_snapshot(app, seed_gym, [{"user_id": "42", "name": "John Doe"}])
    with app.app_context():
        member = enroll_match_service.confirm_match(gym.id, seed_member.id, "42", owner.id)
        assert member.device_enroll_number == "42"
        # A membership command was queued for the new link
        cmd = BridgeCommand.query.filter_by(
            gym_id=gym.id, enroll_number="42", command_type="enable_user"
        ).first()
        assert cmd is not None


def test_confirm_match_rejects_duplicates(app, seed_gym, seed_member):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    with app.app_context():
        other = Member(
            gym_id=gym.id, plan_id=seed_gym["plan"].id, full_name="Jane Doe",
            phone="+919998887777", status="active",
            membership_start=date.today(), membership_end=date.today() + timedelta(days=30),
        )
        db.session.add(other)
        db.session.commit()
        enroll_match_service.confirm_match(gym.id, seed_member.id, "42", owner.id)
        with pytest.raises(ValueError, match="already linked"):
            enroll_match_service.confirm_match(gym.id, other.id, "42", owner.id)


def test_enroll_scan_and_matches_endpoints(client, app, seed_gym, seed_member):
    headers = _owner_headers(seed_gym)
    gym = seed_gym["gym"]

    # No bridge yet -> 404
    res = client.post("/api/mobile/v1/rrr/enroll-scan", headers=headers)
    assert res.status_code == 404

    # Pair a bridge, scan, then check suggestions
    _seed_bridge_and_snapshot(app, seed_gym, [{"user_id": "7", "name": "John Doe"}])
    res = client.post("/api/mobile/v1/rrr/enroll-scan", headers=headers)
    assert res.status_code == 201

    res = client.get("/api/mobile/v1/rrr/enroll-matches", headers=headers)
    assert res.status_code == 200
    suggestions = res.json["data"]["suggestions"]
    assert len(suggestions) == 1
    assert suggestions[0]["enroll_number"] == "7"
    assert suggestions[0]["member_id"] == seed_member.id

    # Confirm via API
    res = client.post("/api/mobile/v1/rrr/enroll-matches/confirm", headers=headers, json={
        "member_id": seed_member.id, "enroll_number": "7",
    })
    assert res.status_code == 200
    assert res.json["data"]["enroll_number"] == "7"
    with app.app_context():
        assert db.session.get(Member, seed_member.id).device_enroll_number == "7"

    # Confirming again for another member -> 409
    with app.app_context():
        other = Member(
            gym_id=gym.id, plan_id=seed_gym["plan"].id, full_name="Jane Doe",
            phone="+919998887777", status="active",
            membership_start=date.today(), membership_end=date.today() + timedelta(days=30),
        )
        db.session.add(other)
        db.session.commit()
        other_id = other.id
    res = client.post("/api/mobile/v1/rrr/enroll-matches/confirm", headers=headers, json={
        "member_id": other_id, "enroll_number": "7",
    })
    assert res.status_code == 409
