"""Fix-all v8 — backend/security findings (worker A1).

V8-M1: staff cannot rewrite the gym's UPI ID (owner-only writes).
V8-M2: staff cannot create/verify a ₹0 auto-verified payment.
V8-M3: web password paths use the shared 12-char + complexity policy.
V8-L1: CSV import blocklists the synthetic test member phone.
V8-L2: no plaintext credentials in the Flask session cookie (one-time,
    Fernet-encrypted, popped on first read).
V8-L3: OTP challenge is consumed on verify; member refresh families capped.
V8-L4: access tokens die on password change / logout-all (token version).
V8-L5: legacy idempotency replay paths decrypt via replay_response_body.
"""
from __future__ import annotations

import hashlib
import hmac
import io
import json
import re
import time
from datetime import date, timedelta

import pytest

from app.extensions import db
from app.mobile_api.member_api import _normalize_phone, _sign_otp_challenge
from app.mobile_api.token_service import (
    _b64url_encode,
    _token_secret,
    create_access_token,
    create_member_refresh_token,
    decode_access_token,
)
from app.models import Gym, Member, MobileIdempotencyKey, User
from app.models.member import (
    SYNTHETIC_TEST_MEMBER_NAME,
    SYNTHETIC_TEST_MEMBER_PHONE,
)
from app.services.idempotency_service import legacy_replay, request_fingerprint
from app.utils.helpers import password_policy_error
from app.utils.token_encryption import encrypt_token


# ── helpers ──────────────────────────────────────────────────────────────

def _owner_headers(seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, gym.id, owner.role)}"}


def _make_staff(seed_gym, email="staff1@testgym.com"):
    staff = User(
        gym_id=seed_gym["gym"].id,
        email=email,
        full_name="Test Staff",
        role="staff",
        is_active=True,
    )
    staff.set_password("StaffPass123!")
    db.session.add(staff)
    db.session.commit()
    return staff


def _staff_headers(seed_gym, staff=None):
    if staff is None:
        staff = seed_gym.get("_v8_staff")
        if staff is None:
            staff = _make_staff(seed_gym)
            seed_gym["_v8_staff"] = staff
    gym = seed_gym["gym"]
    return {"Authorization": f"Bearer {create_access_token(staff.id, gym.id, staff.role)}"}


