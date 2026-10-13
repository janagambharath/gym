"""Regression tests for the 2026-10-13 security fixes.

Covers:
- Member JWT rejected on owner endpoints (cross-role impersonation)
- delete_account requires password confirmation
- Handshake tokens are single-use (no replay)
- ADMS serial-only auth removed (token-only)
- OTP verify has a server-side guess budget
"""
from datetime import date, timedelta

import pytest

from app.extensions import db
from app.models import Gym, Member, MembershipPlan, User
from app.models.gym import DEFAULT_TRIAL_DAYS
from app.mobile_api.token_service import (
    consume_handshake_token,
    create_access_token,
    create_handshake_token,
)


def _owner_token(owner, gym):
    return create_access_token(user_id=owner.id, gym_id=gym.id, role="gym_owner")


def _member_token(member, gym):
    # Same minting path the member login uses — same secret, same format.
    return create_access_token(user_id=member.id, gym_id=gym.id, role="member")


# ── Critical #1: member token on owner endpoints ──────────────────────────

def test_member_token_rejected_on_owner_endpoint(client, seed_gym, seed_member):
    """A member's valid JWT must NOT authenticate on owner API endpoints.

    members.id and users.id both autoincrement from 1, so member #1's token
    used to resolve to user #1 (the gym owner). The role claim must be enforced.
    """
    gym = seed_gym["gym"]
    member = seed_member
    # Sanity: force the ID collision the bug relied on.
    assert member.id == seed_gym["owner"].id

    headers = {"Authorization": f"Bearer {_member_token(member, gym)}"}
    res = client.get("/api/mobile/v1/me", headers=headers)
    assert res.status_code == 403
    assert res.json["error"]["code"] == "FORBIDDEN"


def test_owner_token_still_works(client, seed_gym):
    """The role check must not break legitimate owner access."""
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    headers = {"Authorization": f"Bearer {_owner_token(owner, gym)}"}
    res = client.get("/api/mobile/v1/me", headers=headers)
    assert res.status_code == 200
    assert res.json["success"] is True


def test_token_without_role_rejected(client, seed_gym):
    """Tokens with a missing/unexpected role are rejected on owner endpoints."""
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    token = create_access_token(user_id=owner.id, gym_id=gym.id, role="weird")
    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/api/mobile/v1/me", headers=headers)
    assert res.status_code == 403


# ── Critical #2: delete_account needs password ────────────────────────────

