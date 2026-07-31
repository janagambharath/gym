from datetime import date, timedelta
from app.models import Member
from app.extensions import db


def test_member_crud_and_export(client, seed_gym):
    # Log in
    client.post(
        "/auth/login",
        data={"email": "owner@testgym.com", "password": "SecurePass123!"},
    )

    # Add member
    res = client.post(
        "/members/new",
        data={
            "full_name": "Alice Wonder",
            "phone": "+919876543211",
            "email": "alice@example.com",
            "gender": "female",
            "plan_id": seed_gym["plan"].id,
            "membership_start": date.today().isoformat(),
            "membership_end": (date.today() + timedelta(days=30)).isoformat(),
            "status": "active",
        },
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert b"Member added" in res.data

    member = Member.query.filter_by(full_name="Alice Wonder").first()
    assert member is not None

    # CSV Export
    res = client.get("/members/export")
    assert res.status_code == 200
    assert res.mimetype == "text/csv"
    assert b"Alice Wonder" in res.data
    assert b"+919876543211" in res.data


def test_member_limit_enforcement(client, seed_gym, app):
    client.post(
        "/auth/login",
        data={"email": "owner@testgym.com", "password": "SecurePass123!"},
    )

    # Artificially set max_members to 1 for testing
    with app.app_context():
        gym = seed_gym["gym"]
        gym.max_members = 1
        db.session.commit()

    # First member succeeds
    client.post(
        "/members/new",
        data={
            "full_name": "Member One",
            "phone": "+919876500001",
            "membership_start": date.today().isoformat(),
            "membership_end": (date.today() + timedelta(days=30)).isoformat(),
            "status": "active",
        },
    )

    # Second member fails due to 1-member cap
    res = client.post(
        "/members/new",
        data={
            "full_name": "Member Two",
            "phone": "+919876500002",
            "membership_start": date.today().isoformat(),
            "membership_end": (date.today() + timedelta(days=30)).isoformat(),
            "status": "active",
        },
        follow_redirects=True,
    )
    assert b"reached the 1-member limit" in res.data
