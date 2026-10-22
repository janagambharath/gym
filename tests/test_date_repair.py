"""Date repair scan/apply endpoints (owner-only).

Covers the three classifications:
- span_mismatch: no ledger, span longer than one plan period.
- ledger_mismatch: stored end disagrees with the renewal ledger.
- oversized_renewal: a renewal applied more days than the plan allows.
Plus: healthy members are not flagged, staff are forbidden, and apply
only writes the server-recomputed proposal.
"""
from datetime import date, timedelta

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, RenewalHistory, User


def _auth_headers(user, gym) -> dict[str, str]:
    token = create_access_token(user.id, gym.id, user.role)
    return {"Authorization": f"Bearer {token}"}


def _member(seed_gym, name, start, end, plan=None):
    gym = seed_gym["gym"]
    plan = plan or seed_gym["plan"]
    m = Member(
        gym_id=gym.id,
        plan_id=plan.id,
        full_name=name,
        phone="+919999900001",
        membership_start=start,
        membership_end=end,
        status="active",
    )
    db.session.add(m)
    db.session.commit()
    return m


def _staff(seed_gym):
    gym = seed_gym["gym"]
    staff = User(
        gym_id=gym.id,
        email="staff@testgym.com",
        full_name="Staff",
        role="staff",
    )
    staff.set_password("SecurePass123!")
    db.session.add(staff)
    db.session.commit()
    return staff


START = date(2026, 9, 16)


def test_healthy_member_not_flagged(client, seed_gym):
    _member(seed_gym, "Healthy", START, START + timedelta(days=30))
    res = client.get(
        "/api/mobile/v1/date-repair/scan",
        headers=_auth_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert res.status_code == 200
    assert res.get_json()["data"]["flagged"] == []


def test_span_mismatch_flagged_and_repaired(client, seed_gym):
    # Monthly plan (30d) but the member spans 91 days with no history.
    m = _member(seed_gym, "Inflated", START, START + timedelta(days=91))
    headers = _auth_headers(seed_gym["owner"], seed_gym["gym"])
    res = client.get("/api/mobile/v1/date-repair/scan", headers=headers)
    flagged = res.get_json()["data"]["flagged"]
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "span_mismatch"
    assert flagged[0]["proposed_end"] == (START + timedelta(days=30)).isoformat()

    res = client.post(
        "/api/mobile/v1/date-repair/apply",
        headers=headers,
        json={"member_ids": [m.id]},
    )
    assert res.status_code == 200
    assert res.get_json()["data"]["results"][0]["applied"] is True
    db.session.refresh(m)
    assert m.membership_end == START + timedelta(days=30)


def test_ledger_mismatch_uses_ledger_end(client, seed_gym):
    owner = seed_gym["owner"]
    end = START + timedelta(days=30)
    m = _member(seed_gym, "Ledger", START, end + timedelta(days=61))
    db.session.add(
        RenewalHistory(
            gym_id=seed_gym["gym"].id,
            member_id=m.id,
            plan_id=seed_gym["plan"].id,
            renewed_by_id=owner.id,
            previous_end=START,
            new_start=START,
            new_end=end,
            amount=1000,
        )
    )
    db.session.commit()
    res = client.get(
        "/api/mobile/v1/date-repair/scan",
        headers=_auth_headers(owner, seed_gym["gym"]),
    )
    flagged = res.get_json()["data"]["flagged"]
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "ledger_mismatch"
    assert flagged[0]["proposed_end"] == end.isoformat()


def test_oversized_renewal_flagged_for_review(client, seed_gym):
    owner = seed_gym["owner"]
    # Created for 30d, then one renewal applied 61 days on a 30-day plan.
    first_end = START + timedelta(days=30)
    bad_end = first_end + timedelta(days=61)
    m = _member(seed_gym, "Oversized", START, bad_end)
    db.session.add_all(
        [
            RenewalHistory(
                gym_id=seed_gym["gym"].id,
                member_id=m.id,
                plan_id=seed_gym["plan"].id,
                renewed_by_id=owner.id,
                previous_end=START,
                new_start=START,
                new_end=first_end,
                amount=1000,
            ),
            RenewalHistory(
                gym_id=seed_gym["gym"].id,
                member_id=m.id,
                plan_id=seed_gym["plan"].id,
                renewed_by_id=owner.id,
                previous_end=first_end,
                new_start=first_end + timedelta(days=1),
                new_end=bad_end,
                amount=1000,
            ),
        ]
    )
    db.session.commit()
    res = client.get(
        "/api/mobile/v1/date-repair/scan",
        headers=_auth_headers(owner, seed_gym["gym"]),
    )
    flagged = res.get_json()["data"]["flagged"]
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "oversized_renewal"
    assert flagged[0]["confidence"] == "review"
    # Proposal removes the 31 excess days (61 applied vs 30 allowed).
    assert flagged[0]["proposed_end"] == (bad_end - timedelta(days=31)).isoformat()


def test_scan_forbidden_for_staff(client, seed_gym):
    staff = _staff(seed_gym)
    res = client.get(
        "/api/mobile/v1/date-repair/scan",
        headers=_auth_headers(staff, seed_gym["gym"]),
    )
    assert res.status_code == 403


def test_apply_rejects_empty_member_ids(client, seed_gym):
    res = client.post(
        "/api/mobile/v1/date-repair/apply",
        headers=_auth_headers(seed_gym["owner"], seed_gym["gym"]),
        json={"member_ids": []},
    )
    assert res.status_code == 400
