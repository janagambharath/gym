from datetime import date, timedelta
from app.models import Gym, User
from app.extensions import db


def test_login_success(client, seed_gym):
    response = client.post(
        "/auth/login",
        data={"email": "owner@testgym.com", "password": "SecurePass123!"},
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert b"Dashboard" in response.data or b"Members" in response.data


def test_login_invalid_password(client, seed_gym):
    response = client.post(
        "/auth/login",
        data={"email": "owner@testgym.com", "password": "WrongPassword!"},
        follow_redirects=True,
    )
    assert b"Invalid email or password" in response.data


def test_registration_creates_gym_with_limits(client):
    response = client.post(
        "/auth/register",
        data={
            "gym_name": "Powerhouse Gym",
            "owner_name": "Bob Smith",
            "email": "bob@powerhouse.com",
            "phone": "+919123456789",
            "password": "Password123!",
            "confirm_password": "Password123!",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert b"Gym account created" in response.data

    gym = Gym.query.filter_by(slug="powerhouse-gym").first()
    assert gym is not None
    assert gym.max_members == 50
    assert gym.subscription_status == "trial"


def test_trial_expiry_does_not_block_access(client, seed_gym, app):
    with app.app_context():
        gym = seed_gym["gym"]
        gym.trial_ends_at = date.today() - timedelta(days=1)
        db.session.commit()

    client.post(
        "/auth/login",
        data={"email": "owner@testgym.com", "password": "SecurePass123!"},
        follow_redirects=False,
    )

    response = client.get("/app/dashboard", follow_redirects=True)
    assert response.status_code == 200
    assert b"Dashboard" in response.data
