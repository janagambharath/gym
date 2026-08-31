from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Gym, Member, User


def _headers(seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    token = create_access_token(owner.id, gym.id, owner.role)
    return {"Authorization": f"Bearer {token}"}


def test_mobile_registration_creates_owner_session_and_trial(client):
    response = client.post(
        "/api/mobile/v1/auth/register",
        json={
            "owner_name": "New Owner",
            "email": "new.owner@example.test",
            "phone": "+971501234567",
            "password": "StrongPassword1!",
            "gym_name": "Dubai Fitness",
            "country": "AE",
            "currency": "AED",
            "timezone": "Asia/Dubai",
            "terms_accepted": True,
        },
    )

    assert response.status_code == 201
    data = response.get_json()["data"]
    assert data["access_token"]
    assert data["refresh_token"]
    assert data["user"]["role"] == "gym_owner"
    assert data["gym"]["country"] == "AE"
    assert data["gym"]["currency"] == "AED"
    assert data["registration"]["setup_state"] == "PLAN_SELECTION"
    assert data["registration"]["billing"]["subscription_status"] == "TRIAL"
    assert User.query.filter_by(email="new.owner@example.test").count() == 1


def test_mobile_registration_rejects_duplicate_and_invalid_locale(client, seed_gym):
    base = {
        "owner_name": "Owner",
        "email": seed_gym["owner"].email,
        "phone": "+971501234567",
        "password": "StrongPassword1!",
        "gym_name": "Another Gym",
        "country": "AE",
        "currency": "AED",
        "timezone": "Asia/Dubai",
        "terms_accepted": True,
    }
    assert client.post("/api/mobile/v1/auth/register", json=base).status_code == 409
    base["email"] = "valid@example.test"
    base["currency"] = "INR"
    bad_locale = client.post("/api/mobile/v1/auth/register", json=base)
    assert bad_locale.status_code == 400
    assert bad_locale.get_json()["error"]["code"] == "VALIDATION_ERROR"


def test_manual_entitlement_and_catalog_are_server_backed(client, seed_gym):
    gym = seed_gym["gym"]
    gym.subscription_status = "active"
    gym.billing_source = "MANUAL"
    gym.billing_plan_id = "founder-plan"
    gym.billing_plan_name = "Founder"
    gym.billing_started_at = datetime.now(timezone.utc) - timedelta(days=3)
    gym.billing_expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    db.session.commit()

    entitlement = client.get("/api/mobile/v1/billing/entitlement", headers=_headers(seed_gym))
    assert entitlement.status_code == 200
    payload = entitlement.get_json()["data"]
    assert payload["billing_source"] == "MANUAL"
    assert payload["subscription_status"] == "ACTIVE"
    assert payload["purchase_management_available"] is False

    catalog = client.get("/api/mobile/v1/billing/catalog", headers=_headers(seed_gym))
    assert catalog.status_code == 200
    plans = catalog.get_json()["data"]["plans"]
    assert [plan["price"] for plan in plans] == ["999.00", "1499.00", "2499.00"]


def test_google_purchase_never_activates_without_provider_verification(client, seed_gym):
    response = client.post(
        "/api/mobile/v1/billing/purchases/verify",
        headers=_headers(seed_gym),
        json={"product_id": "online.revorax.renewaldesk.sub.growth", "purchase_token": "x" * 32},
    )
    assert response.status_code == 503
    assert response.get_json()["error"]["code"] == "BILLING_NOT_CONFIGURED"
    assert seed_gym["gym"].billing_source == "MANUAL"


def test_member_import_preview_identifies_rows_and_atomic_import(client, seed_gym):
    headers = _headers(seed_gym)
    csv_text = "\n".join([
        "full_name,phone,membership_start,membership_end,plan,status",
        "Valid One,+919876000001,2026-08-01,2026-09-01,Monthly Standard,active",
        "Bad Phone,not-a-phone,2026-08-01,2026-09-01,Monthly Standard,active",
        "Duplicate,+919876000001,2026-08-01,2026-09-01,Monthly Standard,active",
    ])
    preview = client.post("/api/mobile/v1/members/import/preview", headers=headers, json={"csv_text": csv_text})
    assert preview.status_code == 200
    summary = preview.get_json()["data"]["summary"]
    assert summary == {"total": 3, "valid": 1, "invalid": 1, "duplicates": 1}

    rejected = client.post("/api/mobile/v1/members/import", headers=headers, json={"csv_text": csv_text})
    assert rejected.status_code == 422
    assert Member.query.filter_by(gym_id=seed_gym["gym"].id).count() == 0

    valid_csv = "\n".join([
        "full_name,phone,membership_start,membership_end,plan,status",
        "Valid One,+919876000001,2026-08-01,2026-09-01,Monthly Standard,active",
    ])
    imported = client.post("/api/mobile/v1/members/import", headers=headers, json={"csv_text": valid_csv})
    assert imported.status_code == 201
    assert imported.get_json()["data"]["imported"] == 1
    assert Member.query.filter_by(gym_id=seed_gym["gym"].id).count() == 1


def test_mobile_member_import_cannot_modify_another_gym(client, seed_gym):
    other = Gym(name="Other", slug="other", status="active", country="IN", currency="INR")
    db.session.add(other)
    db.session.flush()
    foreign_member = Member(
        gym_id=other.id,
        full_name="Private Member",
        phone="+919876000099",
        membership_start=datetime.now(timezone.utc).date(),
        membership_end=(datetime.now(timezone.utc) + timedelta(days=30)).date(),
        status="active",
    )
    db.session.add(foreign_member)
    db.session.commit()

    response = client.get(f"/api/mobile/v1/members/{foreign_member.id}", headers=_headers(seed_gym))
    assert response.status_code == 404