def _web_login(client, email, password):
    return client.post(
        "/auth/login",
        data={"email": email, "password": password},
        follow_redirects=True,
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


def _payment_payload(seed_member, amount, auto_verify=False):
    return {
        "member_id": seed_member.id,
        "amount": str(amount),
        "method": "cash",
        "channel": "offline",
        "renewal_days": 30,
        "auto_verify": auto_verify,
    }


# ── V8-M1: UPI ID is owner-only ──────────────────────────────────────────

def test_staff_cannot_rewrite_upi_id(client, seed_gym):
    res = client.put(
        "/api/mobile/v1/settings/payment",
        headers=_staff_headers(seed_gym),
        json={"upi_id": "attacker@okaxis"},
    )
    assert res.status_code == 403, res.get_json()
    from app.models import QRSettings

    qr = QRSettings.query.filter_by(gym_id=seed_gym["gym"].id).first()
    assert qr is None or qr.upi_id != "attacker@okaxis"


def test_owner_can_rewrite_upi_id_and_staff_can_still_read(client, seed_gym):
    res = client.get("/api/mobile/v1/settings/payment", headers=_staff_headers(seed_gym))
    assert res.status_code == 200, res.get_json()

    res = client.put(
        "/api/mobile/v1/settings/payment",
        headers=_owner_headers(seed_gym),
        json={"upi_id": "owner@okaxis"},
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["data"]["upi_id"] == "owner@okaxis"


# ── V8-M2: ₹0 auto-verify blocked ────────────────────────────────────────

def test_staff_zero_amount_auto_verify_rejected(client, seed_gym, seed_member):
    res = client.post(
        "/api/mobile/v1/payments",
        headers=_staff_headers(seed_gym),
        json=_payment_payload(seed_member, 0, auto_verify=True),
    )
    assert res.status_code == 400, res.get_json()
    assert "greater than zero" in res.get_json()["error"]["message"]


def test_staff_zero_amount_two_step_verify_rejected_but_owner_can_verify(
    client, seed_gym, seed_member
):
    res = client.post(
        "/api/mobile/v1/payments",
        headers=_staff_headers(seed_gym),
        json=_payment_payload(seed_member, 0, auto_verify=False),
    )
    assert res.status_code == 201, res.get_json()
    payment_id = res.get_json()["data"]["id"]

    res = client.post(
        f"/api/mobile/v1/payments/{payment_id}/verify",
        headers=_staff_headers(seed_gym),
        json={},
    )
    assert res.status_code == 403, res.get_json()

    res = client.post(
        f"/api/mobile/v1/payments/{payment_id}/verify",
        headers=_owner_headers(seed_gym),
        json={},
    )
    assert res.status_code == 200, res.get_json()


def test_staff_cash_auto_verify_still_works_for_real_amount(
    client, seed_gym, seed_member
):
    res = client.post(
        "/api/mobile/v1/payments",
        headers=_staff_headers(seed_gym),
        json=_payment_payload(seed_member, 100, auto_verify=True),
    )
    assert res.status_code == 201, res.get_json()
    assert res.get_json()["data"]["status"] == "verified"


# ── V8-M3: web password policy ───────────────────────────────────────────

def test_web_register_rejects_weak_password(client, seed_gym):
    res = client.post(
        "/auth/register",
        data={
            "gym_name": "Weak Gym",
            "owner_name": "Weak Owner",
            "email": "weak@testgym.com",
            "phone": "+919876543211",
            "password": "Short1!",
            "confirm_password": "Short1!",
        },
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert User.query.filter_by(email="weak@testgym.com").first() is None


def test_web_change_password_rejects_policy_violations(client, seed_gym):
    _web_login(client, "owner@testgym.com", "SecurePass123!")
    # 12 chars but no symbol — the old form rule (min 10 + strength
    # without lowercase) would have accepted a sibling of this.
    res = client.post(
        "/auth/change-password",
        data={
            "current_password": "SecurePass123!",
            "new_password": "NoSymbol1234",
            "confirm_new_password": "NoSymbol1234",
        },
        follow_redirects=True,
    )
    assert res.status_code == 200
    owner = User.query.filter_by(email="owner@testgym.com").first()
    assert owner.check_password("SecurePass123!") is True


def test_super_admin_reset_rejects_weak_password_and_never_flashes_it(
    client, seed_gym, super_admin
):
    _web_login(client, "superadmin@test.com", "AdminPass123!")
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    res = client.post(
        f"/admin/gyms/{gym.id}/users/{owner.id}/reset-password",
        data={"new_password": "weakpass1"},
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert b"weakpass1" not in res.data
    db.session.refresh(owner)
    assert owner.check_password("SecurePass123!") is True


def test_super_admin_reset_generated_password_shown_once_only(
    client, seed_gym, super_admin
):
    _web_login(client, "superadmin@test.com", "AdminPass123!")
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    res = client.post(
        f"/admin/gyms/{gym.id}/users/{owner.id}/reset-password",
        data={},
        follow_redirects=True,
    )
    assert res.status_code == 200
    # The generated password is shown once on the staff tab, never in
    # a flash message.
    assert b"Temporary password for owner@testgym.com" in res.data
    match = re.search(
        rb"Temporary password for owner@testgym\.com \(shown once[^<]*</strong>\s*<code[^>]*>([^<]+)</code>",
        res.data,
    )
    assert match, "one-time temp password not rendered"
    generated = match.group(1).decode()
    assert password_policy_error(generated) is None
    db.session.refresh(owner)
    assert owner.check_password(generated) is True

    # Second visit: popped — the password is gone.
    res2 = client.get(f"/admin/gyms/{gym.id}?tab=staff")
    assert res2.status_code == 200
    assert generated.encode() not in res2.data


def test_onboarding_temp_password_must_meet_policy(client, seed_gym, super_admin):
    _web_login(client, "superadmin@test.com", "AdminPass123!")
    gym = Gym(
        name="Onboard Gym",
        slug="onboard-gym",
        email="onboard@testgym.com",
        phone="+919876543212",
        status="active",
        subscription_status="trial",
        trial_ends_at=date.today() + timedelta(days=14),
    )
    db.session.add(gym)
    db.session.commit()
    res = client.post(
        f"/admin/gyms/onboard/{gym.id}/step/2",
        data={
            "owner_name": "Onboard Owner",
            "owner_email": "onboard-owner@testgym.com",
            "owner_phone": "+919876543213",
            "temp_password": "weak",
        },
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert User.query.filter_by(email="onboard-owner@testgym.com").first() is None

    res = client.post(
        f"/admin/gyms/onboard/{gym.id}/step/2",
        data={
            "owner_name": "Onboard Owner",
            "owner_email": "onboard-owner@testgym.com",
            "owner_phone": "+919876543213",
            "temp_password": "OnboardPass123!",
        },
        follow_redirects=True,
    )
    assert res.status_code == 200
    owner = User.query.filter_by(email="onboard-owner@testgym.com").first()
    assert owner is not None
    assert owner.check_password("OnboardPass123!") is True


def test_generated_temp_passwords_satisfy_policy():
    from app.admin.routes import _generate_temp_password

    for _ in range(20):
        assert password_policy_error(_generate_temp_password()) is None
        assert password_policy_error(_generate_temp_password(12)) is None


# ── V8-L1: CSV import synthetic blocklist ────────────────────────────────

def test_csv_import_rejects_synthetic_test_member(client, seed_gym):
    _web_login(client, "owner@testgym.com", "SecurePass123!")
    today = date.today()
    csv_text = (
        "full_name,phone,membership_start,membership_end\n"
        f"{SYNTHETIC_TEST_MEMBER_NAME},{SYNTHETIC_TEST_MEMBER_PHONE},{today.isoformat()},{(today + timedelta(days=30)).isoformat()}\n"
        f"Real Member,+919876500099,{today.isoformat()},{(today + timedelta(days=30)).isoformat()}\n"
    )
    res = client.post(
        "/members/import",
        data={"csv_file": (io.BytesIO(csv_text.encode()), "members.csv")},
        content_type="multipart/form-data",
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert (
        Member.query.filter_by(
            gym_id=seed_gym["gym"].id, phone=SYNTHETIC_TEST_MEMBER_PHONE
        ).count()
        == 0
    )
    assert (
        Member.query.filter_by(gym_id=seed_gym["gym"].id, phone="+919876500099").count()
        == 1
    )


# ── V8-L2: one-time secrets ──────────────────────────────────────────────

def test_pairing_code_shown_once_then_masked(client, seed_gym, super_admin):
    _web_login(client, "superadmin@test.com", "AdminPass123!")
    gym = seed_gym["gym"]
    res = client.post(
        f"/admin/gyms/{gym.id}/bridge/generate-pairing", follow_redirects=True
    )
    assert res.status_code == 200
    # The flash must not carry the code in clear.
    assert b"Biometric Pairing Code generated" in res.data
    match = re.search(
        rb'<div class="h2 fw-bold font-monospace text-primary mb-1">(\d{6})</div>',
        res.data,
    )
    assert match, "pairing code not rendered once on the biometric tab"
    code = match.group(1).decode()

    res2 = client.get(f"/admin/gyms/{gym.id}?tab=biometric")
    assert res2.status_code == 200
    assert code.encode() not in res2.data
    assert "••••••".encode() in res2.data


def test_rotated_bridge_key_shown_once_then_gone(client, seed_gym, super_admin):
    from app.models.bridge import BridgeInstallation

    _web_login(client, "superadmin@test.com", "AdminPass123!")
    gym = seed_gym["gym"]
    bridge, _key = BridgeInstallation.create_for_gym(
        gym_id=gym.id, display_name="Test Bridge", device_serial="TEST-SN-001"
    )
    db.session.add(bridge)
    db.session.commit()
    res = client.post(
        f"/admin/gyms/{gym.id}/bridge/rotate-key", follow_redirects=True
    )
    assert res.status_code == 200
    match = re.search(
        rb"Bridge API Key rotated \(shown once[^<]*</strong>\s*<code[^>]*>([^<]+)</code>",
        res.data,
    )
    assert match, "rotated key not rendered once on the biometric tab"
    raw_key = match.group(1).decode()
    res2 = client.get(f"/admin/gyms/{gym.id}?tab=biometric")
    assert raw_key.encode() not in res2.data


def test_one_time_secret_store_is_encrypted_in_session(client, seed_gym, super_admin):
    """The session cookie must never carry a plaintext credential."""
    _web_login(client, "superadmin@test.com", "AdminPass123!")
    gym = seed_gym["gym"]
    with client.session_transaction() as sess:
        assert not any(
            k.startswith(("temp_pass_", "bridge_key_", "bridge_pairing_"))
            for k in sess.keys()
        )
    # Generate a pairing code without following the redirect: the
    # cookie set by the POST must hold ciphertext, not the code.
    res = client.post(f"/admin/gyms/{gym.id}/bridge/generate-pairing")
    assert res.status_code == 302
    with client.session_transaction() as sess:
        stored = sess.get(f"bridge_pairing_{gym.id}")
        assert stored is not None
        assert stored.startswith("enc1:")
        assert len(stored) > 20


# ── V8-L3: OTP consumption + family cap ──────────────────────────────────

def test_otp_cannot_be_reused_for_a_second_session(client, seed_member):
    member = seed_member
    phone = _normalize_phone(member.phone)
    challenge = _sign_otp_challenge(
        phone, member.id, member.gym_id, "000002", int(time.time()) + 600
    )
    first = client.post(
        "/api/member/v1/auth/verify-otp",
        json={"phone": phone, "otp": "000002", "challenge": challenge},
    )
    assert first.status_code == 200, first.get_json()
    assert first.get_json()["data"]["token"]

    second = client.post(
        "/api/member/v1/auth/verify-otp",
        json={"phone": phone, "otp": "000002", "challenge": challenge},
    )
    assert second.status_code in (400, 429), second.get_json()
    assert second.get_json()["success"] is False


def test_member_refresh_families_capped_at_five(client, seed_member):
    from app.models import MemberRefreshToken

    member = seed_member
    for _ in range(6):
        create_member_refresh_token(member.id, member.gym_id)
    db.session.commit()
    assert (
        db.session.query(MemberRefreshToken.family_id)
        .filter_by(member_id=member.id)
        .distinct()
        .count()
        == 6
    )

    phone = _normalize_phone(member.phone)
    challenge = _sign_otp_challenge(
        phone, member.id, member.gym_id, "000003", int(time.time()) + 600
    )
    res = client.post(
        "/api/member/v1/auth/verify-otp",
        json={"phone": phone, "otp": "000003", "challenge": challenge},
    )
    assert res.status_code == 200, res.get_json()
    new_refresh = res.get_json()["data"]["refresh_token"]
    new_family = MemberRefreshToken.query.filter_by(
        token_hash=hashlib.sha256(new_refresh.encode()).hexdigest()
    ).first()
    assert new_family is not None
    families = {
        row[0]
        for row in db.session.query(MemberRefreshToken.family_id)
        .filter_by(member_id=member.id)
        .distinct()
        .all()
    }
    assert len(families) == 5
    assert new_family.family_id in families


# ── V8-L4: token version ─────────────────────────────────────────────────

def test_logout_all_kills_outstanding_access_token(client, seed_gym):
    headers = _owner_headers(seed_gym)
    assert client.get("/api/mobile/v1/me", headers=headers).status_code == 200
    res = client.post("/api/mobile/v1/auth/logout-all", headers=headers, json={})
    assert res.status_code == 200, res.get_json()
    assert client.get("/api/mobile/v1/me", headers=headers).status_code == 401
    # A fresh token (new login / refresh) works again.
    assert (
        client.get("/api/mobile/v1/me", headers=_owner_headers(seed_gym)).status_code
        == 200
    )


def test_password_change_kills_outstanding_access_token(client, seed_gym):
    headers = _owner_headers(seed_gym)
    assert client.get("/api/mobile/v1/me", headers=headers).status_code == 200
    res = client.post(
        "/api/mobile/v1/auth/change-password",
        headers=headers,
        json={
            "current_password": "SecurePass123!",
            "new_password": "NewSecurePass123!",
        },
    )
    assert res.status_code == 200, res.get_json()
    assert client.get("/api/mobile/v1/me", headers=headers).status_code == 401
    assert (
        client.get("/api/mobile/v1/me", headers=_owner_headers(seed_gym)).status_code
        == 200
    )


def test_pre_version_token_without_ver_claim_is_rejected(client, seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    now = int(time.time())
    payload = {
        "sub": owner.id,
        "gym_id": gym.id,
        "role": owner.role,
        "iat": now,
        "exp": now + 900,
    }
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64url_encode(json.dumps(payload).encode())
    sig = hmac.new(
        _token_secret().encode(), f"{header}.{body}".encode(), hashlib.sha256
    ).digest()
    token = f"{header}.{body}.{_b64url_encode(sig)}"
    assert decode_access_token(token) is not None  # signature + expiry valid
    res = client.get(
        "/api/mobile/v1/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 401


def test_member_token_unaffected_by_user_token_version(client, seed_member):
    token = create_access_token(
        seed_member.id, seed_member.gym_id, "member"
    )
    res = client.get(
        "/api/member/v1/dashboard",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.get_json()


# ── V8-L5: legacy replay decrypts ────────────────────────────────────────

def test_legacy_replay_decrypts_encrypted_password(app):
    from app.models import MobileIdempotencyKey

    with app.app_context():
        record = MobileIdempotencyKey(
            gym_id=1,
            user_id=1,
            scope="create_staff",
            key="v8l5-unit",
            request_hash="abc",
            status_code=201,
            response_body={
                "success": True,
                "data": {"temp_password": "enc1:" + encrypt_token("SecretPass123!")},
            },
        )
        db.session.add(record)
        db.session.commit()
        resp = legacy_replay(record, True)
        assert resp is not None
        body, status = resp
        assert status == 201
        assert body.get_json()["data"]["temp_password"] == "SecretPass123!"
        assert "enc1:" not in body.get_data(as_text=True)


def test_legacy_replay_drops_undecryptable_row(app):
    from app.models import MobileIdempotencyKey

    with app.app_context():
        record = MobileIdempotencyKey(
            gym_id=1,
            user_id=1,
            scope="create_staff",
            key="v8l5-unit-bad",
            request_hash="abc",
            status_code=201,
            response_body={
                "success": True,
                "data": {"temp_password": "enc1:garbage-not-a-fernet-token"},
            },
        )
        db.session.add(record)
        db.session.commit()
        assert legacy_replay(record, True) is None
        assert (
            MobileIdempotencyKey.query.filter_by(key="v8l5-unit-bad").first()
            is None
        )


def test_create_member_with_undecryptable_replay_row_executes_fresh(
    client, seed_gym
):
    from app.models import MobileIdempotencyKey

    payload = {
        "full_name": "Fresh Replay",
        "phone": "+919876500077",
        "plan_id": seed_gym["plan"].id,
    }
    key = "v8l5-create-member-001"
    record = MobileIdempotencyKey(
        gym_id=seed_gym["gym"].id,
        user_id=seed_gym["owner"].id,
        scope="create_member",
        key=key,
        request_hash=request_fingerprint(payload),
        status_code=201,
        response_body={
            "success": True,
            "data": {"id": 9999, "temp_password": "enc1:garbage-not-a-fernet-token"},
        },
    )
    db.session.add(record)
    db.session.commit()

    res = client.post(
        "/api/mobile/v1/members",
        headers={**_owner_headers(seed_gym), "Idempotency-Key": key},
        json=payload,
    )
    assert res.status_code == 201, res.get_json()
    assert res.get_json()["data"]["id"] != 9999
    assert "enc1:" not in res.get_data(as_text=True)
    assert (
        Member.query.filter_by(
            gym_id=seed_gym["gym"].id, phone="+919876500077"
        ).count()
        == 1
    )
