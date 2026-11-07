"""Fix-all v7 — backend/security findings (worker A2).

V7-M3 (Medium): temp passwords stored in plaintext in the idempotency
    replay table forever + no forced rotation on mobile.
V7-L3 (Low): synthetic test member looked up by phone only.
V7-L4 (Low): MobileIdempotencyKey rows never expire.
V7-L5 (Low): create_staff accepted owner-supplied passwords as short as
    6 chars.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, MobileIdempotencyKey, User
from app.models.member import (
    SYNTHETIC_TEST_MEMBER_NAME,
    SYNTHETIC_TEST_MEMBER_PHONE,
)
from app.models.mixins import utcnow
from app.services.idempotency_service import (
    IDEMPOTENCY_TTL,
    is_expired,
    prune_expired_idempotency_keys,
)


def _owner_headers(seed_gym, key: str | None = None) -> dict[str, str]:
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    token = create_access_token(owner.id, gym.id, owner.role)
    headers = {"Authorization": f"Bearer {token}"}
    if key is not None:
        headers["Idempotency-Key"] = key
    return headers


def _create_staff(client, seed_gym, email="staff1@testgym.com", **extra):
    payload = {"full_name": "Test Staff", "email": email, **extra}
    return client.post(
        "/api/mobile/v1/staff",
        headers=_owner_headers(seed_gym),
        json=payload,
    )


@pytest.fixture
def super_admin(app, seed_gym):
    admin = User(
        email="superadmin@test.com",
        full_name="Platform Super Admin",
        role="super_admin",
        is_active=True,
    )
    admin.set_password("AdminPass123!")
    db.session.add(admin)
    db.session.commit()
    return admin


def _web_login(client, email, password):
    return client.post(
        "/auth/login",
        data={"email": email, "password": password},
        follow_redirects=True,
    )


# --- V7-M3: encrypted replay, same password on retry ---------------------

def test_staff_create_replay_returns_same_password_and_stores_it_encrypted(
    client, seed_gym
):
    headers = _owner_headers(seed_gym, "v7m3-staff-retry-001")
    payload = {"full_name": "Test Staff", "email": "staff1@testgym.com"}

    first = client.post("/api/mobile/v1/staff", headers=headers, json=payload)
    second = client.post("/api/mobile/v1/staff", headers=headers, json=payload)

    assert first.status_code == 201, first.get_json()
    assert second.status_code == 201
    assert first.get_json() == second.get_json()
    temp_password = first.get_json()["data"]["temp_password"]
    assert temp_password
    assert User.query.filter_by(email="staff1@testgym.com").count() == 1

    row = MobileIdempotencyKey.query.filter_by(scope="create_staff").one()
    stored = json.dumps(row.response_body)
    # The plaintext password must NOT be in the stored row; the encrypted
    # form must be. That includes the invite URL, which embeds the
    # password in clear text (V7-M3 follow-up: encrypting only
    # temp_password still left it recoverable from the URL).
    assert temp_password not in stored
    assert "enc1:" in stored
    assert row.response_body["data"]["temp_password"].startswith("enc1:")
    assert row.response_body["data"]["invite_whatsapp_url"].startswith("enc1:")
    # The row carries a 24h expiry.
    assert row.expires_at is not None
    assert not is_expired(row)


def test_staff_reset_replay_returns_same_password_and_stores_it_encrypted(
    client, seed_gym
):
    assert _create_staff(client, seed_gym).status_code == 201
    staff = User.query.filter_by(email="staff1@testgym.com").one()
    headers = _owner_headers(seed_gym, "v7m3-reset-retry-001")

    first = client.post(
        f"/api/mobile/v1/staff/{staff.id}/reset-password",
        headers=headers,
        json={},
    )
    second = client.post(
        f"/api/mobile/v1/staff/{staff.id}/reset-password",
        headers=headers,
        json={},
    )

    assert first.status_code == 200, first.get_json()
    assert second.status_code == 200
    assert first.get_json() == second.get_json()
    new_password = first.get_json()["data"]["new_password"]
    assert new_password
    row = MobileIdempotencyKey.query.filter_by(
        scope="reset_staff_password"
    ).one()
    assert new_password not in json.dumps(row.response_body)
    assert "enc1:" in json.dumps(row.response_body)
    assert row.response_body["data"]["new_password"].startswith("enc1:")
    assert row.response_body["data"]["invite_whatsapp_url"].startswith("enc1:")
    assert row.expires_at is not None


def test_undecryptable_replay_row_is_treated_as_expired_not_a_crash(
    client, seed_gym
):
    headers = _owner_headers(seed_gym, "v7m3-undecryptable-001")
    payload = {"full_name": "Test Staff", "email": "staff1@testgym.com"}
    first = client.post("/api/mobile/v1/staff", headers=headers, json=payload)
    assert first.status_code == 201, first.get_json()

    # Simulate a key rotation without re-encryption: corrupt the stored
    # ciphertext so it can no longer be decrypted.
    row = MobileIdempotencyKey.query.filter_by(scope="create_staff").one()
    body = dict(row.response_body)
    body["data"] = dict(body["data"])
    body["data"]["temp_password"] = "enc1:garbage-not-a-fernet-token"
    row.response_body = body
    db.session.commit()

    # The retry must not 500 and must never return the ciphertext. The
    # row is treated as expired, the request executes fresh, and the
    # honest outcome is the duplicate-email 409 (the original password
    # is unrecoverable — the owner must reset it).
    retry = client.post("/api/mobile/v1/staff", headers=headers, json=payload)
    assert retry.status_code == 409, retry.get_json()
    assert "enc1:" not in retry.get_data(as_text=True)
    assert (
        MobileIdempotencyKey.query.filter_by(scope="create_staff").count()
        == 0
    )


# --- V7-M3: mobile login surfaces must_change_password -------------------

def test_mobile_login_surfaces_flag_and_change_password_clears_it(
    client, seed_gym
):
    res = _create_staff(client, seed_gym, email="staff2@testgym.com")
    assert res.status_code == 201, res.get_json()
    temp_password = res.get_json()["data"]["temp_password"]
    staff = User.query.filter_by(email="staff2@testgym.com").one()
    assert staff.must_change_password is True
    assert staff.is_temporary_password is True

    # Log in with the temp password: login succeeds (web parity — web
    # redirects to change-password rather than rejecting) but the
    # payload flags the account.
    login = client.post(
        "/api/mobile/v1/auth/login",
        json={"email": "staff2@testgym.com", "password": temp_password},
    )
    assert login.status_code == 200, login.get_json()
    assert login.get_json()["data"]["user"]["must_change_password"] is True
    assert login.get_json()["data"]["user"]["is_temporary_password"] is True
    token = login.get_json()["data"]["access_token"]

    me = client.get(
        "/api/mobile/v1/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.get_json()["data"]["user"]["must_change_password"] is True

    # Wrong current password / weak new password are rejected.
    bad = client.post(
        "/api/mobile/v1/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": "nope", "new_password": "NewStrongPass123!"},
    )
    assert bad.status_code == 403
    weak = client.post(
        "/api/mobile/v1/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": temp_password, "new_password": "short"},
    )
    assert weak.status_code == 400

    changed = client.post(
        "/api/mobile/v1/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "current_password": temp_password,
            "new_password": "NewStrongPass123!",
        },
    )
    assert changed.status_code == 200, changed.get_json()

    login2 = client.post(
        "/api/mobile/v1/auth/login",
        json={"email": "staff2@testgym.com", "password": "NewStrongPass123!"},
    )
    assert login2.status_code == 200, login2.get_json()
    assert login2.get_json()["data"]["user"]["must_change_password"] is False
    assert login2.get_json()["data"]["user"]["is_temporary_password"] is False


def test_staff_reset_sets_must_change_password(client, seed_gym):
    assert _create_staff(client, seed_gym).status_code == 201
    staff = User.query.filter_by(email="staff1@testgym.com").one()
    res = client.post(
        f"/api/mobile/v1/staff/{staff.id}/reset-password",
        headers=_owner_headers(seed_gym),
        json={"new_password": "ResetStrong123!"},
    )
    assert res.status_code == 200, res.get_json()
    db.session.refresh(staff)
    assert staff.must_change_password is True
    assert staff.is_temporary_password is True


# --- V7-L5: 12-char + complexity on owner-supplied staff passwords ------

@pytest.mark.parametrize(
    "password",
    [
        "abc123",  # old 6-char minimum would have passed
        "Short1!",  # 7 chars
        "alllowercase1!",  # no upper
        "ALLUPPERCASE1!",  # no lower
        "NoDigitsHere!!",  # no digit
        "NoSymbol12345",  # no symbol
    ],
)
def test_create_staff_rejects_weak_owner_passwords(client, seed_gym, password):
    res = _create_staff(
        client, seed_gym, email=f"weak-{password[:4]}@testgym.com",
        password=password,
    )
    assert res.status_code == 400, res.get_json()
    assert User.query.filter_by(email=f"weak-{password[:4]}@testgym.com").count() == 0


def test_create_staff_accepts_strong_owner_password(client, seed_gym):
    res = _create_staff(
        client, seed_gym, password="ValidOwnerPass123!"
    )
    assert res.status_code == 201, res.get_json()
    staff = User.query.filter_by(email="staff1@testgym.com").one()
    assert staff.check_password("ValidOwnerPass123!")


def test_staff_reset_rejects_weak_password(client, seed_gym):
    res = _create_staff(client, seed_gym)
    assert res.status_code == 201, res.get_json()
    temp_password = res.get_json()["data"]["temp_password"]
    staff = User.query.filter_by(email="staff1@testgym.com").one()
    res = client.post(
        f"/api/mobile/v1/staff/{staff.id}/reset-password",
        headers=_owner_headers(seed_gym),
        json={"new_password": "abc123"},
    )
    assert res.status_code == 400
    res = client.post(
        f"/api/mobile/v1/staff/{staff.id}/reset-password",
        headers=_owner_headers(seed_gym),
        json={"new_password": "NoSymbol12345"},
    )
    assert res.status_code == 400
    # The failed resets changed nothing — the original temp password
    # still works and the create-time flag is intact.
    db.session.refresh(staff)
    assert staff.check_password(temp_password) is True
    assert staff.must_change_password is True


# --- V7-L4: TTL / prune ---------------------------------------------------

def test_expired_idempotency_row_is_not_replayed(client, seed_gym, seed_member):
    headers = _owner_headers(seed_gym, "v7l4-freeze-expire-001")
    original_end = seed_member.membership_end

    first = client.post(
        f"/api/mobile/v1/members/{seed_member.id}/freeze",
        headers=headers,
        json={"days": 14},
    )
    assert first.status_code == 200, first.get_json()

    # Replay within TTL: executes once.
    second = client.post(
        f"/api/mobile/v1/members/{seed_member.id}/freeze",
        headers=headers,
        json={"days": 14},
    )
    assert second.status_code == 200
    assert first.get_json() == second.get_json()
    assert (
        Member.query.get(seed_member.id).membership_end
        == original_end + timedelta(days=14)
    )

    # Expire the row, then retry with the same key: it must execute
    # fresh (a second freeze), not replay the stale response. Unfreeze
    # first — freeze refuses an already-paused member.
    row = MobileIdempotencyKey.query.filter_by(key="v7l4-freeze-expire-001").one()
    row.expires_at = utcnow() - timedelta(seconds=1)
    db.session.commit()
    assert is_expired(row) is True

    unfreeze = client.post(
        f"/api/mobile/v1/members/{seed_member.id}/unfreeze",
        headers=_owner_headers(seed_gym),
    )
    assert unfreeze.status_code == 200, unfreeze.get_json()
    # V7-L6 (pause-the-clock, A3's fix): unfreeze on the same day claws
    # back all 14 unused days, so the end is back to the original.
    db.session.expire_all()
    assert Member.query.get(seed_member.id).membership_end == original_end

    third = client.post(
        f"/api/mobile/v1/members/{seed_member.id}/freeze",
        headers=headers,
        json={"days": 14},
    )
    assert third.status_code == 200, third.get_json()
    assert third.get_json() != first.get_json()
    # Fresh execution after expiry: a second real freeze, +14 from the
    # (clawed-back) original end — NOT original + 28, because the first
    # freeze's 14 days were returned by the same-day unfreeze.
    db.session.expire_all()
    assert (
        Member.query.get(seed_member.id).membership_end
        == original_end + timedelta(days=14)
    )


def test_prune_expired_idempotency_keys_deletes_only_expired(app, seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    expired = MobileIdempotencyKey(
        gym_id=gym.id,
        user_id=owner.id,
        scope="test_scope",
        key="expired-row",
        request_hash="x" * 64,
        status_code=200,
        response_body={"success": True},
        expires_at=utcnow() - timedelta(hours=1),
    )
    legacy_expired = MobileIdempotencyKey(
        gym_id=gym.id,
        user_id=owner.id,
        scope="test_scope",
        key="legacy-row",
        request_hash="y" * 64,
        status_code=200,
        response_body={"success": True},
        expires_at=None,  # pre-migration row
        created_at=utcnow() - IDEMPOTENCY_TTL - timedelta(hours=1),
    )
    fresh = MobileIdempotencyKey(
        gym_id=gym.id,
        user_id=owner.id,
        scope="test_scope",
        key="fresh-row",
        request_hash="z" * 64,
        status_code=200,
        response_body={"success": True},
        expires_at=utcnow() + timedelta(hours=1),
    )
    db.session.add_all([expired, legacy_expired, fresh])
    db.session.commit()

    assert is_expired(expired) is True
    assert is_expired(legacy_expired) is True
    assert is_expired(fresh) is False

    pruned = prune_expired_idempotency_keys()
    db.session.commit()
    assert pruned == 2
    assert MobileIdempotencyKey.query.filter_by(key="expired-row").count() == 0
    assert MobileIdempotencyKey.query.filter_by(key="legacy-row").count() == 0
    assert MobileIdempotencyKey.query.filter_by(key="fresh-row").count() == 1


# --- V7-L3: synthetic member marker + reserved phone ---------------------

def test_create_member_rejects_reserved_test_phone(client, seed_gym):
    res = client.post(
        "/api/mobile/v1/members",
        headers=_owner_headers(seed_gym),
        json={
            "full_name": "Real Person",
            "phone": SYNTHETIC_TEST_MEMBER_PHONE,
        },
    )
    assert res.status_code == 400, res.get_json()
    assert (
        Member.query.filter_by(phone=SYNTHETIC_TEST_MEMBER_PHONE).count()
        == 0
    )


def test_batch_create_rejects_reserved_test_phone(client, seed_gym):
    res = client.post(
        "/api/mobile/v1/members/batch-create",
        headers=_owner_headers(seed_gym),
        json={
            "members": [
                {
                    "name": "Real Person",
                    "phone": SYNTHETIC_TEST_MEMBER_PHONE,
                    "plan_id": seed_gym["plan"].id,
                }
            ]
        },
    )
    assert res.status_code == 422, res.get_json()
    assert (
        Member.query.filter_by(phone=SYNTHETIC_TEST_MEMBER_PHONE).count()
        == 0
    )


def test_update_member_phone_rejects_reserved_test_phone(
    client, seed_gym, seed_member
):
    res = client.patch(
        f"/api/mobile/v1/members/{seed_member.id}",
        headers=_owner_headers(seed_gym),
        json={"phone": SYNTHETIC_TEST_MEMBER_PHONE},
    )
    assert res.status_code == 400, res.get_json()
    assert Member.query.get(seed_member.id).phone != SYNTHETIC_TEST_MEMBER_PHONE


def test_admin_test_payment_ignores_real_member_with_reserved_phone(
    client, seed_gym, super_admin
):
    # A real member carrying the reserved phone (e.g. created before the
    # blocklist, or via a direct DB row) must NEVER be picked up by the
    # test-payment flow — the lookup now requires the synthetic name too.
    gym = seed_gym["gym"]
    real = Member(
        gym_id=gym.id,
        plan_id=seed_gym["plan"].id,
        full_name="Real Person",
        phone=SYNTHETIC_TEST_MEMBER_PHONE,
        membership_start=date.today() - timedelta(days=30),
        membership_end=date.today() - timedelta(days=1),
        status="expired",
    )
    db.session.add(real)
    db.session.commit()
    real_end = real.membership_end

    _web_login(client, "superadmin@test.com", "AdminPass123!")
    res = client.post(
        f"/admin/gyms/{gym.id}/test-payment-renewal",
        follow_redirects=True,
    )
    assert res.status_code == 200, res.data

    db.session.refresh(real)
    assert real.membership_end == real_end  # untouched
    synth = Member.query.filter_by(
        gym_id=gym.id,
        phone=SYNTHETIC_TEST_MEMBER_PHONE,
        full_name=SYNTHETIC_TEST_MEMBER_NAME,
    ).first()
    assert synth is not None
    assert synth.id != real.id
    assert synth.device_enroll_number is None
