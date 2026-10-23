"""Tests for the member_id filter on GET /api/mobile/v1/payments.

The PWA member Renewal History screen lists every payment recorded for one
member; it relies on this filter instead of the fragile name search.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Gym, Member, PaymentVerification, User


def _owner_headers(seed_gym) -> dict[str, str]:
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    token = create_access_token(owner.id, gym.id, owner.role)
    return {"Authorization": f"Bearer {token}"}


def _add_member(gym, plan, name: str, phone: str) -> Member:
    member = Member(
        gym_id=gym.id,
        plan_id=plan.id,
        full_name=name,
        phone=phone,
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=30),
        status="active",
    )
    db.session.add(member)
    db.session.flush()
    return member


def _add_payment(gym, member, amount: str, *, days_ago: int = 0, status: str = "verified") -> PaymentVerification:
    payment = PaymentVerification(
        gym_id=gym.id,
        member_id=member.id,
        plan_id=member.plan_id,
        amount=Decimal(amount),
        paid_on=date.today() - timedelta(days=days_ago),
        method="upi",
        status=status,
        created_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
    )
    db.session.add(payment)
    db.session.flush()
    return payment


def _other_gym_member() -> Member:
    gym = Gym(
        name="Other Gym",
        slug="other-gym",
        email="owner@othergym.com",
        phone="+919876543211",
        status="active",
        subscription_status="trial",
        trial_ends_at=date.today() + timedelta(days=14),
        max_members=50,
    )
    db.session.add(gym)
    db.session.flush()
    member = Member(
        gym_id=gym.id,
        full_name="Outsider Olivia",
        phone="+919111122223",
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=30),
        status="active",
    )
    db.session.add(member)
    db.session.flush()
    _add_payment(gym, member, "999.00")
    db.session.commit()
    return member


def test_member_id_filter_returns_only_that_members_payments(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    plan = seed_gym["plan"]
    other = _add_member(gym, plan, "Jane Roe", "+919998887775")
    mine_old = _add_payment(gym, seed_member, "1000.00", days_ago=20)
    mine_new = _add_payment(gym, seed_member, "1000.00", days_ago=2)
    _add_payment(gym, other, "1500.00", days_ago=1)
    db.session.commit()

    res = client.get(
        f"/api/mobile/v1/payments?member_id={seed_member.id}",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert data["pagination"]["total"] == 2
    ids = [p["id"] for p in data["payments"]]
    assert set(ids) == {mine_old.id, mine_new.id}
    # Newest first
    assert ids == [mine_new.id, mine_old.id]
    assert all(p["member_id"] == seed_member.id for p in data["payments"])


def test_payments_without_member_id_still_returns_all_gym_payments(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    plan = seed_gym["plan"]
    other = _add_member(gym, plan, "Jane Roe", "+919998887775")
    _add_payment(gym, seed_member, "1000.00")
    _add_payment(gym, other, "1500.00")
    db.session.commit()

    res = client.get("/api/mobile/v1/payments", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert data["pagination"]["total"] == 2
    assert {p["member_id"] for p in data["payments"]} == {seed_member.id, other.id}


def test_member_id_filter_combines_with_status(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    verified = _add_payment(gym, seed_member, "1000.00", status="verified")
    _add_payment(gym, seed_member, "1000.00", status="pending")
    db.session.commit()

    res = client.get(
        f"/api/mobile/v1/payments?member_id={seed_member.id}&status=verified",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert data["pagination"]["total"] == 1
    assert data["payments"][0]["id"] == verified.id


def test_member_id_from_another_gym_returns_empty(client, seed_gym, seed_member):
    outsider = _other_gym_member()
    _add_payment(seed_gym["gym"], seed_member, "1000.00")
    db.session.commit()

    res = client.get(
        f"/api/mobile/v1/payments?member_id={outsider.id}",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert data["payments"] == []
    assert data["pagination"]["total"] == 0


def test_member_with_no_payments_returns_empty(client, seed_gym, seed_member):
    res = client.get(
        f"/api/mobile/v1/payments?member_id={seed_member.id}",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert data["payments"] == []
    assert data["pagination"]["total"] == 0
