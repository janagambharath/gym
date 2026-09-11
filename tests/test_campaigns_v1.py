"""Comprehensive test suite for Campaigns + Promotions + Ad Foundation (V1).

Covers:
- Test A: Expired Member Recovery Flow (CSV import, validation, template, send, payment claim, renewal, revenue attribution)
- Test B: Promotional Campaign Flow (Preset selection, customer list, approved template, send, reply, no false revenue attribution)
- Test C: Multi-tenant security (Gym A cannot view or send Gym B campaigns)
- Test D: Cooldown / Duplicate Protection (Exclude recent contacts within 7 days)
- Test E: Import validation and templates API endpoints
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone as tz
from decimal import Decimal

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Gym, Member, MembershipPlan, PaymentVerification, User
from app.models.campaign import Campaign, CampaignRecipient
from app.models.mixins import utcnow
from app.services.campaign_service import (
    APPROVED_TEMPLATES,
    check_cooldown_recipients,
    create_campaign,
    get_approved_templates,
    get_campaign_results,
    send_campaign,
    track_campaign_reply,
    update_campaign_delivery,
    validate_imported_contacts,
)
from app.services.payment_service import verify_payment


@pytest.fixture(autouse=True)
def enable_whatsapp(seed_gym, monkeypatch):
    gym = seed_gym["gym"]
    gym.whatsapp_enabled = True
    gym.phone_number_id = "waba_12345"
    gym.business_phone_number = "+919999999999"
    db.session.commit()

    from app.services.whatsapp_service import WhatsAppResult, WhatsAppService
    monkeypatch.setattr(
        WhatsAppService,
        "send_template",
        lambda self, **kwargs: WhatsAppResult(ok=True, provider_message_id="mock_msg_tpl"),
    )
    monkeypatch.setattr(
        WhatsAppService,
        "send_text",
        lambda self, **kwargs: WhatsAppResult(ok=True, provider_message_id="mock_msg_txt"),
    )


@pytest.fixture
def auth_header(seed_gym):
    user = seed_gym["owner"]
    gym = seed_gym["gym"]
    token = create_access_token(user.id, gym.id, user.role)
    return {"Authorization": f"Bearer {token}"}


# ─── Test E: Template Catalog & Contact Validation Engine ──────────────


def test_approved_templates_catalog():
    templates = get_approved_templates()
    assert len(templates) >= 4
    names = {t["name"] for t in templates}
    assert "expired_member_reactivation_01" in names
    assert "gym_special_offer_01" in names
    assert "gym_announcement_01" in names
    assert "renewal_desk_test_01" in names

    # Filter by campaign_type
    recovery_templates = get_approved_templates("recovery")
    assert any(t["name"] == "expired_member_reactivation_01" for t in recovery_templates)

    promo_templates = get_approved_templates("promotion")
    assert any(t["name"] == "gym_special_offer_01" for t in promo_templates)


def test_import_validation_recovery(seed_gym):
    gym_id = seed_gym["gym"].id
    contacts = [
        {"name": "Rahul Sharma", "phone": "9876543210", "expiry_date": "2026-08-15", "plan": "Monthly", "renewal_amount": "1500"},
        {"name": "Arjun Kumar", "phone": "919812345678", "expiry_date": "15/07/2026", "plan": "Quarterly", "renewal_amount": "4000"},
        {"name": "", "phone": "9876500000", "expiry_date": "2026-08-01"},  # Missing name
        {"name": "No Phone", "phone": "", "expiry_date": "2026-08-01"},     # Missing phone
        {"name": "Future Expiry", "phone": "9876500001", "expiry_date": "2026-12-31"},  # Not expired
        {"name": "Rahul Duplicate", "phone": "9876543210", "expiry_date": "2026-08-15"},  # Duplicate phone
    ]

    res = validate_imported_contacts(gym_id, contacts, campaign_type="recovery")
    assert res["total"] == 6
    assert res["valid_count"] == 2
    assert res["invalid_count"] == 4
    assert res["duplicate_count"] == 1

    valid_names = [r["name"] for r in res["valid_rows"]]
    assert "Rahul Sharma" in valid_names
    assert "Arjun Kumar" in valid_names


def test_import_validation_promotion(seed_gym):
    gym_id = seed_gym["gym"].id
    contacts = [
        {"name": "Customer One", "phone": "+919876543210"},
        {"name": "Customer Two", "phone": "9812345678"},
        {"name": "Bad Phone", "phone": "123"},
    ]

    res = validate_imported_contacts(gym_id, contacts, campaign_type="promotion")
    assert res["total"] == 3
    assert res["valid_count"] == 2
    assert res["invalid_count"] == 1


# ─── Test A: Expired Member Recovery Flow ──────────────────────────────


def test_expired_member_recovery_flow(client, seed_gym, auth_header):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]

    # 1. Validate import via API
    contacts = [
        {"name": "Kiran Expired", "phone": "9876511111", "expiry_date": "2026-08-01", "renewal_amount": "2000"},
        {"name": "Suresh Expired", "phone": "9876522222", "expiry_date": "2026-07-15", "renewal_amount": "2500"},
    ]
    val_resp = client.post(
        "/api/mobile/v1/campaigns/import/validate",
        headers=auth_header,
        json={"contacts": contacts, "campaign_type": "recovery"},
    )
    assert val_resp.status_code == 200
    assert val_resp.get_json()["data"]["valid_count"] == 2

    # 2. Create recovery campaign with imported contacts
    create_resp = client.post(
        "/api/mobile/v1/campaigns",
        headers=auth_header,
        json={
            "name": "August Reactivation Recovery",
            "campaign_type": "recovery",
            "segment_type": "custom_import",
            "whatsapp_template_name": "expired_member_reactivation_01",
            "imported_contacts": contacts,
        },
    )
    assert create_resp.status_code == 201
    campaign_data = create_resp.get_json()["data"]
    campaign_id = campaign_data["id"]
    assert campaign_data["campaign_type"] == "recovery"

    # 3. Send campaign
    send_resp = client.post(
        f"/api/mobile/v1/campaigns/{campaign_id}/send",
        headers=auth_header,
    )
    assert send_resp.status_code == 200
    send_data = send_resp.get_json()["data"]
    assert send_data["sent"] == 2

    # 4. Webhook updates delivery & reply
    recipients = CampaignRecipient.query.filter_by(campaign_id=campaign_id).all()
    assert len(recipients) == 2
    r1 = recipients[0]
    r1.provider_message_id = "msg_recov_01"
    db.session.commit()

    update_campaign_delivery("msg_recov_01", "delivered")
    update_campaign_delivery("msg_recov_01", "read")
    track_campaign_reply(gym.id, r1.phone_snapshot)

    # 5. Member pays and owner confirms renewal -> attribution
    member = r1.member
    payment = PaymentVerification(
        gym_id=gym.id,
        member_id=member.id,
        amount=Decimal("2000.00"),
        method="upi",
        status="pending",
    )
    db.session.add(payment)
    db.session.commit()

    renewal = verify_payment(payment, verified_by_id=owner.id, renewal_days=30)
    db.session.commit()

    assert renewal.campaign_id == campaign_id
    results = get_campaign_results(campaign_id, gym.id)
    assert results["total_renewed"] == 1
    assert Decimal(results["total_revenue_recovered"]) == Decimal("2000.00")


# ─── Test B: Promotional Campaign Flow ─────────────────────────────────


def test_promotional_campaign_flow(client, seed_gym, auth_header):
    gym = seed_gym["gym"]

    contacts = [
        {"name": "Promo Lead 1", "phone": "9876533333"},
        {"name": "Promo Lead 2", "phone": "9876544444"},
    ]

    create_resp = client.post(
        "/api/mobile/v1/campaigns",
        headers=auth_header,
        json={
            "name": "Diwali 20% Off Offer",
            "campaign_type": "promotion",
            "promo_preset": "festival_offer",
            "segment_type": "custom_import",
            "whatsapp_template_name": "gym_special_offer_01",
            "message_template": "Get 20% discount on 6-month memberships this Diwali!",
            "imported_contacts": contacts,
        },
    )
    assert create_resp.status_code == 201
    campaign_id = create_resp.get_json()["data"]["id"]

    # Send promo
    send_resp = client.post(f"/api/mobile/v1/campaigns/{campaign_id}/send", headers=auth_header)
    assert send_resp.status_code == 200

    results = get_campaign_results(campaign_id, gym.id)
    assert results["total_sent"] == 2
    # Promotional campaigns do NOT falsely claim revenue recovered without renewals
    assert Decimal(results["total_revenue_recovered"]) == Decimal("0.00")


# ─── Test C: Multi-Tenant Security ─────────────────────────────────────


def test_campaign_tenant_isolation(client, seed_gym, auth_header):
    # Create Gym 2
    gym2 = Gym(
        name="Gym 2 Fitness",
        slug="gym-2-fit",
        email="gym2@example.com",
        phone="+919000000099",
        whatsapp_enabled=True,
        phone_number_id="waba_phone_gym2",
    )
    db.session.add(gym2)
    db.session.commit()

    # Create campaign in Gym 2
    c2 = Campaign(
        gym_id=gym2.id,
        name="Gym 2 Secret Campaign",
        segment_type="all_expired",
        campaign_type="recovery",
    )
    db.session.add(c2)
    db.session.commit()

    # Gym 1 tries to access Gym 2's campaign
    res = client.get(f"/api/mobile/v1/campaigns/{c2.id}", headers=auth_header)
    assert res.status_code == 404

    # Gym 1 tries to send Gym 2's campaign
    res_send = client.post(f"/api/mobile/v1/campaigns/{c2.id}/send", headers=auth_header)
    assert res_send.status_code in (400, 404)


# ─── Test D: Cooldown / Duplicate Protection ───────────────────────────


def test_cooldown_duplicate_protection(seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]

    member = Member(
        gym_id=gym.id,
        full_name="Cooldown Target",
        phone="+919998887776",
        status="expired",
        membership_end=date(2026, 8, 1),
        whatsapp_opted_in=True,
    )
    db.session.add(member)
    db.session.commit()

    # Send a campaign today
    c1 = create_campaign(
        gym_id=gym.id,
        name="Campaign 1",
        segment_type="custom_import",
        created_by_id=owner.id,
        imported_contacts=[{"name": member.full_name, "phone": member.phone, "expiry_date": "2026-08-01"}],
    )
    send_campaign(c1.id, gym.id)

    # Check cooldown check
    cooldown_res = check_cooldown_recipients(
        gym_id=gym.id,
        member_ids=[member.id],
        cooldown_days=7,
    )
    assert cooldown_res["total"] == 1
    assert cooldown_res["in_cooldown"] == 1
    assert cooldown_res["eligible"] == 0

    # Creating a second campaign with exclude_recent=True skips this member
    c2 = create_campaign(
        gym_id=gym.id,
        name="Campaign 2 (Cooldown test)",
        segment_type="custom_import",
        created_by_id=owner.id,
        imported_contacts=[{"name": member.full_name, "phone": member.phone, "expiry_date": "2026-08-01"}],
        exclude_recent=True,
    )
    db.session.commit()

    recipients_c2 = CampaignRecipient.query.filter_by(campaign_id=c2.id).all()
    assert len(recipients_c2) == 0  # Member was excluded due to cooldown!
