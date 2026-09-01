"""Tests for Mobile Member Import & AI Document Scanner Endpoints."""
from __future__ import annotations

import base64
import json
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from app.extensions import db
from app.models import Gym, Member, MembershipPlan, User


@pytest.fixture
def test_gym_and_owner(app):
    """Create test gym and owner for scan and import tests."""
    with app.app_context():
        gym = Gym(
            name="Scan Test Gym",
            slug="scan-test-gym",
            country="India",
            currency="INR",
            phone="+919876000001",
            subscription_status="trial",
            max_members=100,
        )
        db.session.add(gym)
        db.session.flush()

        plan1 = MembershipPlan(gym_id=gym.id, name="Monthly", duration_days=30, price=Decimal("1500.00"), is_active=True)
        plan2 = MembershipPlan(gym_id=gym.id, name="Quarterly", duration_days=90, price=Decimal("4000.00"), is_active=True)
        db.session.add_all([plan1, plan2])

        existing_m = Member(
            gym_id=gym.id,
            plan_id=plan1.id,
            full_name="Existing Member",
            phone="+919876543210",
            membership_start=date.today() - timedelta(days=20),
            membership_end=date.today() + timedelta(days=10),
            status="active",
        )
        db.session.add(existing_m)

        owner = User(gym_id=gym.id, email="scan.owner@example.com", full_name="Scan Owner", role="gym_owner")
        owner.set_password("password123")
        db.session.add(owner)
        db.session.commit()

        gym_id = gym.id
        owner_id = owner.id
        plan1_id = plan1.id
        plan2_id = plan2.id

    return {
        "gym_id": gym_id,
        "owner_id": owner_id,
        "email": "scan.owner@example.com",
        "password": "password123",
        "plan1_id": plan1_id,
        "plan2_id": plan2_id,
    }


