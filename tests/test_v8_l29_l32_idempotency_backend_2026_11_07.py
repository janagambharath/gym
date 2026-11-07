"""Backend replay proofs for fix-all v8: V8-L29 (upload idempotency) + V8-L32 (member-API idempotency).

V8-L29:
- POST /settings/payment/qr honours Idempotency-Key: same key + same
  bytes replays the stored response (same signed URL, no second file
  stored — even under a different filename); same key + different
  bytes 409s.
- POST /members/scan honours Idempotency-Key: same key replays without
  a second OpenRouter vision call.
- POST /members/import already honoured keys (scope "import_members") —
  this file proves the replay holds; /members/import/preview is
  read-only validation and takes no key by design.

V8-L32 (member-API, scoped per member identity via the new
``MobileIdempotencyKey.member_id`` column — members are not User rows,
so the owner ``user_id`` scope cannot represent them):
- POST /auth/verify-otp replays the SAME tokens on a same-key retry
  (no second refresh family); a different OTP under the same key 409s;
  the same key string used by a different member mints that member's
  own session (no cross-member replay).
- POST /renew/claim replays the stored payment_id; the same key string
  used by a different member creates that member's own claim.
- DELETE /auth/account records the idempotency row, but the replay
  path is pre-empted by design: member_token_required 401s a
  soft-deleted member before the view runs, so a same-key retry still
  401s — that 401 IS the dedupe (asserted: exactly one audit row, no
  double-execute).
"""
from __future__ import annotations

import base64
import io
import shutil
import time
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.extensions import db
from app.mobile_api.member_api import (
    _normalize_phone,
    _sign_otp_challenge,
)
from app.mobile_api.token_service import create_access_token
from app.models import AuditLog, Member, MembershipPlan, MobileIdempotencyKey, PaymentVerification
from app.models.mobile_token import MemberRefreshToken
from app.models import QRSettings


# ── helpers ──────────────────────────────────────────────────────────

def _owner_headers(seed_gym):
    token = create_access_token(
        seed_gym["owner"].id, seed_gym["gym"].id, seed_gym["owner"].role
    )
    return {"Authorization": f"Bearer {token}"}


def _member_headers(member):
    token = create_access_token(member.id, member.gym_id, "member")
    return {"Authorization": f"Bearer {token}"}


def _png_bytes(color: str) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color).save(buf, format="PNG")
    return buf.getvalue()


def _qr_upload(client, headers, png: bytes, filename: str, key: str | None):
    hdrs = dict(headers)
    if key is not None:
        hdrs["Idempotency-Key"] = key
    return client.post(
        "/api/mobile/v1/settings/payment/qr",
        data={"qr_image": (io.BytesIO(png), filename)},
        headers=hdrs,
    )


def _cleanup_qr_files(app, gym_id: int) -> None:
    upload_root = Path(app.config["UPLOAD_FOLDER"]) / "gym_qr" / str(gym_id)
    shutil.rmtree(upload_root, ignore_errors=True)


def _second_member(seed_gym):
    member = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
        full_name="Jane Roe",
        phone="+919998887777",
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=30),
        status="active",
    )
    db.session.add(member)
    db.session.commit()
    return member


_VALID_CSV = "\n".join([
    "full_name,phone,membership_start,membership_end,plan,status,device_enroll_number,price",
    "Valid One,+919876000001,2026-08-01,2026-08-30,Monthly Standard,active,8842,850.50",
])


# ── V8-L29: QR upload ─────────────────────────────────────────────────

def test_qr_upload_replays_same_bytes_under_same_key(client, app, seed_gym):
    headers = _owner_headers(seed_gym)
    png = _png_bytes("white")
    try:
        first = _qr_upload(client, headers, png, "qr.png", "qr-key-1")
        assert first.status_code == 200, first.get_json()
        first_body = first.get_json()
        qr = QRSettings.query.filter_by(gym_id=seed_gym["gym"].id).one()
        first_path = qr.qr_image_path
        assert first_path

        # Same key + same bytes, different filename: replay, not re-store.
        second = _qr_upload(client, headers, png, "renamed.png", "qr-key-1")
        assert second.status_code == 200, second.get_json()
        assert second.get_json() == first_body
        qr_after = QRSettings.query.filter_by(gym_id=seed_gym["gym"].id).one()
        assert qr_after.qr_image_path == first_path
        stored_files = list(
            (Path(app.config["UPLOAD_FOLDER"]) / "gym_qr" / str(seed_gym["gym"].id)).glob("*")
        )
        assert len(stored_files) == 1
        assert MobileIdempotencyKey.query.filter_by(
            scope="payment_qr_upload", key="qr-key-1"
        ).count() == 1
    finally:
        _cleanup_qr_files(app, seed_gym["gym"].id)


