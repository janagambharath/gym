from app.models import Gym, User, MembershipPlan
from app.models.bot import FeatureEntitlement, GymBotConfig
from app.extensions import db


def _create_super_admin():
    admin = User(
        email="superadmin@renewaldesk.com",
        full_name="Platform Super Admin",
        role="super_admin",
        is_active=True,
    )
    admin.set_password("AdminPass123!")
    db.session.add(admin)
    db.session.commit()
    return admin


def test_create_gym_requires_super_admin(client, seed_gym):
    # Regular owner cannot access create gym
    client.post(
        "/auth/login",
        data={"email": "owner@testgym.com", "password": "SecurePass123!"},
        follow_redirects=True,
    )
    response = client.get("/admin/gyms/create")
    assert response.status_code == 403


def test_super_admin_can_create_gym_and_provision_owner(client):
    _create_super_admin()
    client.post(
        "/auth/login",
        data={"email": "superadmin@renewaldesk.com", "password": "AdminPass123!"},
        follow_redirects=True,
    )

    response = client.post(
        "/admin/gyms/create",
        data={
            "gym_name": "Titanium Fitness Club",
            "owner_name": "Rohan Verma",
            "email": "rohan@titaniumfitness.com",
            "password": "RohanPassword123!",
            "phone": "+919876500001",
            "address": "Banjara Hills, Hyderabad",
            "subscription_status": "active",
            "max_members": "300",
            "enable_bot": "on",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert b"Titanium Fitness Club" in response.data
    assert b"created successfully" in response.data

    # Verify Gym created
    gym = Gym.query.filter_by(slug="titanium-fitness-club").first()
    assert gym is not None
    assert gym.name == "Titanium Fitness Club"
    assert gym.max_members == 300
    assert gym.subscription_status == "active"

    # Verify Owner created with credentials
    owner = User.query.filter_by(email="rohan@titaniumfitness.com").first()
    assert owner is not None
    assert owner.gym_id == gym.id
    assert owner.role == "gym_owner"
    assert owner.check_password("RohanPassword123!")

    # Verify Default Plans, Bot, and Entitlements
    plans = MembershipPlan.query.filter_by(gym_id=gym.id).all()
    assert len(plans) >= 3

    bot_cfg = GymBotConfig.query.filter_by(gym_id=gym.id).first()
    assert bot_cfg is not None

    entitlement = FeatureEntitlement.query.filter_by(gym_id=gym.id, feature="whatsapp_bot").first()
    assert entitlement is not None
    assert entitlement.enabled is True