def _get_auth_headers(client, email, password):
    login_resp = client.post("/api/mobile/v1/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200
    token = login_resp.get_json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_scan_endpoint_requires_auth(client):
    """POST /members/scan requires valid bearer token."""
    resp = client.post("/api/mobile/v1/members/scan", json={"images": []})
    assert resp.status_code == 401


def test_scan_endpoint_validates_empty_images(client, test_gym_and_owner):
    """POST /members/scan rejects empty images payload."""
    headers = _get_auth_headers(client, test_gym_and_owner["email"], test_gym_and_owner["password"])
    resp = client.post("/api/mobile/v1/members/scan", json={"images": []}, headers=headers)
    assert resp.status_code == 400
    assert resp.get_json()["error"]["code"] == "VALIDATION_ERROR"


def test_scan_endpoint_handles_missing_openrouter_key(client, test_gym_and_owner, monkeypatch):
    """When OpenRouter API key is missing, return safe AI_NOT_CONFIGURED message."""
    headers = _get_auth_headers(client, test_gym_and_owner["email"], test_gym_and_owner["password"])
    from app.services.document_scan_service import DocumentScanService

    monkeypatch.setattr(DocumentScanService, "get_api_key", lambda: "")

    fake_b64 = base64.b64encode(b"dummy image data" * 20).decode("utf-8")
    resp = client.post(
        "/api/mobile/v1/members/scan",
        json={"images": [{"data": fake_b64, "mime_type": "image/jpeg"}]},
        headers=headers,
    )
    assert resp.status_code == 400
    assert resp.get_json()["error"]["code"] == "AI_NOT_CONFIGURED"


def test_scan_endpoint_normalizes_extracted_records(client, test_gym_and_owner, monkeypatch):
    """Test full extraction normalization, plan matching, and duplicate checking."""
    headers = _get_auth_headers(client, test_gym_and_owner["email"], test_gym_and_owner["password"])
    from app.services.document_scan_service import DocumentScanService

    monkeypatch.setattr(DocumentScanService, "get_api_key", lambda: "mock-openrouter-key")

    mock_ai_response = {
        "members": [
            {
                "name": "Asha Sharma",
                "phone": "9876543211",
                "email": "asha@example.com",
                "plan_name": "Monthly",
                "start_date": "01/08/2026",
                "expiry_date": "01/09/2026",
                "amount": "1500",
                "notes": "Morning batch",
                "confidence": 0.95,
                "warnings": [],
            },
            {
                "name": "Duplicate Member",
                "phone": "+919876543210",  # Matches existing member phone
                "email": None,
                "plan_name": "Quarterly",
                "start_date": "2026-06-01",
                "expiry_date": "2026-09-01",
                "amount": "4000",
                "notes": None,
                "confidence": 0.90,
                "warnings": [],
            },
            {
                "name": "Vijay Verma",
                "phone": "9876543299",
                "email": None,
                "plan_name": "Gold Annual",  # Unmatched plan
                "start_date": "2026-01-01",
                "expiry_date": "2026-12-31",
                "amount": "12000",
                "notes": None,
                "confidence": 0.75,
                "warnings": [],
            },
        ],
        "document_warnings": [],
    }

    monkeypatch.setattr(
        DocumentScanService,
        "_call_openrouter_vision",
        lambda images, api_key: (mock_ai_response, None),
    )

    fake_b64 = base64.b64encode(b"valid image data" * 20).decode("utf-8")
    resp = client.post(
        "/api/mobile/v1/members/scan",
        json={"images": [{"data": fake_b64, "mime_type": "image/jpeg", "filename": "register_page1.jpg"}]},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["summary"]["total"] == 3
    assert data["summary"]["ready"] == 2  # Asha + Vijay (plan unmatched is not blocking if editable)
    assert data["summary"]["duplicates"] == 1

    members = data["members"]
    # 1. Asha Sharma
    asha = members[0]
    assert asha["name"] == "Asha Sharma"
    assert asha["phone"] == "+919876543211"
    assert asha["plan_name"] == "Monthly"
    assert asha["plan_id"] == test_gym_and_owner["plan1_id"]
    assert asha["membership_start"] == "2026-08-01"
    assert asha["membership_end"] == "2026-09-01"
    assert asha["is_ready"] is True
    assert asha["is_duplicate"] is False

    # 2. Duplicate Member
    dup = members[1]
    assert dup["is_duplicate"] is True
    assert dup["is_ready"] is False
    assert any("already belongs to active member" in w for w in dup["warnings"])

    # 3. Vijay Verma (unmatched plan)
    vijay = members[2]
    assert vijay["name"] == "Vijay Verma"
    assert vijay["plan_id"] is None
    assert any("not matched" in w for w in vijay["warnings"])


def test_batch_create_members_atomic_creation_and_metrics(client, app, test_gym_and_owner):
    """POST /members/batch-create atomically creates members and computes upcoming renewals ROI."""
    headers = _get_auth_headers(client, test_gym_and_owner["email"], test_gym_and_owner["password"])

    today = date.today()
    members_payload = [
        {
            "name": "New Batch Member 1",
            "phone": "+919999900001",
            "plan_id": test_gym_and_owner["plan1_id"],  # 1500 price
            "membership_start": (today - timedelta(days=25)).isoformat(),
            "membership_end": (today + timedelta(days=5)).isoformat(),  # Expiring in 5 days -> upcoming renewal
            "status": "active",
            "amount": "1500.00",
            "notes": "Paid in full",
        },
        {
            "name": "New Batch Member 2",
            "phone": "+919999900002",
            "plan_id": test_gym_and_owner["plan2_id"],  # 4000 price
            "membership_start": (today - timedelta(days=80)).isoformat(),
            "membership_end": (today + timedelta(days=10)).isoformat(),  # Expiring in 10 days
            "status": "active",
            "amount": "4000.00",
            "notes": None,
        },
    ]

    resp = client.post("/api/mobile/v1/members/batch-create", json={"members": members_payload}, headers=headers)
    assert resp.status_code == 201
    res_data = resp.get_json()["data"]
    assert res_data["imported"] == 2
    assert res_data["upcoming_renewals_count"] == 1  # Member 1 is within 7 days
    assert Decimal(res_data["revenue_at_risk"]) == Decimal("1500.00")

    # Verify members exist in DB
    with app.app_context():
        m1 = Member.query.filter_by(phone="+919999900001").first()
        m2 = Member.query.filter_by(phone="+919999900002").first()
        assert m1 is not None
        assert m1.full_name == "New Batch Member 1"
        assert m2 is not None
        assert m2.gym_id == test_gym_and_owner["gym_id"]


def test_batch_create_enforces_max_member_limits(client, app, test_gym_and_owner):
    """POST /members/batch-create aborts atomically if capacity limit is reached."""
    headers = _get_auth_headers(client, test_gym_and_owner["email"], test_gym_and_owner["password"])

    with app.app_context():
        gym = db.session.get(Gym, test_gym_and_owner["gym_id"])
        gym.max_members = 2  # Already has 1 existing member
        db.session.commit()

    # Attempting to import 2 new members will exceed limit (1 + 2 = 3 > 2)
    members_payload = [
        {"name": "M1", "phone": "+919111111111", "membership_start": "2026-08-01", "membership_end": "2026-09-01"},
        {"name": "M2", "phone": "+919111111112", "membership_start": "2026-08-01", "membership_end": "2026-09-01"},
    ]

    resp = client.post("/api/mobile/v1/members/batch-create", json={"members": members_payload}, headers=headers)
    assert resp.status_code == 409
    assert resp.get_json()["error"]["code"] == "MEMBER_LIMIT"

    # Verify no members were created
    with app.app_context():
        assert Member.query.filter_by(phone="+919111111111").first() is None
