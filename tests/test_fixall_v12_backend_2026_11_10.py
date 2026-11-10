"""Deep review v12 — backend fix-all tests (2026-11-10).

Covers V12-B1..B6, V12-L9, V12-M4, the V8-L14 residual, and the
V12-L4 follow-up (gym.timezone on member payloads). Each test
asserts the fixed behaviour AND the negative case (the old bug
would fail it).
"""
from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Gym, Member, MembershipPlan, PaymentVerification
from app.models.campaign import Campaign, CampaignRecipient
from app.services.campaign_service import create_campaign, send_campaign


def _owner_headers(seed_gym):
    return {
        "Authorization": (
            f"Bearer {create_access_token(seed_gym['owner'].id, seed_gym['gym'].id, 'gym_owner')}"
        )
    }


def _member_headers(member):
    return {
        "Authorization": f"Bearer {create_access_token(member.id, member.gym_id, 'member')}"
    }


def _enable_whatsapp(seed_gym):
    gym = seed_gym["gym"]
    gym.whatsapp_enabled = True
    gym.phone_number_id = "waba_12345"
    gym.business_phone_number = "+919999999999"
    db.session.commit()


def _mock_whatsapp(monkeypatch, *, template_ok=True, template_error="Template paused"):
    """Fake WhatsAppService sends; returns a dict of recorded calls."""
    from app.services.whatsapp_service import WhatsAppResult, WhatsAppService

    calls = {"template": [], "text": []}

    def _fake_template(self, **kwargs):
        calls["template"].append(kwargs)
        if template_ok:
            return WhatsAppResult(ok=True, provider_message_id="mock_tpl")
        return WhatsAppResult(ok=False, error=template_error)

    def _fake_text(self, **kwargs):
        calls["text"].append(kwargs)
        return WhatsAppResult(ok=True, provider_message_id="mock_txt")

    monkeypatch.setattr(WhatsAppService, "send_template", _fake_template)
    monkeypatch.setattr(WhatsAppService, "send_text", _fake_text)
    return calls


def _expiring_member(seed_gym, *, name, phone, end_in_days=3):
    m = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
        full_name=name,
        phone=phone,
        status="active",
        membership_start=date.today() - timedelta(days=25),
        membership_end=date.today() + timedelta(days=end_in_days),
        whatsapp_opted_in=True,
    )
    db.session.add(m)
    db.session.commit()
    return m


# ─── V12-B1: segment sends enforce the 7-day WhatsApp cooldown ───────


def test_b1_segment_send_skips_recently_messaged(app, seed_gym, monkeypatch):
    _enable_whatsapp(seed_gym)
    calls = _mock_whatsapp(monkeypatch)
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]

    a = _expiring_member(seed_gym, name="Member A", phone="+919900000001")
    b = _expiring_member(seed_gym, name="Member B", phone="+919900000002")

    c1 = create_campaign(
        gym_id=gym.id, name="C1", segment_type="expiring_7d", created_by_id=owner.id,
        whatsapp_template_name="expired_member_reactivation_01",
    )
    res1 = send_campaign(c1.id, gym.id)
    assert res1["sent"] == 2, res1

    # A third member joins the segment AFTER the first send.
    c = _expiring_member(seed_gym, name="Member C", phone="+919900000003")
    c2 = create_campaign(
        gym_id=gym.id, name="C2", segment_type="expiring_7d", created_by_id=owner.id,
        whatsapp_template_name="expired_member_reactivation_01",
    )
    res2 = send_campaign(c2.id, gym.id)
    # Only the never-messaged member is sent; the two messaged days
    # ago are skipped by the cooldown (previously all 3 were sent).
    assert res2["sent"] == 1, res2
    assert res2["skipped_cooldown"] == 2, res2
    assert res2["total"] == 1, res2
    assert len(calls["template"]) == 3
    sent_ids = {
        r.member_id
        for r in CampaignRecipient.query.filter_by(campaign_id=c2.id).all()
    }
    assert sent_ids == {c.id}


