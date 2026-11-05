from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from app.extensions import db
from app.models import AccessEvent, Member, NotificationTemplate, ReminderLog, RenewalHistory
from app.models.qr_settings import QRSettings
from app.models.rrr import RRROpportunity
from app.services.campaign_service import get_segment_members
from app.services.retention_service import _last_visit_map, _send_nudge, run_retention_nudges_for_gym
from app.services.rrr_service import dashboard_for_gym, normalize_attendance, refresh_opportunities
from app.services.revenue_service import recovery_rate, revenue_at_risk
from app.services.timezone_service import today_for_gym
from app.mobile_api.token_service import create_access_token


def _headers(seed_gym):
    owner, gym = seed_gym["owner"], seed_gym["gym"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, gym.id, owner.role)}"}


def test_retention_reads_the_shared_rrr_attendance_table(seed_gym, seed_member):
    gym = seed_gym["gym"]
    seed_member.device_enroll_number = "42"
    event, created = normalize_attendance(
        gym_id=gym.id,
        source="adms_direct",
        biometric_user_id="42",
        punch_time=datetime.now(timezone.utc) - timedelta(days=2),
        external_event_id="retention-event-1",
        device_serial="X2008",
    )
    db.session.commit()

    assert created is True
    assert event.member_id == seed_member.id
    assert _last_visit_map(gym.id)[seed_member.id] == event.punch_time


def test_retention_nudge_writes_a_valid_retryable_reminder_log(seed_gym, seed_member, monkeypatch):
    gym = seed_gym["gym"]
    seed_member.whatsapp_opted_in = True
    seed_member.last_inbound_at = datetime.now(timezone.utc)
    db.session.add(NotificationTemplate(
        gym_id=gym.id,
        name="Legacy retention copy",
        channel="whatsapp",
        trigger="retention_no_visit",
        days_before=0,
        message_body="Hi {member_name}, welcome back to {gym_name}.",
        is_active=True,
    ))
    db.session.commit()

    class FakeWhatsApp:
        def __init__(self, _gym):
            pass

        def send_text(self, *, to, body):
            assert to
            assert "John Doe" in body and "Test Gym" in body
            return SimpleNamespace(ok=True, error=None, provider_message_id="wamid.test")

        def send_template(self, **_kwargs):
            raise AssertionError("No proactive template is configured in this test")

    monkeypatch.setattr("app.services.retention_service.WhatsAppService", FakeWhatsApp)
    assert _send_nudge(gym, seed_member, "retention_no_visit", "Asia/Kolkata") is True

    log = ReminderLog.query.filter_by(member_id=seed_member.id, reminder_stage="retention_no_visit").one()
    assert log.status == "sent"
    assert log.sent_at is not None
    assert log.provider_message_id == "wamid.test"
    assert log.message_snapshot and "John Doe" in log.message_snapshot


def test_new_member_without_punches_is_not_flagged_as_absent(seed_gym, seed_member):
    seed_member.membership_start = today_for_gym(seed_gym["gym"].timezone)
    seed_member.membership_end = today_for_gym(seed_gym["gym"].timezone) + timedelta(days=30)
    db.session.commit()

    rows = refresh_opportunities(seed_gym["gym"].id, seed_gym["gym"].timezone)
    assert not any(row.member_id == seed_member.id and row.reason_code == "no_recent_visit" for row in rows)


def test_manual_access_checkin_counts_as_a_recent_visit(seed_gym, seed_member):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone)
    seed_member.membership_start = today - timedelta(days=25)
    seed_member.membership_end = today + timedelta(days=30)
    db.session.add(AccessEvent(
        gym_id=gym.id,
        member_id=seed_member.id,
        event_type="ENTRY",
        direction="IN",
        event_timestamp=datetime.now(timezone.utc),
        device_enroll_number="42",
        source_event_id="manual-entry-today",
    ))
    db.session.commit()

    rows = refresh_opportunities(gym.id, gym.timezone)
    assert not any(
        row.member_id == seed_member.id and row.reason_code == "no_recent_visit"
        for row in rows
    )


