"""Date repair payment-coverage scan.

Covers the case the old scan missed (sheru, Oct 2026): a member
whose stored period is longer than the verified payments cover, with
a ledger gap inside the stored period, was never flagged because a
restart gap suppressed every later check and payments were only
displayed, never compared.

- payment_coverage_gap: stored period holds more plan periods than
  verified payments cover, and/or a ledger gap falls inside the
  stored period. Review-only: a cash payment taken offline, a free
  period or a discount can explain it, so Apply never corrects it.
- A legitimate restart whose gap is *before* the stored start, and
  whose restart period is paid, is still not flagged.
- A fully paid chained member is still not flagged.
"""
from datetime import date, timedelta
from decimal import Decimal

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, PaymentVerification, RenewalHistory


def _auth_headers(user, gym):
    token = create_access_token(user.id, gym.id, user.role)
    return {"Authorization": f"Bearer {token}"}


def _member(seed_gym, name, start, end):
    m = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
        full_name=name,
        phone="+919999900001",
        membership_start=start,
        membership_end=end,
        status="active",
    )
    db.session.add(m)
    db.session.commit()
    return m


def _row(seed_gym, member, owner, previous_end, new_start, new_end):
    db.session.add(
        RenewalHistory(
            gym_id=seed_gym["gym"].id,
            member_id=member.id,
            plan_id=seed_gym["plan"].id,
            renewed_by_id=owner.id,
            previous_end=previous_end,
            new_start=new_start,
            new_end=new_end,
            amount=1000,
        )
    )


def _payment(seed_gym, member, amount, renewal_days, paid_on):
    db.session.add(
        PaymentVerification(
            gym_id=seed_gym["gym"].id,
            member_id=member.id,
            plan_id=seed_gym["plan"].id,
            amount=Decimal(str(amount)),
            method="upi",
            status="verified",
            renewal_days=renewal_days,
            paid_on=paid_on,
            is_test=False,
        )
    )


def test_payment_coverage_gap_flagged_for_review(client, seed_gym):
    # Sheru shape: Monthly, stored Sep 24 -> Dec 24 (about 3 periods),
    # but only one verified payment (30 days) and one renewal
    # Nov 25 -> Dec 24. The renewal's previous end is Nov 24 — the
    # hand-pushed end it chained from — so there is no creation row
    # on record, matching the screenshot's "Membership Renewals (1)".
    owner = seed_gym["owner"]
    start = date(2026, 9, 24)
    renewal_start = date(2026, 11, 25)
    end = date(2026, 12, 24)
    m = _member(seed_gym, "Sheru", start, end)
    _row(seed_gym, m, owner, date(2026, 11, 24), renewal_start, end)
    _payment(seed_gym, m, 1500, 30, date(2026, 10, 26))
    db.session.commit()

    headers = _auth_headers(owner, seed_gym["gym"])
    res = client.get("/api/mobile/v1/date-repair/scan", headers=headers)
    flagged = res.get_json()["data"]["flagged"]
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "payment_coverage_gap"
    assert flagged[0]["confidence"] == "review"
    assert flagged[0]["paid_days"] == 30
    assert flagged[0]["expected_periods"] == 3
    assert flagged[0]["paid_periods"] == 1
    assert "proposed_end" not in flagged[0]
    assert "expected_end" not in flagged[0]

    res = client.post(
        "/api/mobile/v1/date-repair/apply",
        headers=headers,
        json={"member_ids": [m.id]},
    )
    result = res.get_json()["data"]["results"][0]
    assert result == {"member_id": m.id, "applied": False, "reason": "needs_review"}
    db.session.refresh(m)
    assert m.membership_end == end


def test_no_payment_member_left_alone(client, seed_gym):
    # Same stored period as sheru, but no payment on record at all:
    # the payment scan must not touch this member, even though the
    # ledger has no period covering Sep 24 -> Nov 24.
    owner = seed_gym["owner"]
    start = date(2026, 9, 24)
    end = date(2026, 12, 24)
    m = _member(seed_gym, "NoPayment", start, end)
    _row(seed_gym, m, owner, date(2026, 11, 24), date(2026, 11, 25), end)
    db.session.commit()
    res = client.get(
        "/api/mobile/v1/date-repair/scan",
        headers=_auth_headers(owner, seed_gym["gym"]),
    )
    assert res.get_json()["data"]["flagged"] == []


def test_paid_restart_not_flagged(client, seed_gym):
    # Legitimate restart: the gap is before the stored start, and
    # the restart period itself is paid.
    owner = seed_gym["owner"]
    base = date(2026, 6, 1)
    first_end = base + timedelta(days=30)
    restart_start = first_end + timedelta(days=40)
    restart_end = restart_start + timedelta(days=30)
    m = _member(seed_gym, "RestartedPaid", restart_start, restart_end)
    _row(seed_gym, m, owner, base, base, first_end)
    _row(seed_gym, m, owner, first_end, restart_start, restart_end)
    _payment(seed_gym, m, 1000, 30, restart_start)
    db.session.commit()
    res = client.get(
        "/api/mobile/v1/date-repair/scan",
        headers=_auth_headers(owner, seed_gym["gym"]),
    )
    assert res.get_json()["data"]["flagged"] == []


def test_fully_paid_chained_member_not_flagged(client, seed_gym):
    owner = seed_gym["owner"]
    start = date(2026, 9, 16)
    first_end = start + timedelta(days=30)
    second_start = first_end + timedelta(days=1)
    second_end = second_start + timedelta(days=30)
    m = _member(seed_gym, "PaidChained", start, second_end)
    _row(seed_gym, m, owner, start, start, first_end)
    _row(seed_gym, m, owner, first_end, second_start, second_end)
    _payment(seed_gym, m, 1000, 30, start)
    _payment(seed_gym, m, 1000, 30, second_start)
    db.session.commit()
    res = client.get(
        "/api/mobile/v1/date-repair/scan",
        headers=_auth_headers(owner, seed_gym["gym"]),
    )
    assert res.get_json()["data"]["flagged"] == []