def test_b1_segment_send_all_in_cooldown_completes_empty(app, seed_gym, monkeypatch):
    _enable_whatsapp(seed_gym)
    _mock_whatsapp(monkeypatch)
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]

    _expiring_member(seed_gym, name="Member A", phone="+919900000001")
    _expiring_member(seed_gym, name="Member B", phone="+919900000002")

    c1 = create_campaign(
        gym_id=gym.id, name="C1", segment_type="expiring_7d", created_by_id=owner.id,
        whatsapp_template_name="expired_member_reactivation_01",
    )
    assert send_campaign(c1.id, gym.id)["sent"] == 2

    c2 = create_campaign(
        gym_id=gym.id, name="C2", segment_type="expiring_7d", created_by_id=owner.id,
        whatsapp_template_name="expired_member_reactivation_01",
    )
    res2 = send_campaign(c2.id, gym.id)
    assert res2["sent"] == 0, res2
    assert res2["skipped_cooldown"] == 2, res2
    assert res2["total"] == 0, res2
    assert CampaignRecipient.query.filter_by(campaign_id=c2.id).count() == 0
    db.session.refresh(c2)
    assert c2.status == "completed"


# ─── V12-B2: per-phone OTP send throttle ──────────────────────────────


def test_b2_second_otp_inside_cooldown_returns_same_challenge(client, seed_gym, seed_member, monkeypatch):
    _enable_whatsapp(seed_gym)
    calls = _mock_whatsapp(monkeypatch)

    first = client.post(
        "/api/member/v1/auth/request-otp", json={"phone": seed_member.phone}
    )
    assert first.status_code == 200, first.get_data(as_text=True)[:300]
    assert first.get_json()["challenge"]

    second = client.post(
        "/api/member/v1/auth/request-otp", json={"phone": seed_member.phone}
    )
    # Previously: a fresh OTP + fresh paid WhatsApp send every time.
    assert second.status_code == 429, second.get_data(as_text=True)[:300]
    body = second.get_json()
    assert body["challenge"] == first.get_json()["challenge"]
    assert 0 < body["retry_after_seconds"] <= 120
    assert body["challenge_expires_in_seconds"] > 0
    # Only one WhatsApp send happened.
    assert len(calls["template"]) == 1


def test_b2_daily_per_phone_cap(client, seed_gym, seed_member, monkeypatch):
    import app.mobile_api.member_api as member_api

    _enable_whatsapp(seed_gym)
    _mock_whatsapp(monkeypatch)
    # Cooldown off so the cap is what stops the 3rd send.
    monkeypatch.setattr(member_api, "OTP_SEND_COOLDOWN_SECONDS", 0)
    monkeypatch.setattr(member_api, "OTP_SENDS_PER_DAY_CAP", 2)

    challenges = []
    for _ in range(2):
        res = client.post(
            "/api/member/v1/auth/request-otp", json={"phone": seed_member.phone}
        )
        assert res.status_code == 200, res.get_data(as_text=True)[:300]
        challenges.append(res.get_json()["challenge"])

    third = client.post(
        "/api/member/v1/auth/request-otp", json={"phone": seed_member.phone}
    )
    assert third.status_code == 429, third.get_data(as_text=True)[:300]
    body = third.get_json()
    assert "today" in (body.get("error") or "").lower()
    # The still-valid last challenge is returned so the member can
    # still log in with the code they already have.
    assert body["challenge"] == challenges[-1]


# ─── V12-B3: guarded int() casts ─────────────────────────────────────


def test_b3_campaign_create_bad_attribution_window_is_400(client, seed_gym):
    res = client.post(
        "/api/mobile/v1/campaigns",
        headers=_owner_headers(seed_gym),
        json={
            "name": "Bad Window",
            "segment_type": "all_expired",
            "attribution_window_days": "abc",
        },
    )
    assert res.status_code == 400, res.get_data(as_text=True)[:300]
    assert Campaign.query.filter_by(name="Bad Window").first() is None