def test_qr_upload_same_key_different_bytes_409(client, app, seed_gym):
    headers = _owner_headers(seed_gym)
    try:
        first = _qr_upload(client, headers, _png_bytes("white"), "qr.png", "qr-key-2")
        assert first.status_code == 200, first.get_json()
        second = _qr_upload(client, headers, _png_bytes("black"), "qr.png", "qr-key-2")
        assert second.status_code == 409, second.get_json()
        assert "IDEMPOTENCY_KEY_REUSED" in str(second.get_json())
    finally:
        _cleanup_qr_files(app, seed_gym["gym"].id)


def test_qr_upload_without_key_still_works(client, app, seed_gym):
    headers = _owner_headers(seed_gym)
    try:
        res = _qr_upload(client, headers, _png_bytes("white"), "qr.png", None)
        assert res.status_code == 200, res.get_json()
    finally:
        _cleanup_qr_files(app, seed_gym["gym"].id)


# ── V8-L29: scan + import ─────────────────────────────────────────────

def test_scan_replays_without_second_vision_call(client, seed_gym, monkeypatch):
    from app.services.document_scan_service import DocumentScanService

    headers = _owner_headers(seed_gym)
    monkeypatch.setattr(DocumentScanService, "get_api_key", lambda: "mock-openrouter-key")
    calls: list = []

    def _fake_vision(images, api_key):
        calls.append(images)
        return (
            {
                "members": [
                    {
                        "name": "Asha Sharma",
                        "phone": "9876543211",
                        "plan_name": "Monthly Standard",
                        "start_date": "2026-08-01",
                        "expiry_date": "2026-08-30",
                        "amount": "1000",
                    }
                ],
                "document_warnings": [],
            },
            None,
        )

    monkeypatch.setattr(DocumentScanService, "_call_openrouter_vision", _fake_vision)
    fake_b64 = base64.b64encode(b"valid image data" * 20).decode("utf-8")
    payload = {"images": [{"data": fake_b64, "mime_type": "image/jpeg"}]}
    hdrs = dict(headers)
    hdrs["Idempotency-Key"] = "scan-key-1"

    first = client.post("/api/mobile/v1/members/scan", json=payload, headers=hdrs)
    assert first.status_code == 200, first.get_json()
    second = client.post("/api/mobile/v1/members/scan", json=payload, headers=hdrs)
    assert second.status_code == 200, second.get_json()
    assert second.get_json() == first.get_json()
    assert len(calls) == 1


def test_scan_same_key_different_images_409(client, seed_gym, monkeypatch):
    from app.services.document_scan_service import DocumentScanService

    headers = _owner_headers(seed_gym)
    monkeypatch.setattr(DocumentScanService, "get_api_key", lambda: "mock-openrouter-key")
    monkeypatch.setattr(
        DocumentScanService,
        "_call_openrouter_vision",
        lambda images, api_key: ({"members": [], "document_warnings": []}, None),
    )
    hdrs = dict(headers)
    hdrs["Idempotency-Key"] = "scan-key-2"
    b64_a = base64.b64encode(b"image A" * 20).decode("utf-8")
    b64_b = base64.b64encode(b"image B" * 20).decode("utf-8")
    first = client.post(
        "/api/mobile/v1/members/scan",
        json={"images": [{"data": b64_a, "mime_type": "image/jpeg"}]},
        headers=hdrs,
    )
    assert first.status_code == 200, first.get_json()
    second = client.post(
        "/api/mobile/v1/members/scan",
        json={"images": [{"data": b64_b, "mime_type": "image/jpeg"}]},
        headers=hdrs,
    )
    assert second.status_code == 409, second.get_json()
    assert "IDEMPOTENCY_KEY_REUSED" in str(second.get_json())


def test_import_replays_instead_of_duplicating(client, seed_gym):
    headers = _owner_headers(seed_gym)
    hdrs = dict(headers)
    hdrs["Idempotency-Key"] = "import-key-1"
    first = client.post(
        "/api/mobile/v1/members/import", json={"csv_text": _VALID_CSV}, headers=hdrs
    )
    assert first.status_code == 201, first.get_json()
    second = client.post(
        "/api/mobile/v1/members/import", json={"csv_text": _VALID_CSV}, headers=hdrs
    )
    assert second.status_code == 201, second.get_json()
    assert second.get_json() == first.get_json()
    assert (
        Member.query.filter_by(gym_id=seed_gym["gym"].id, phone="+919876000001").count()
        == 1
    )


# ── V8-L32: verify-otp ────────────────────────────────────────────────

def _verify(client, member, otp, key, challenge=None):
    phone = _normalize_phone(member.phone)
    if challenge is None:
        challenge = _sign_otp_challenge(
            phone, member.id, member.gym_id, otp, int(time.time()) + 600
        )
    headers = {"Idempotency-Key": key} if key is not None else {}
    return client.post(
        "/api/member/v1/auth/verify-otp",
        json={"phone": member.phone, "otp": otp, "challenge": challenge},
        headers=headers,
    )