def test_attendance_rate_only_counts_current_active_members(seed_gym, seed_member):
    from app.models import Member

    gym = seed_gym["gym"]
    expired = Member(
        gym_id=gym.id,
        plan_id=seed_gym["plan"].id,
        full_name="Expired Visitor",
        phone="+919998887771",
        membership_start=date.today() - timedelta(days=60),
        membership_end=date.today() - timedelta(days=1),
        status="expired",
    )
    db.session.add(expired)
    db.session.flush()
    now = datetime.now(timezone.utc)
    for member, event_id in ((seed_member, "active-entry"), (expired, "expired-entry")):
        db.session.add(AccessEvent(
            gym_id=gym.id,
            member_id=member.id,
            event_type="ENTRY",
            direction="IN",
            event_timestamp=now,
            device_enroll_number=str(member.id),
            source_event_id=event_id,
        ))
    db.session.commit()

    result = dashboard_for_gym(gym.id, gym.timezone)
    assert result["members"]["active"] == 1
    assert result["members"]["attendance_rate"] == 100.0


def test_setup_checklist_does_not_count_placeholder_plan_or_blank_qr(seed_gym):
    gym = seed_gym["gym"]
    seed_gym["plan"].price = 0
    db.session.add(QRSettings(gym_id=gym.id, payment_label=gym.name))
    db.session.commit()

    result = dashboard_for_gym(gym.id, gym.timezone)
    assert result["plans_count"] == 0
    assert result["payment_setup_done"] is False


def test_at_risk_estimate_uses_plan_price_for_legacy_zero_price_member(seed_gym, seed_member):
    gym = seed_gym["gym"]
    seed_member.price = 0
    seed_member.membership_end = today_for_gym(gym.timezone) + timedelta(days=3)
    db.session.commit()

    result = revenue_at_risk(gym.id, gym.timezone)
    assert result["expiring_count"] == 1
    assert result["expiring_amount"] == "1000.00"


def test_attendance_drop_uses_distinct_local_visit_days(seed_gym, seed_member):
    from zoneinfo import ZoneInfo

    from app.services.timezone_service import today_for_gym

    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone)
    zone = ZoneInfo(gym.timezone or "Asia/Kolkata")
    seed_member.membership_start = today - timedelta(days=40)
    seed_member.membership_end = today + timedelta(days=60)
    seed_member.device_enroll_number = "42"
    db.session.commit()

    # Two baseline visit days each have entry and exit punches; recent visits
    # have only one punch per day. Raw-punch counting falsely reports a 50%
    # decline even though the member attended on the same number of days.
    for day_offset, directions in ((20, ("entry", "exit")), (18, ("entry", "exit")), (2, ("entry",)), (1, ("entry",))):
        local_punch = datetime.combine(today - timedelta(days=day_offset), datetime.min.time(), tzinfo=zone).replace(hour=12)
        for index, direction in enumerate(directions):
            normalize_attendance(
                gym_id=gym.id,
                source="adms_direct",
                biometric_user_id="42",
                punch_time=local_punch.astimezone(timezone.utc) + timedelta(minutes=index),
                external_event_id=f"visit-{day_offset}-{direction}",
                device_serial="X2008",
                direction=direction,
            )
    db.session.commit()

    rows = refresh_opportunities(gym.id, gym.timezone)
    assert not any(
        row.member_id == seed_member.id and row.reason_code == "attendance_decline"
        for row in rows
    )


def test_attendance_resolves_a_stale_no_visit_opportunity(seed_gym, seed_member):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone)
    seed_member.membership_start = today - timedelta(days=20)
    seed_member.membership_end = today + timedelta(days=45)
    seed_member.device_enroll_number = "42"
    db.session.commit()
    normalize_attendance(
        gym_id=gym.id,
        source="adms_direct",
        biometric_user_id="42",
        punch_time=datetime.now(timezone.utc) - timedelta(days=20),
        external_event_id="baseline-visit",
        device_serial="X2008",
    )
    db.session.commit()
    refresh_opportunities(gym.id, gym.timezone)
    stale = RRROpportunity.query.filter_by(
        gym_id=gym.id, member_id=seed_member.id, reason_code="no_recent_visit"
    ).one()
    assert stale.status == "open"

    event, _ = normalize_attendance(
        gym_id=gym.id,
        source="adms_direct",
        biometric_user_id="42",
        punch_time=datetime.now(timezone.utc),
        external_event_id="latest-visit",
        device_serial="X2008",
    )
    db.session.commit()
    refresh_opportunities(gym.id, gym.timezone)
    db.session.flush()
    db.session.refresh(stale)
    assert stale.status == "resolved"

    event.punch_time = datetime.now(timezone.utc) - timedelta(days=15)
    db.session.commit()
    refresh_opportunities(gym.id, gym.timezone)
    db.session.flush()
    db.session.refresh(stale)
    assert stale.status == "open"