def test_b3_cooldown_check_bad_days_is_400(client, seed_gym):
    res = client.post(
        "/api/mobile/v1/campaigns/cooldown-check",
        headers=_owner_headers(seed_gym),
        json={"cooldown_days": "abc"},
    )
    assert res.status_code == 400, res.get_data(as_text=True)[:300]


def test_b3_bot_leads_bad_page_is_400(client, seed_gym, monkeypatch):
    monkeypatch.setattr(
        "app.mobile_api.bot.is_feature_enabled", lambda *a, **k: True
    )
    res = client.get(
        "/api/mobile/v1/bot/leads?page=abc", headers=_owner_headers(seed_gym)
    )
    assert res.status_code == 400, res.get_data(as_text=True)[:300]
    ok = client.get(
        "/api/mobile/v1/bot/leads?page=1", headers=_owner_headers(seed_gym)
    )
    assert ok.status_code == 200, ok.get_data(as_text=True)[:300]


# ─── V12-B4: renewal links use PUBLIC_BASE_URL ────────────────────────


def test_b4_renewal_link_uses_public_base_url(app, seed_gym, monkeypatch):
    _enable_whatsapp(seed_gym)
    calls = _mock_whatsapp(monkeypatch)
    app.config["PUBLIC_BASE_URL"] = "https://example.test"
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]

    member = _expiring_member(seed_gym, name="Link Member", phone="+919900000001")
    c = create_campaign(
        gym_id=gym.id,
        name="Link Campaign",
        segment_type="expiring_7d",
        created_by_id=owner.id,
        whatsapp_template_name="expired_member_reactivation_01",
    )
    res = send_campaign(c.id, gym.id)
    assert res["sent"] == 1, res
    assert len(calls["template"]) == 1
    body_params = calls["template"][0]["body_parameters"]
    renewal_link = body_params[3]
    assert renewal_link == f"https://example.test/renew/{member.id}", renewal_link
    assert "gym-production" not in renewal_link


# ─── V12-B5: no silent fallback to free-form text ─────────────────────


def test_b5_template_failure_marks_failed_no_text_sent(app, seed_gym, monkeypatch):
    _enable_whatsapp(seed_gym)
    calls = _mock_whatsapp(monkeypatch, template_ok=False)
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]

    _expiring_member(seed_gym, name="Member A", phone="+919900000001")
    c = create_campaign(
        gym_id=gym.id,
        name="Fail Campaign",
        segment_type="expiring_7d",
        created_by_id=owner.id,
        whatsapp_template_name="expired_member_reactivation_01",
    )
    res = send_campaign(c.id, gym.id)
    # Previously: the failure silently fell back to send_text and the
    # recipient was marked "sent" with raw marketing copy.
    assert res["sent"] == 0, res
    assert res["failed"] == 1, res
    assert calls["text"] == []
    recipient = CampaignRecipient.query.filter_by(campaign_id=c.id).first()
    assert recipient.status == "failed"
    assert "Template paused" in (recipient.error_message or "")


def test_b5_no_template_configured_fails_loudly(app, seed_gym, monkeypatch):
    _enable_whatsapp(seed_gym)
    calls = _mock_whatsapp(monkeypatch)
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]

    _expiring_member(seed_gym, name="Member A", phone="+919900000001")
    c = create_campaign(
        gym_id=gym.id,
        name="No Template",
        segment_type="expiring_7d",
        created_by_id=owner.id,
        whatsapp_template_name=None,
    )
    res = send_campaign(c.id, gym.id)
    assert res["sent"] == 0, res
    assert res["failed"] == 1, res
    assert calls["text"] == []
    assert calls["template"] == []
    recipient = CampaignRecipient.query.filter_by(campaign_id=c.id).first()
    assert recipient.status == "failed"
    assert "No WhatsApp template configured" in (recipient.error_message or "")


# ─── V12-B6: campaign rate limits ─────────────────────────────────────