def test_verify_otp_replays_same_tokens_no_second_family(client, seed_member):
    member = seed_member
    # One challenge for both calls: the challenge embeds an expiry
    # timestamp, so re-signing per call could tick over a second and
    # change the fingerprint (a real client retries the SAME bytes).
    phone = _normalize_phone(member.phone)
    challenge = _sign_otp_challenge(
        phone, member.id, member.gym_id, "123456", int(time.time()) + 600
    )
    first = _verify(client, member, "123456", "otp-key-1", challenge=challenge)
    assert first.status_code == 200, first.get_json()
    first_data = first.get_json()["data"]
    assert first_data["token"]

    second = _verify(client, member, "123456", "otp-key-1", challenge=challenge)
    assert second.status_code == 200, second.get_json()
    second_data = second.get_json()["data"]
    assert second_data["token"] == first_data["token"]
    assert second_data["refresh_token"] == first_data["refresh_token"]
    # No second refresh family was minted by the replay.
    assert (
        db.session.query(MemberRefreshToken.family_id)
        .filter_by(member_id=member.id)
        .distinct()
        .count()
        == 1
    )
    assert MobileIdempotencyKey.query.filter_by(
        scope="member_verify_otp", key="otp-key-1"
    ).count() == 1


def test_verify_otp_same_key_different_otp_409(client, seed_member):
    member = seed_member
    phone = _normalize_phone(member.phone)
    challenge = _sign_otp_challenge(
        phone, member.id, member.gym_id, "123456", int(time.time()) + 600
    )
    first = _verify(client, member, "123456", "otp-key-2", challenge=challenge)
    assert first.status_code == 200, first.get_json()
    # A corrected guess under the same key is a different request
    # (same challenge, different OTP).
    second = _verify(client, member, "123457", "otp-key-2", challenge=challenge)
    assert second.status_code == 409, second.get_json()
    assert "IDEMPOTENCY_KEY_REUSED" in str(second.get_json())


def test_verify_otp_key_is_scoped_per_member(client, seed_member, seed_gym):
    john = seed_member
    jane = _second_member(seed_gym)
    first = _verify(client, john, "123456", "otp-shared-key")
    assert first.status_code == 200, first.get_json()
    # Same key string, different member: her own session, not John's replay.
    second = _verify(client, jane, "123456", "otp-shared-key")
    assert second.status_code == 200, second.get_json()
    assert second.get_json()["data"]["member"]["id"] == jane.id
    assert second.get_json()["data"]["token"] != first.get_json()["data"]["token"]


# ── V8-L32: renew/claim ───────────────────────────────────────────────

def _claim(client, member, key, plan_id=None):
    headers = _member_headers(member)
    if key is not None:
        headers["Idempotency-Key"] = key
    return client.post(
        "/api/member/v1/renew/claim",
        json={"plan_id": plan_id} if plan_id else {},
        headers=headers,
    )


def test_claim_replays_same_payment_id(client, seed_member, seed_gym):
    member = seed_member
    plan_id = seed_gym["plan"].id
    first = _claim(client, member, "claim-key-1", plan_id)
    assert first.status_code == 201, first.get_json()
    payment_id = first.get_json()["data"]["payment_id"]
    second = _claim(client, member, "claim-key-1", plan_id)
    assert second.status_code == 201, second.get_json()
    assert second.get_json()["data"]["payment_id"] == payment_id
    assert (
        PaymentVerification.query.filter_by(member_id=member.id).count() == 1
    )


def test_claim_key_is_scoped_per_member(client, seed_member, seed_gym):
    john = seed_member
    jane = _second_member(seed_gym)
    plan_id = seed_gym["plan"].id
    first = _claim(client, john, "claim-shared-key", plan_id)
    assert first.status_code == 201, first.get_json()
    second = _claim(client, jane, "claim-shared-key", plan_id)
    assert second.status_code == 201, second.get_json()
    assert (
        second.get_json()["data"]["payment_id"]
        != first.get_json()["data"]["payment_id"]
    )
    assert PaymentVerification.query.filter_by(member_id=jane.id).count() == 1


# ── V8-L32: self-delete ───────────────────────────────────────────────

def test_delete_account_records_key_and_second_delete_still_401(
    client, seed_member
):
    member = seed_member
    headers = _member_headers(member)
    headers["Idempotency-Key"] = "delete-key-1"
    first = client.delete("/api/member/v1/auth/account", headers=headers)
    assert first.status_code == 200, first.get_json()
    row = MobileIdempotencyKey.query.filter_by(
        scope="member_delete_account", key="delete-key-1"
    ).one_or_none()
    assert row is not None
    assert row.member_id == member.id
    assert row.user_id is None

    # The replay is pre-empted by member_token_required (deleted member
    # 401s before the view runs) — that 401 IS the dedupe. Exactly one
    # audit row proves no double-execute.
    second = client.delete("/api/member/v1/auth/account", headers=headers)
    assert second.status_code == 401, second.get_json()
    assert (
        AuditLog.query.filter_by(
            gym_id=member.gym_id, action="member_self_delete_account"
        ).count()
        == 1
    )
    assert db.session.get(Member, member.id).deleted_at is not None