def test_a_new_membership_cycle_can_create_a_new_expiry_opportunity(seed_gym, seed_member):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone)
    seed_member.membership_start = today - timedelta(days=25)
    seed_member.membership_end = today + timedelta(days=5)
    db.session.commit()
    refresh_opportunities(gym.id, gym.timezone)
    db.session.flush()
    first = RRROpportunity.query.filter_by(
        gym_id=gym.id, member_id=seed_member.id, reason_code="expiry_approaching"
    ).one()
    first.status = "closed"
    db.session.commit()

    seed_member.membership_start = today
    seed_member.membership_end = today + timedelta(days=30)
    db.session.commit()
    refresh_opportunities(gym.id, gym.timezone)
    db.session.flush()
    rows = RRROpportunity.query.filter_by(
        gym_id=gym.id, member_id=seed_member.id, reason_code="expiry_approaching"
    ).all()
    assert len(rows) == 2
    assert {row.status for row in rows} == {"closed", "open"}


def test_inactive_campaign_segment_uses_punches_and_membership_age(seed_gym, seed_member):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone)
    seed_member.membership_start = today - timedelta(days=90)
    seed_member.membership_end = today + timedelta(days=30)
    seed_member.device_enroll_number = "42"
    seed_member.whatsapp_opted_in = True
    seed_member.updated_at = datetime.now(timezone.utc) - timedelta(days=120)
    db.session.flush()

    quiet = Member(
        gym_id=gym.id,
        plan_id=seed_gym["plan"].id,
        full_name="Quiet Member",
        phone="+919998887775",
        membership_start=today - timedelta(days=45),
        membership_end=today + timedelta(days=45),
        status="active",
        whatsapp_opted_in=True,
        device_enroll_number="43",
    )
    new_member = Member(
        gym_id=gym.id,
        plan_id=seed_gym["plan"].id,
        full_name="New Member",
        phone="+919998887774",
        membership_start=today - timedelta(days=2),
        membership_end=today + timedelta(days=28),
        status="active",
        whatsapp_opted_in=True,
    )
    opted_out = Member(
        gym_id=gym.id,
        plan_id=seed_gym["plan"].id,
        full_name="Opted-out Member",
        phone="+919998887770",
        membership_start=today - timedelta(days=60),
        membership_end=today + timedelta(days=30),
        status="active",
        whatsapp_opted_in=False,
    )
    db.session.add_all([quiet, new_member, opted_out])
    db.session.flush()
    normalize_attendance(
        gym_id=gym.id,
        source="adms_direct",
        biometric_user_id="42",
        punch_time=datetime.now(timezone.utc) - timedelta(days=5),
        external_event_id="recent-visit",
        device_serial="X2008",
    )
    normalize_attendance(
        gym_id=gym.id,
        source="adms_direct",
        biometric_user_id="43",
        punch_time=datetime.now(timezone.utc) - timedelta(days=40),
        external_event_id="quiet-member-old-visit",
        device_serial="X2008",
    )
    db.session.commit()

    selected = get_segment_members(gym.id, "inactive_30d", gym.timezone)
    assert {member.id for member in selected} == {quiet.id}


def test_winback_catches_up_with_only_latest_due_stage(seed_gym, seed_member, monkeypatch):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone)
    gym.whatsapp_enabled = True
    gym.phone_number_id = "test-phone-id"
    expired = Member(
        gym_id=gym.id,
        plan_id=seed_gym["plan"].id,
        full_name="Expired Member",
        phone="+919998887771",
        whatsapp_opted_in=True,
        membership_start=today - timedelta(days=90),
        membership_end=today - timedelta(days=20),
        status="expired",
    )
    db.session.add(expired)
    db.session.commit()
    sent_stages = []

    def fake_send(_gym, _member, trigger, _timezone):
        sent_stages.append(trigger)
        return True

    monkeypatch.setattr("app.services.retention_service._send_nudge", fake_send)
    result = run_retention_nudges_for_gym(gym.id, gym.timezone)

    assert result["winback"] == 1
    assert sent_stages == ["retention_winback_3"]


