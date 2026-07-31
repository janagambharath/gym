from datetime import date, timedelta
from app.models import Gym, User, Member
from app.extensions import db


def test_tenant_isolation(client, seed_gym, seed_member):
    # Create Gym B
    gym_b = Gym(
        name="Gym B",
        slug="gym-b",
        email="owner@gymb.com",
        status="active",
    )
    db.session.add(gym_b)
    db.session.flush()

    owner_b = User(
        gym_id=gym_b.id,
        email="owner@gymb.com",
        full_name="Owner B",
        role="gym_owner",
    )
    owner_b.set_password("SecurePass123!")
    db.session.add(owner_b)
    db.session.commit()

    # Log in as Owner B
    client.post(
        "/auth/login",
        data={"email": "owner@gymb.com", "password": "SecurePass123!"},
    )

    # Owner B tries to access Gym A's member detail
    res = client.get(f"/members/{seed_member.id}")
    assert res.status_code == 404

    # Owner B views member list — Gym A's member should NOT be present
    res = client.get("/members/")
    assert b"John Doe" not in res.data