def test_b6_campaign_create_limited_to_10_per_minute(client, seed_gym):
    statuses = []
    for i in range(11):
        res = client.post(
            "/api/mobile/v1/campaigns",
            headers=_owner_headers(seed_gym),
            json={"name": f"Limit {i}", "segment_type": "all_expired"},
        )
        statuses.append(res.status_code)
    assert statuses[:10] == [201] * 10, statuses
    assert statuses[10] == 429, statuses


def test_b6_campaign_send_limited_to_10_per_minute(client, seed_gym, monkeypatch):
    _enable_whatsapp(seed_gym)
    _mock_whatsapp(monkeypatch)
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]

    c = create_campaign(
        gym_id=gym.id,
        name="Send Limit",
        segment_type="all_expired",
        created_by_id=owner.id,
        whatsapp_template_name="expired_member_reactivation_01",
    )
    db.session.commit()
    statuses = []
    for _ in range(11):
        res = client.post(
            f"/api/mobile/v1/campaigns/{c.id}/send", headers=_owner_headers(seed_gym)
        )
        statuses.append(res.status_code)
    assert statuses[0] == 200, statuses
    assert statuses[10] == 429, statuses


# ─── V12-L9: reviewer-bypass verify is gym-scoped ────────────────────


def _reviewer_member(gym_id, *, name):
    m = Member(
        gym_id=gym_id,
        full_name=name,
        phone="+919999999999",
        status="active",
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=90),
    )
    db.session.add(m)
    db.session.commit()
    return m


def test_l9_reviewer_bypass_scoped_by_challenge_gym(app, client, seed_gym):
    from app.mobile_api.member_api import _sign_otp_challenge

    app.config["ENABLE_REVIEWER_BYPASS"] = True
    gym_a = seed_gym["gym"]
    member_a = _reviewer_member(gym_a.id, name="Reviewer Gym A")

    gym_b = Gym(
        name="Second Gym",
        slug="second-gym",
        email="owner@secondgym.com",
        phone="+919876543211",
        status="active",
    )
    db.session.add(gym_b)
    db.session.flush()
    member_b = _reviewer_member(gym_b.id, name="Reviewer Gym B")

    phone = "+919999999999"
    # Challenge minted for gym A (signed with a wrong OTP so the HMAC
    # path fails and the bypass path runs — exactly the L9 shape).
    challenge_a = _sign_otp_challenge(
        "919999999999", member_a.id, gym_a.id, "000000", int(time.time()) + 600
    )
    res_a = client.post(
        "/api/member/v1/auth/verify-otp",
        json={"phone": phone, "otp": "123456", "challenge": challenge_a},
    )
    assert res_a.status_code == 200, res_a.get_data(as_text=True)[:300]
    assert res_a.get_json()["data"]["member"]["id"] == member_a.id

    challenge_b = _sign_otp_challenge(
        "919999999999", member_b.id, gym_b.id, "000000", int(time.time()) + 600
    )
    res_b = client.post(
        "/api/member/v1/auth/verify-otp",
        json={"phone": phone, "otp": "123456", "challenge": challenge_b},
    )
    assert res_b.status_code == 200, res_b.get_data(as_text=True)[:300]
    assert res_b.get_json()["data"]["member"]["id"] == member_b.id

    # No challenge to scope by + ambiguous suffix match → no bind.
    res_none = client.post(
        "/api/member/v1/auth/verify-otp",
        json={"phone": phone, "otp": "123456"},
    )
    assert res_none.status_code == 400, res_none.get_data(as_text=True)[:300]


# ─── V12-M4: no-plan claim is rejected, not a ₹0 claim ───────────────


def test_m4_claim_with_no_plan_400s(client, seed_gym, seed_member):
    planless = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=None,
        full_name="No Plan Member",
        phone="+919100000077",
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=30),
        status="active",
    )
    db.session.add(planless)
    db.session.commit()

    res = client.post(
        "/api/member/v1/renew/claim",
        headers=_member_headers(planless),
        json={},
    )
    assert res.status_code == 400, res.get_data(as_text=True)[:300]
    assert "plan" in res.get_json()["error"].lower()
    assert (
        PaymentVerification.query.filter_by(member_id=planless.id).first() is None
    )

    # Control: a member WITH a plan still claims fine.
    ok = client.post(
        "/api/member/v1/renew/claim",
        headers=_member_headers(seed_member),
        json={"plan_id": seed_gym["plan"].id},
    )
    assert ok.status_code == 201, ok.get_data(as_text=True)[:300]


