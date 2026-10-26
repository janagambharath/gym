"""Strict date repair (Yodha fix): entry points reject off-grid dates.

- Member create / edit: an end off the plan grid is rejected, not
  silently clamped; date edits are owner-only.
- Record Payment / direct renewal: renewal_days must equal the plan
  duration unless the gym owner supplies an override reason.
- Date Repair confirm: a review-only historyless_pushed_end is only
  written when the owner explicitly confirms no extra paid time;
  Apply alone still refuses it.
"""
from datetime import date, timedelta

from app.extensions import db
from app.mobile_api.date_rules import grid_error, plan_days_error
from app.mobile_api.token_service import create_access_token
from app.models import Member, User


def _headers(user, gym):
    token = create_access_token(user.id, gym.id, user.role)
    return {"Authorization": f"Bearer {token}"}


def _staff(seed_gym):
    gym = seed_gym["gym"]
    staff = User(gym_id=gym.id, email="staff2@testgym.com", full_name="Staff", role="staff")
    staff.set_password("SecurePass123!")
    db.session.add(staff)
    db.session.commit()
    return staff


def test_grid_rules():
    start = date(2026, 9, 22)
    assert grid_error(start, start + timedelta(days=29), 30) is None
    assert grid_error(start, start + timedelta(days=30), 30) is None
    assert grid_error(start, start + timedelta(days=31), 30) is not None
    assert grid_error(start, start - timedelta(days=1), 30) is not None
    assert grid_error(start, start + timedelta(days=364), 365) is None
    assert grid_error(start, start + timedelta(days=365), 365) is None


def test_plan_days_rules():
    assert plan_days_error(30, 30, override_reason=None, is_owner=False) is None
    assert plan_days_error(45, 30, override_reason=None, is_owner=True) is not None
    assert plan_days_error(45, 30, override_reason=" ", is_owner=True) is not None
    assert plan_days_error(45, 30, override_reason=None, is_owner=False) is not None
    assert (
        plan_days_error(45, 30, override_reason="freeze extension", is_owner=True)
        is None
    )


def test_member_create_rejects_off_grid_end(client, seed_gym):
    today = date.today()
    res = client.post(
        "/api/mobile/v1/members",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
        json={
            "full_name": "Off Grid",
            "phone": "+919999900101",
            "plan_id": seed_gym["plan"].id,
            "membership_start": today.isoformat(),
            "membership_end": (today + timedelta(days=63)).isoformat(),
        },
    )
    assert res.status_code == 400
    assert Member.query.filter_by(full_name="Off Grid").first() is None

    res = client.post(
        "/api/mobile/v1/members",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
        json={
            "full_name": "On Grid",
            "phone": "+919999900102",
            "plan_id": seed_gym["plan"].id,
            "membership_start": today.isoformat(),
            "membership_end": (today + timedelta(days=30)).isoformat(),
        },
    )
    assert res.status_code == 201


def test_member_patch_dates_owner_only_and_on_grid(client, seed_gym, seed_member):
    staff = _staff(seed_gym)
    res = client.patch(
        f"/api/mobile/v1/members/{seed_member.id}",
        headers=_headers(staff, seed_gym["gym"]),
        json={"membership_end": (date.today() + timedelta(days=29)).isoformat()},
    )
    assert res.status_code == 403

    owner_headers = _headers(seed_gym["owner"], seed_gym["gym"])
    res = client.patch(
        f"/api/mobile/v1/members/{seed_member.id}",
        headers=owner_headers,
        json={"membership_end": (date.today() + timedelta(days=60)).isoformat()},
    )
    assert res.status_code == 400
    db.session.refresh(seed_member)
    assert seed_member.membership_end == date.today() + timedelta(days=30)

    res = client.patch(
        f"/api/mobile/v1/members/{seed_member.id}",
        headers=owner_headers,
        json={"membership_end": (date.today() + timedelta(days=29)).isoformat()},
    )
    assert res.status_code == 200
    db.session.refresh(seed_member)
    assert seed_member.membership_end == date.today() + timedelta(days=29)


def test_payment_rejects_free_typed_days_without_owner_override(
    client, seed_gym, seed_member
):
    base = {"member_id": seed_member.id, "amount": "1000.00"}
    owner_headers = _headers(seed_gym["owner"], seed_gym["gym"])
    res = client.post(
        "/api/mobile/v1/payments",
        headers=owner_headers,
        json={**base, "renewal_days": 45},
    )
    assert res.status_code == 400

    res = client.post(
        "/api/mobile/v1/payments",
        headers=owner_headers,
        json={**base, "renewal_days": 45, "override_reason": "freeze extension"},
    )
    assert res.status_code == 201

    res = client.post(
        "/api/mobile/v1/payments",
        headers=_headers(_staff(seed_gym), seed_gym["gym"]),
        json={**base, "renewal_days": 45, "override_reason": "freeze extension"},
    )
    assert res.status_code == 400


def test_direct_renewal_rejects_free_typed_days_without_owner_override(
    client, seed_gym, seed_member
):
    owner_headers = _headers(seed_gym["owner"], seed_gym["gym"])
    original_end = seed_member.membership_end
    res = client.post(
        f"/api/mobile/v1/renewals/{seed_member.id}",
        headers=owner_headers,
        json={"renewal_days": 45, "amount": "1000.00"},
    )
    assert res.status_code == 400
    db.session.refresh(seed_member)
    assert seed_member.membership_end == original_end

    res = client.post(
        f"/api/mobile/v1/renewals/{seed_member.id}",
        headers=owner_headers,
        json={"renewal_days": 30, "amount": "1000.00"},
    )
    assert res.status_code == 201


def test_date_repair_confirm_historyless_only_with_confirmation(
    client, seed_gym
):
    today = date.today()
    start = today - timedelta(days=100)
    # 30-day plan, period span 31: period containing today ends at
    # start + 3*31 + 30 = today + 23. Stored end today + 100 is past it.
    expected_end = start + timedelta(days=123)
    m = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
        full_name="Historyless",
        phone="+919999900201",
        membership_start=start,
        membership_end=today + timedelta(days=100),
        status="active",
    )
    db.session.add(m)
    db.session.commit()
    headers = _headers(seed_gym["owner"], seed_gym["gym"])

    res = client.get("/api/mobile/v1/date-repair/scan", headers=headers)
    flagged = res.get_json()["data"]["flagged"]
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "historyless_pushed_end"
    assert flagged[0]["expected_end"] == expected_end.isoformat()

    res = client.post(
        "/api/mobile/v1/date-repair/apply", headers=headers, json={"member_ids": [m.id]}
    )
    assert res.get_json()["data"]["results"][0]["reason"] == "needs_review"

    res = client.post(
        "/api/mobile/v1/date-repair/confirm",
        headers=headers,
        json={"member_ids": [m.id]},
    )
    assert res.status_code == 400

    res = client.post(
        "/api/mobile/v1/date-repair/confirm",
        headers=headers,
        json={"member_ids": [m.id], "confirmed_no_extra_payment": True},
    )
    assert res.status_code == 200
    assert res.get_json()["data"]["results"][0]["applied"] is True
    db.session.refresh(m)
    assert m.membership_end == expected_end