def test_delete_account_requires_password(client, seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    headers = {"Authorization": f"Bearer {_owner_token(owner, gym)}"}

    # No password at all
    res = client.delete("/api/mobile/v1/auth/account", headers=headers, json={})
    assert res.status_code == 403
    assert db.session.get(Gym, gym.id) is not None  # gym survives

    # Wrong password
    res = client.delete(
        "/api/mobile/v1/auth/account", headers=headers, json={"password": "WrongPass123!"}
    )
    assert res.status_code == 403
    assert db.session.get(Gym, gym.id) is not None


def test_delete_account_with_password_succeeds(client, app, seed_gym):
    """Correct password still allows the (deliberate) deletion flow."""
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    headers = {"Authorization": f"Bearer {_owner_token(owner, gym)}"}

    res = client.delete(
        "/api/mobile/v1/auth/account",
        headers=headers,
        json={"password": "SecurePass123!"},
    )
    assert res.status_code == 200
    assert db.session.get(Gym, gym.id) is None


# ── Handshake single-use ──────────────────────────────────────────────────

def test_handshake_token_single_use(app, seed_gym):
    """A handshake token can be consumed once; replay returns None."""
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    with app.test_request_context():
        token = create_handshake_token(
            user_id=owner.id, gym_id=gym.id, purpose="whatsapp_embedded_signup"
        )
        first = consume_handshake_token(token, "whatsapp_embedded_signup")
        assert first is not None
        assert first["sub"] == owner.id
        db.session.commit()  # persist the consumption, like the view does

        replay = consume_handshake_token(token, "whatsapp_embedded_signup")
        assert replay is None


def test_handshake_wrong_purpose_rejected(app, seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    with app.test_request_context():
        token = create_handshake_token(
            user_id=owner.id, gym_id=gym.id, purpose="whatsapp_embedded_signup"
        )
        assert consume_handshake_token(token, "other_purpose") is None


# ── ADMS: serial-only auth removed ────────────────────────────────────────

def test_adms_device_requires_path_token(app, seed_gym):
    """_device() without a path token must return None even for a known serial."""
    from app.adms.routes import _device
    from app.models.rrr import RRRIntegration

    gym = seed_gym["gym"]
    with app.test_request_context("/?SN=TESTSERIAL123"):
        integration = RRRIntegration(
            gym_id=gym.id,
            connector_type="adms_direct",
            display_name="Test Terminal",
            device_serial="TESTSERIAL123",
            adms_path_token="secret-path-token",
        )
        db.session.add(integration)
        db.session.commit()

        # Serial-only → rejected
        assert _device() is None
        assert _device(None) is None
        # Wrong token → rejected
        assert _device("wrong-token") is None
        # Correct token → accepted
        assert _device("secret-path-token") is not None


# ── OTP guess budget ─────────────────────────────────────────────────────

def test_otp_attempt_budget_enforced(client, app, seed_member):
    """After MAX_OTP_ATTEMPTS wrong guesses, verify returns 429."""
    from app.mobile_api.member_api import (
        MAX_OTP_ATTEMPTS,
        _sign_otp_challenge,
    )
    import time

    from app.mobile_api.member_api import _normalize_phone
    member = seed_member
    phone = _normalize_phone(member.phone)
    expires_at_ts = int(time.time()) + 600
    # Sign a challenge for the REAL otp "000000"; we will guess wrong codes.
    challenge = _sign_otp_challenge(phone, member.id, member.gym_id, "000000", expires_at_ts)

    for _ in range(MAX_OTP_ATTEMPTS):
        res = client.post(
            "/api/member/v1/auth/verify-otp",
            json={"phone": phone, "otp": "111111", "challenge": challenge},
        )
        # Wrong OTP → 400 (attempt recorded)
        assert res.status_code == 400

    # Budget exhausted → 429 even before OTP verification
    res = client.post(
        "/api/member/v1/auth/verify-otp",
        json={"phone": phone, "otp": "111111", "challenge": challenge},
    )
    assert res.status_code == 429
    assert res.json["success"] is False


def test_otp_verify_still_succeeds_within_budget(client, app, seed_member):
    """A correct OTP on the first try still works."""
    from app.mobile_api.member_api import _sign_otp_challenge
    import time

    from app.mobile_api.member_api import _normalize_phone
    member = seed_member
    phone = _normalize_phone(member.phone)
    expires_at_ts = int(time.time()) + 600
    # NOTE: distinct OTP from the budget test so the challenge hash differs.
    challenge = _sign_otp_challenge(phone, member.id, member.gym_id, "000001", expires_at_ts)

    res = client.post(
        "/api/member/v1/auth/verify-otp",
        json={"phone": phone, "otp": "000001", "challenge": challenge},
    )
    assert res.status_code == 200
    assert res.json["success"] is True
    assert res.json["data"]["token"]


# ── Phone-suffix cross-gym ambiguity ──────────────────────────────────────

def test_request_otp_cross_gym_ambiguity_rejected(client, app, seed_gym):
    """Same 10-digit suffix in two gyms → 409, not an arbitrary .first()."""
    gym1 = seed_gym["gym"]
    plan = seed_gym["plan"]

    gym2 = Gym(
        name="Second Gym",
        slug="second-gym",
        email="owner@second.com",
        phone="+919876543211",
        status="active",
        subscription_status="trial",
        trial_ends_at=date.today() + timedelta(days=DEFAULT_TRIAL_DAYS),
        max_members=50,
    )
    db.session.add(gym2)
    db.session.flush()
    plan2 = MembershipPlan(gym_id=gym2.id, name="Monthly", duration_days=30, price=1000)
    db.session.add(plan2)
    db.session.flush()

    shared_suffix = "9876543210"
    m1 = Member(
        gym_id=gym1.id, plan_id=plan.id, full_name="Gym1 Member",
        phone=f"+91{shared_suffix}", status="active",
        membership_start=date.today(), membership_end=date.today() + timedelta(days=30),
    )
    m2 = Member(
        gym_id=gym2.id, plan_id=plan2.id, full_name="Gym2 Member",
        phone=f"+1{shared_suffix}", status="active",
        membership_start=date.today(), membership_end=date.today() + timedelta(days=30),
    )
    db.session.add_all([m1, m2])
    db.session.commit()

    res = client.post(
        "/api/member/v1/auth/request-otp", json={"phone": f"+91{shared_suffix}"}
    )
    assert res.status_code == 409
    assert res.json["success"] is False