def test_member_attendance_api_returns_terminal_user_id(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    seed_member.device_enroll_number = "42"
    db.session.commit()
    normalize_attendance(
        gym_id=gym.id,
        source="adms_direct",
        biometric_user_id="42",
        punch_time=datetime.now(timezone.utc),
        external_event_id="member-history-event",
        device_serial="X2008",
        verify_method="fingerprint",
    )
    db.session.commit()

    response = client.get(
        f"/api/mobile/v1/rrr/member/{seed_member.id}/attendance?page=1&per_page=50",
        headers=_headers(seed_gym),
    )
    payload = response.get_json()["data"]
    assert response.status_code == 200
    assert payload["stats"]["total_punches"] == 1
    assert payload["events"][0]["biometric_user_id"] == "42"
    assert payload["events"][0]["verify_method"] == "fingerprint"


def test_rrr_recovery_rejects_non_finite_and_negative_amounts(client, seed_gym, seed_member):
    row = RRROpportunity(
        gym_id=seed_gym["gym"].id,
        member_id=seed_member.id,
        pillar="retain",
        reason_code="test",
        reason_text="Test recovery validation",
        potential_revenue=100,
        dedupe_key="test-recovery-validation",
    )
    db.session.add(row)
    db.session.commit()

    for value in ("NaN", "-1"):
        response = client.patch(
            f"/api/mobile/v1/rrr/opportunities/{row.id}",
            headers=_headers(seed_gym),
            json={"status": "closed", "outcome_revenue": value},
        )
        assert response.status_code == 422

    db.session.refresh(row)
    assert row.status == "open"


def test_recovery_rate_uses_matching_expiry_cohort(seed_gym, seed_member):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone)
    seed_member.price = 1000
    seed_member.membership_end = today + timedelta(days=45)
    history = RenewalHistory(
        gym_id=gym.id,
        member_id=seed_member.id,
        plan_id=seed_gym["plan"].id,
        previous_start=today - timedelta(days=35),
        previous_end=today - timedelta(days=5),
        new_start=today - timedelta(days=4),
        new_end=today + timedelta(days=45),
        standard_price=1000,
        amount=800,
        is_test=False,
    )
    expired = Member(
        gym_id=gym.id,
        plan_id=seed_gym["plan"].id,
        full_name="Not Renewed",
        phone="+919998887773",
        membership_start=today - timedelta(days=60),
        membership_end=today - timedelta(days=4),
        price=1000,
        status="expired",
    )
    db.session.add_all([history, expired])
    db.session.commit()

    result = recovery_rate(gym.id, gym.timezone)
    # H1: revenue_at_risk is the canonical at-risk total (expired member's
    # 1000), the same number the dashboard and reports return — not the
    # rate denominator (at-risk + renewed cohort expected), which lives in
    # recovery_denominator. The genuine renewal still counts: its row is
    # the member's first ledger row but new_start is previous_end + 1, so
    # it is not a signup creation row (B-H3).
    assert result["revenue_at_risk"] == "1000.00"
    assert result["recovery_denominator"] == "2000.00"
    assert result["revenue_recovered"] == "800.00"
    assert result["recovery_rate"] == "40.0"


def test_reports_renewal_rate_uses_expiries_from_selected_period(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone)
    seed_member.membership_end = today + timedelta(days=40)
    renewed = RenewalHistory(
        gym_id=gym.id,
        member_id=seed_member.id,
        plan_id=seed_gym["plan"].id,
        previous_end=today - timedelta(days=3),
        new_start=today - timedelta(days=2),
        new_end=today + timedelta(days=40),
        standard_price=1000,
        amount=900,
        is_test=False,
    )
    expired = Member(
        gym_id=gym.id,
        full_name="Expired in cohort",
        phone="+919998887772",
        membership_start=today - timedelta(days=50),
        membership_end=today - timedelta(days=7),
        status="expired",
    )
    db.session.add_all([renewed, expired])
    db.session.commit()

    response = client.get("/api/mobile/v1/reports/summary?period=30d", headers=_headers(seed_gym))
    assert response.status_code == 200
    assert response.get_json()["data"]["renewals"]["renewal_rate"] == 50.0