# ─── V8-L14 residual: create_member initial amount cap + 2dp ─────────


def test_v8l14_create_member_rejects_huge_and_3dp_amounts(client, seed_gym):
    today = date.today()
    base = {
        "full_name": "Big Spender",
        "plan_id": seed_gym["plan"].id,
        "membership_start": today.isoformat(),
        "membership_end": (today + timedelta(days=30)).isoformat(),
    }
    huge = client.post(
        "/api/mobile/v1/members",
        headers=_owner_headers(seed_gym),
        json={**base, "phone": "+919999900301", "amount": "100000000.00"},
    )
    assert huge.status_code == 400, huge.get_data(as_text=True)[:300]
    assert Member.query.filter_by(phone="+919999900301").first() is None

    three_dp = client.post(
        "/api/mobile/v1/members",
        headers=_owner_headers(seed_gym),
        json={**base, "phone": "+919999900302", "amount": "100.999"},
    )
    assert three_dp.status_code == 400, three_dp.get_data(as_text=True)[:300]
    assert Member.query.filter_by(phone="+919999900302").first() is None

    ok = client.post(
        "/api/mobile/v1/members",
        headers=_owner_headers(seed_gym),
        json={**base, "phone": "+919999900303", "amount": "100.50"},
    )
    assert ok.status_code == 201, ok.get_data(as_text=True)[:300]


# ─── V12-L4 follow-up: gym.timezone on member payloads ───────────────


def test_l4_member_payloads_carry_gym_timezone(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    gym.timezone = "Asia/Kolkata"
    db.session.commit()
    headers = _member_headers(seed_member)

    dashboard = client.get("/api/member/v1/dashboard", headers=headers)
    assert dashboard.status_code == 200, dashboard.get_data(as_text=True)[:300]
    assert dashboard.get_json()["data"]["gym"]["timezone"] == "Asia/Kolkata"

    membership = client.get("/api/member/v1/membership", headers=headers)
    assert membership.status_code == 200, membership.get_data(as_text=True)[:300]
    assert membership.get_json()["data"]["gym"]["timezone"] == "Asia/Kolkata"

    profile = client.get("/api/member/v1/profile", headers=headers)
    assert profile.status_code == 200, profile.get_data(as_text=True)[:300]
    assert profile.get_json()["data"]["gym"]["timezone"] == "Asia/Kolkata"


def test_v12_p8_provision_defaults_to_own_gym_name(client, seed_gym):
    """V12-P8 (backend half, coordinator-added): provisioning with no
    device_name must save the gym's OWN name, never another gym's
    ("Elite Gym eSSL terminal")."""
    from app.models.rrr import RRRIntegration

    resp = client.post(
        "/api/mobile/v1/rrr/integrations/adms/provision",
        headers=_owner_headers(seed_gym),
        json={"device_serial": "V12P8-TEST-01"},
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)[:300]
    row = RRRIntegration.query.filter_by(
        gym_id=seed_gym["gym"].id, connector_type="adms_direct"
    ).one()
    assert row.device_name == "Test Gym eSSL terminal"
    assert "Elite Gym" not in row.device_name


def test_v12_p8_provision_keeps_explicit_device_name(client, seed_gym):
    """V12-P8: an explicitly provided device_name is still respected."""
    from app.models.rrr import RRRIntegration

    resp = client.post(
        "/api/mobile/v1/rrr/integrations/adms/provision",
        headers=_owner_headers(seed_gym),
        json={"device_serial": "V12P8-TEST-02", "device_name": "Front Gate X2008"},
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)[:300]
    row = RRRIntegration.query.filter_by(
        gym_id=seed_gym["gym"].id, connector_type="adms_direct"
    ).one()
    assert row.device_name == "Front Gate X2008"
