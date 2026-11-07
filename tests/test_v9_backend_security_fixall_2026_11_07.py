"""Fix-all v9 — backend/security findings (worker A1).

V9-M1: legacy ADMS path token must not reach staff reads of
    /rrr/integrations (or the staff-reachable RRR/owner dashboards
    that embed the same payload) — owner-only for the token field.
V9-M2: plaintext bridge key flashed in the clear at bridge creation
    (missed V8-L2 site) — Fernet-encrypted one-time store + pop-on-
    read, never in a flash.
V9-L1: owner refresh rotation must not commit a fresh refresh token
    for a disabled account.
V9-L2: request-otp must not distinguish unknown / staff / multi-gym /
    member phones (enumeration oracle) — one uniform 200 + generic
    message, challenge only for a matched member.
V9-L3: raw exception text must not reach API clients — fixed generic
    messages, detail logged server-side (spot-checked here).
V9-L4: POST /profile/photo honours Idempotency-Key (scope
    profile_photo_upload, SHA-256 fingerprint) — same-key replay
    returns the same URL with no second file.
V9-L5: one owner cannot demote/deactivate/remove ANOTHER owner —
    only a super-admin can; self-demote/self-deactivate stay blocked.
"""
from __future__ import annotations

import io
import re
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token, create_refresh_token
from app.models import Gym, Member, MembershipPlan, MobileRefreshToken, User
from app.models.gym import DEFAULT_TRIAL_DAYS
from app.models.rrr import RRRIntegration


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
        staff = seed_gym.get("_v9_staff")
        if staff is None:
            staff = _make_staff(seed_gym)
            seed_gym["_v9_staff"] = staff
    gym = seed_gym["gym"]
    return {"Authorization": f"Bearer {create_access_token(staff.id, gym.id, staff.role)}"}


def _make_second_owner(seed_gym, email="owner2@testgym.com"):
    owner2 = User(
        gym_id=seed_gym["gym"].id,
        email=email,
        full_name="Second Owner",
        role="gym_owner",
        is_active=True,
    )
    owner2.set_password("Owner2Pass123!")
    db.session.add(owner2)
    db.session.commit()
    return owner2


def _member_headers(seed_member):
    return {"Authorization": f"Bearer {create_access_token(seed_member.id, seed_member.gym_id, 'member')}"}


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


def _legacy_adms_row(seed_gym, token="legacy-token-abc123"):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="Test Terminal",
        status="connected",
        device_serial="TEST-SN-999",
        adms_path_token=token,
    )
    db.session.add(row)
    db.session.commit()
    return row


def _jpeg_bytes(color):
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (10, 10), color=color).save(buf, format="JPEG")
    return buf.getvalue()


def _photo_files(member, app, tmp_path):
    photo_dir = (
        Path(app.config["UPLOAD_FOLDER"])
        / "member_profiles"
        / str(member.gym_id)
        / str(member.id)
    )
    return list(photo_dir.glob("*.jpg")) if photo_dir.exists() else []


# ── V9-M1: legacy ADMS path token is owner-only ──────────────────────────

def test_staff_integrations_get_has_no_legacy_adms_token(client, seed_gym):
    _legacy_adms_row(seed_gym)
    res = client.get("/api/mobile/v1/rrr/integrations", headers=_staff_headers(seed_gym))
    assert res.status_code == 200, res.get_json()
    assert "legacy-token-abc123" not in res.get_data(as_text=True)
    settings = res.get_json()["data"]["integrations"][0]["terminal_settings"]
    assert settings["path"] is None
    assert settings["token_present"] is True


