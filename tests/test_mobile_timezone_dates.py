"""Regression coverage for gym-local mobile date boundaries."""
from datetime import date, datetime, timezone
from decimal import Decimal

import app.services.timezone_service as timezone_service
from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, PaymentVerification
from app.services.timezone_service import today_for_gym, utc_start_of_gym_day


EDGE_NOW_UTC = datetime(2026, 1, 1, 0, 30, tzinfo=timezone.utc)
LOCAL_TODAY = date(2025, 12, 31)
LOCAL_DAY_START_UTC = datetime(2025, 12, 31, 8, 0, tzinfo=timezone.utc)


def _freeze_gym_clock(monkeypatch) -> None:
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return EDGE_NOW_UTC.replace(tzinfo=None)
            return EDGE_NOW_UTC.astimezone(tz)

    monkeypatch.setattr(timezone_service, "datetime", FixedDateTime)


def _auth_headers(owner) -> dict[str, str]:
    token = create_access_token(owner.id, owner.gym_id, owner.role)
    return {"Authorization": f"Bearer {token}"}


def test_gym_timezone_helpers_use_local_calendar_day_at_utc_edge():
    assert today_for_gym("America/Los_Angeles", now=EDGE_NOW_UTC) == LOCAL_TODAY
    assert utc_start_of_gym_day(
        "America/Los_Angeles", local_date=LOCAL_TODAY
    ) == LOCAL_DAY_START_UTC


def test_mobile_date_paths_use_gym_local_day_at_utc_edge(client, seed_gym, monkeypatch):
    """Midnight UTC is still the previous business day for a Los Angeles gym."""
    _freeze_gym_clock(monkeypatch)
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    plan = seed_gym["plan"]
    gym.timezone = "America/Los_Angeles"

    before_local_day = datetime(2025, 12, 31, 7, 59, tzinfo=timezone.utc)
    # 07:59 UTC is 23:59 on Dec 30 in Los Angeles; 08:30 UTC is Dec 31.
    inside_local_day = datetime(2025, 12, 31, 8, 30, tzinfo=timezone.utc)

    expiring_today = Member(
        gym_id=gym.id,
        plan_id=plan.id,
        full_name="Local Today",
        phone="919999900001",
        membership_start=date(2025, 12, 1),
        membership_end=LOCAL_TODAY,
        status="active",
        created_at=before_local_day,
    )
    future_member = Member(
        gym_id=gym.id,
        plan_id=plan.id,
        full_name="Local Tomorrow",
        phone="919999900002",
        membership_start=date(2025, 12, 1),
        membership_end=date(2026, 1, 1),
        status="active",
        created_at=before_local_day,
    )
    expired_member = Member(
        gym_id=gym.id,
        plan_id=plan.id,
        full_name="Local Yesterday",
        phone="919999900003",
        membership_start=date(2025, 12, 1),
        membership_end=date(2025, 12, 30),
        status="expired",
        created_at=before_local_day,
    )
    newly_created = Member(
        gym_id=gym.id,
        plan_id=plan.id,
        full_name="Created Today",
        phone="919999900004",
        membership_start=LOCAL_TODAY,
        membership_end=date(2026, 1, 30),
        status="active",
        created_at=inside_local_day,
    )
    db.session.add_all([expiring_today, future_member, expired_member, newly_created])
    db.session.flush()

    payment_before_local_day = PaymentVerification(
        gym_id=gym.id,
        member_id=expiring_today.id,
        amount=Decimal("75.00"),
        paid_on=date(2025, 12, 30),
        method="cash",
        status="verified",
        renewal_days=30,
        verified_by_id=owner.id,
        verified_at=before_local_day,
    )
    payment_inside_local_day = PaymentVerification(
        gym_id=gym.id,
        member_id=expiring_today.id,
        amount=Decimal("125.00"),
        paid_on=LOCAL_TODAY,
        method="cash",
        status="verified",
        renewal_days=30,
        verified_by_id=owner.id,
        verified_at=inside_local_day,
    )
    payment_to_verify = PaymentVerification(
        gym_id=gym.id,
        member_id=expired_member.id,
        amount=Decimal("200.00"),
        paid_on=LOCAL_TODAY,
        method="cash",
        status="pending",
        renewal_days=30,
    )
    db.session.add_all(
        [payment_before_local_day, payment_inside_local_day, payment_to_verify]
    )
    db.session.commit()

    headers = _auth_headers(owner)

    dashboard = client.get("/api/mobile/v1/dashboard", headers=headers)
    assert dashboard.status_code == 200
    dashboard_data = dashboard.get_json()["data"]
    assert dashboard_data["expiring_today"] == 1
    assert Decimal(dashboard_data["revenue_today"]) == Decimal("125.00")

    upcoming = client.get("/api/mobile/v1/renewals/upcoming", headers=headers)
    assert upcoming.status_code == 200
    upcoming_members = {member["id"]: member for member in upcoming.get_json()["data"]["members"]}
    assert upcoming_members[expiring_today.id]["days_until_expiry"] == 0

    expired = client.get("/api/mobile/v1/renewals/expired", headers=headers)
    assert expired.status_code == 200
    assert expired_member.id in {
        member["id"] for member in expired.get_json()["data"]["members"]
    }

    report = client.get("/api/mobile/v1/reports/summary?period=today", headers=headers)
    assert report.status_code == 200
    report_data = report.get_json()["data"]
    assert report_data["members"]["new"] == 1
    assert Decimal(report_data["revenue"]["collected"]) == Decimal("125.00")

    created_member = client.post(
        "/api/mobile/v1/members",
        headers=headers,
        json={
            "full_name": "Created Through Mobile",
            "phone": "919999900006",
            "plan_id": plan.id,
        },
    )
    assert created_member.status_code == 201
    created_member_data = created_member.get_json()["data"]
    assert created_member_data["joined_on"] == LOCAL_TODAY.isoformat()
    assert created_member_data["membership_start"] == LOCAL_TODAY.isoformat()
    assert created_member_data["membership_end"] == LOCAL_TODAY.isoformat()
    assert created_member_data["days_until_expiry"] == 0

    direct_renewal_member = Member(
        gym_id=gym.id,
        plan_id=plan.id,
        full_name="Direct Renewal",
        phone="919999900005",
        membership_start=date(2025, 12, 1),
        membership_end=date(2025, 12, 30),
        status="expired",
    )
    db.session.add(direct_renewal_member)
    db.session.commit()
    direct_renewal = client.post(
        f"/api/mobile/v1/renewals/{direct_renewal_member.id}",
        headers=headers,
        json={"renewal_days": 30, "amount": "300.00"},
    )
    assert direct_renewal.status_code == 201
    assert direct_renewal.get_json()["data"]["new_start"] == LOCAL_TODAY.isoformat()

    created_payment = client.post(
        "/api/mobile/v1/payments",
        headers=headers,
        json={
            "member_id": expiring_today.id,
            "amount": "99.00",
            "method": "cash",
            "renewal_days": 30,
        },
    )
    assert created_payment.status_code == 201
    assert created_payment.get_json()["data"]["paid_on"] == LOCAL_TODAY.isoformat()

    verified = client.post(
        f"/api/mobile/v1/payments/{payment_to_verify.id}/verify", headers=headers
    )
    assert verified.status_code == 200
    db.session.refresh(expired_member)
    assert expired_member.membership_start == LOCAL_TODAY