def test_owner_integrations_get_keeps_legacy_adms_token(client, seed_gym):
    _legacy_adms_row(seed_gym)
    res = client.get("/api/mobile/v1/rrr/integrations", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_json()
    settings = res.get_json()["data"]["integrations"][0]["terminal_settings"]
    assert "legacy-token-abc123" in settings["path"]


def test_staff_rrr_dashboard_hides_legacy_adms_token(client, seed_gym, seed_member):
    _legacy_adms_row(seed_gym)
    res = client.get("/api/mobile/v1/rrr/dashboard", headers=_staff_headers(seed_gym))
    assert res.status_code == 200, res.get_json()
    assert "legacy-token-abc123" not in res.get_data(as_text=True)


def test_owner_rrr_dashboard_keeps_legacy_adms_token(client, seed_gym, seed_member):
    _legacy_adms_row(seed_gym)
    res = client.get("/api/mobile/v1/rrr/dashboard", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_json()
    assert "legacy-token-abc123" in res.get_data(as_text=True)


def test_staff_owner_today_hides_legacy_adms_token(client, seed_gym, seed_member):
    _legacy_adms_row(seed_gym)
    res = client.get("/api/mobile/v1/owner/today", headers=_staff_headers(seed_gym))
    assert res.status_code == 200, res.get_json()
    assert "legacy-token-abc123" not in res.get_data(as_text=True)


# ── V9-M2: bridge key at creation is encrypted + shown once ─────────────

def test_created_bridge_key_never_flashed_in_clear(client, seed_gym, super_admin):
    _web_login(client, "superadmin@test.com", "AdminPass123!")
    gym = seed_gym["gym"]

    # POST without following the redirect: the session cookie must
    # hold Fernet ciphertext, never the raw key.
    res = client.post(f"/admin/gyms/{gym.id}/bridge/create", data={"device_serial": "V9-SN-001"})
    assert res.status_code == 302
    with client.session_transaction() as sess:
        stored = sess.get(f"created_bridge_key_{gym.id}")
        assert stored is not None
        assert stored.startswith("enc1:")
        assert len(stored) > 20

    # Follow the redirect: the key is rendered once on the biometric
    # tab — and exactly once in the whole page (never also in a flash).
    res = client.get(f"/admin/gyms/{gym.id}?tab=biometric")
    assert res.status_code == 200
    match = re.search(
        rb"Bridge API Key generated \(shown once[^<]*</strong>\s*<code[^>]*>([^<]+)</code>",
        res.data,
    )
    assert match, "created bridge key not rendered once on the biometric tab"
    raw_key = match.group(1).decode()
    assert res.data.count(raw_key.encode()) == 1

    # Second visit: popped — the key is gone.
    res2 = client.get(f"/admin/gyms/{gym.id}?tab=biometric")
    assert res2.status_code == 200
    assert raw_key.encode() not in res2.data


def test_created_bridge_key_rotate_path_still_shows_once(client, seed_gym, super_admin):
    """Rotating a bridge created via the fixed endpoint still works."""
    _web_login(client, "superadmin@test.com", "AdminPass123!")
    gym = seed_gym["gym"]
    res = client.post(
        f"/admin/gyms/{gym.id}/bridge/create",
        data={"device_serial": "V9-SN-002"},
        follow_redirects=True,
    )
    assert res.status_code == 200
    res = client.post(f"/admin/gyms/{gym.id}/bridge/rotate-key", follow_redirects=True)
    assert res.status_code == 200
    assert re.search(
        rb"Bridge API Key rotated \(shown once[^<]*</strong>\s*<code[^>]*>([^<]+)</code>",
        res.data,
    )


# ── V9-L1: no fresh refresh token for a disabled account ────────────────

def test_refresh_refused_for_disabled_account_mints_no_token(client, seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    raw = create_refresh_token(owner.id, gym.id)
    db.session.commit()
    assert MobileRefreshToken.query.filter_by(user_id=owner.id).count() == 1

    owner.is_active = False
    db.session.commit()

    res = client.post("/api/mobile/v1/auth/refresh", json={"refresh_token": raw})
    assert res.status_code == 403, res.get_json()
    assert res.get_json()["error"]["code"] == "ACCOUNT_DISABLED"
    # No fresh token was minted: still exactly the one presented row,
    # and it was not consumed.
    assert MobileRefreshToken.query.filter_by(user_id=owner.id).count() == 1
    row = MobileRefreshToken.query.filter_by(user_id=owner.id).first()
    assert row.is_used is False


def test_refresh_still_works_when_account_active(client, seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    raw = create_refresh_token(owner.id, gym.id)
    db.session.commit()

    res = client.post("/api/mobile/v1/auth/refresh", json={"refresh_token": raw})
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["data"]["access_token"]
    assert res.get_json()["data"]["refresh_token"] != raw
    assert MobileRefreshToken.query.filter_by(user_id=owner.id).count() == 2
    old = MobileRefreshToken.query.filter_by(user_id=owner.id).order_by(MobileRefreshToken.id).first()
    assert old.is_used is True


# ── V9-L2: request-otp is uniform for every non-member outcome ──────────

def test_request_otp_uniform_for_unknown_staff_and_multi_gym(client, seed_gym, seed_member):
    member = seed_member
    gym = seed_gym["gym"]

    # 1. Unknown number.
    res = client.post("/api/member/v1/auth/request-otp", json={"phone": "9999900000"})
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["success"] is True
    assert res.get_json().get("challenge") is None
    assert "If an account exists" in res.get_json()["message"]
    assert "is_staff" not in res.get_json()

    # 2. Staff phone (the gym's own number).
    res = client.post("/api/member/v1/auth/request-otp", json={"phone": gym.phone})
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["success"] is True
    assert res.get_json().get("challenge") is None
    assert "If an account exists" in res.get_json()["message"]
    assert "is_staff" not in res.get_json()

    # 3. Same suffix at two gyms (ambiguous — no code to either).
    gym2 = Gym(
        name="Second Gym",
        slug="second-gym",
        email="owner2@testgym.com",
        phone="+919876543219",
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
    member2 = Member(
        gym_id=gym2.id,
        plan_id=plan2.id,
        full_name="Gym2 Member",
        phone=member.phone,
        status="active",
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=30),
    )
    db.session.add(member2)
    db.session.commit()
    res = client.post("/api/member/v1/auth/request-otp", json={"phone": member.phone})
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["success"] is True
    assert res.get_json().get("challenge") is None
    assert "If an account exists" in res.get_json()["message"]


def test_request_otp_still_returns_challenge_for_real_member(client, seed_member):
    res = client.post("/api/member/v1/auth/request-otp", json={"phone": seed_member.phone})
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["success"] is True
    assert res.get_json().get("challenge")


# ── V9-L3: generic errors, no raw exception text (spot checks) ──────────

def test_access_feed_bad_date_filter_returns_generic_error(client, seed_gym):
    res = client.get(
        "/api/mobile/v1/access/events?date=bogus",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 400, res.get_json()
    assert res.get_json()["error"]["message"] == "Invalid date filter."
    assert "bogus" not in res.get_data(as_text=True)


def test_cash_close_bad_amount_returns_generic_error(client, seed_gym):
    res = client.post(
        "/api/mobile/v1/owner/cash-close",
        headers=_owner_headers(seed_gym),
        json={"counted_cash": "not-a-number"},
    )
    assert res.status_code == 422, res.get_json()
    assert res.get_json()["error"]["message"] == "The counted cash amount is invalid."


# ── V9-L4: profile photo idempotency ─────────────────────────────────────

def test_profile_photo_same_key_replay_returns_same_url_no_second_file(
    client, seed_member, app, tmp_path
):
    app.config["UPLOAD_FOLDER"] = str(tmp_path / "uploads")
    member = seed_member
    jpeg = _jpeg_bytes("red")
    headers = {**_member_headers(member), "Idempotency-Key": "v9-photo-001"}

    first = client.post(
        "/api/member/v1/profile/photo",
        headers=headers,
        data={"photo": (io.BytesIO(jpeg), "photo.jpg")},
        content_type="multipart/form-data",
    )
    assert first.status_code == 200, first.get_json()
    url1 = first.get_json()["data"]["profile_photo_url"]
    assert url1
    db.session.refresh(member)
    path1 = member.profile_photo_path
    assert len(_photo_files(member, app, tmp_path)) == 1

    second = client.post(
        "/api/member/v1/profile/photo",
        headers=headers,
        data={"photo": (io.BytesIO(jpeg), "photo.jpg")},
        content_type="multipart/form-data",
    )
    assert second.status_code == 200, second.get_json()
    assert second.get_json()["data"]["profile_photo_url"] == url1
    db.session.refresh(member)
    assert member.profile_photo_path == path1
    assert len(_photo_files(member, app, tmp_path)) == 1


def test_profile_photo_same_key_different_bytes_conflicts(client, seed_member, app, tmp_path):
    app.config["UPLOAD_FOLDER"] = str(tmp_path / "uploads")
    member = seed_member
    headers = {**_member_headers(member), "Idempotency-Key": "v9-photo-002"}

    first = client.post(
        "/api/member/v1/profile/photo",
        headers=headers,
        data={"photo": (io.BytesIO(_jpeg_bytes("red")), "photo.jpg")},
        content_type="multipart/form-data",
    )
    assert first.status_code == 200, first.get_json()

    second = client.post(
        "/api/member/v1/profile/photo",
        headers=headers,
        data={"photo": (io.BytesIO(_jpeg_bytes("blue")), "photo.jpg")},
        content_type="multipart/form-data",
    )
    assert second.status_code == 409, second.get_json()
    assert "IDEMPOTENCY_KEY_REUSED" in str(second.get_json())


def test_profile_photo_without_key_still_uploads(client, seed_member, app, tmp_path):
    app.config["UPLOAD_FOLDER"] = str(tmp_path / "uploads")
    res = client.post(
        "/api/member/v1/profile/photo",
        headers=_member_headers(seed_member),
        data={"photo": (io.BytesIO(_jpeg_bytes("green")), "photo.jpg")},
        content_type="multipart/form-data",
    )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["data"]["profile_photo_url"]


def test_profile_photo_invalid_file_returns_generic_error(client, seed_member, app, tmp_path):
    app.config["UPLOAD_FOLDER"] = str(tmp_path / "uploads")
    res = client.post(
        "/api/member/v1/profile/photo",
        headers=_member_headers(seed_member),
        data={"photo": (io.BytesIO(b"this is not an image"), "photo.txt")},
        content_type="multipart/form-data",
    )
    assert res.status_code == 400, res.get_json()
    # V9-L3: the storage layer's raw message must not reach the client.
    assert res.get_json()["error"] == (
        "The photo could not be saved. Please choose a JPEG, PNG, or WebP image under 3 MB and try again."
    )
    assert "not a supported image" not in res.get_data(as_text=True)


# ── V9-L5: second-owner guard ────────────────────────────────────────────

def test_owner_cannot_demote_another_owner(client, seed_gym):
    owner2 = _make_second_owner(seed_gym)
    res = client.patch(
        f"/api/mobile/v1/staff/{owner2.id}",
        headers=_owner_headers(seed_gym),
        json={"role": "staff"},
    )
    assert res.status_code == 403, res.get_json()
    db.session.refresh(owner2)
    assert owner2.role == "gym_owner"


def test_owner_cannot_deactivate_another_owner(client, seed_gym):
    owner2 = _make_second_owner(seed_gym)
    res = client.patch(
        f"/api/mobile/v1/staff/{owner2.id}",
        headers=_owner_headers(seed_gym),
        json={"is_active": False},
    )
    assert res.status_code == 403, res.get_json()
    db.session.refresh(owner2)
    assert owner2.is_active is True


def test_owner_cannot_delete_another_owner(client, seed_gym):
    owner2 = _make_second_owner(seed_gym)
    res = client.delete(
        f"/api/mobile/v1/staff/{owner2.id}",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 403, res.get_json()
    db.session.refresh(owner2)
    assert owner2.is_active is True


def test_owner_can_still_manage_staff(client, seed_gym):
    staff = _make_staff(seed_gym)
    res = client.patch(
        f"/api/mobile/v1/staff/{staff.id}",
        headers=_owner_headers(seed_gym),
        json={"full_name": "Renamed Staff"},
    )
    assert res.status_code == 200, res.get_json()
    db.session.refresh(staff)
    assert staff.full_name == "Renamed Staff"

    res = client.patch(
        f"/api/mobile/v1/staff/{staff.id}",
        headers=_owner_headers(seed_gym),
        json={"is_active": False},
    )
    assert res.status_code == 200, res.get_json()
    db.session.refresh(staff)
    assert staff.is_active is False

    res = client.delete(
        f"/api/mobile/v1/staff/{staff.id}",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200, res.get_json()


def test_self_demote_and_self_deactivate_still_blocked(client, seed_gym):
    owner = seed_gym["owner"]
    res = client.patch(
        f"/api/mobile/v1/staff/{owner.id}",
        headers=_owner_headers(seed_gym),
        json={"role": "staff"},
    )
    assert res.status_code == 403, res.get_json()
    res = client.patch(
        f"/api/mobile/v1/staff/{owner.id}",
        headers=_owner_headers(seed_gym),
        json={"is_active": False},
    )
    assert res.status_code == 403, res.get_json()
    db.session.refresh(owner)
    assert owner.role == "gym_owner"
    assert owner.is_active is True
