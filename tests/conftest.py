import pytest
from datetime import date, timedelta
from app import create_app
from app.extensions import db
from app.models import Gym, User, Member, MembershipPlan


@pytest.fixture
def app():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def seed_gym(app):
    gym = Gym(
        name="Test Gym",
        slug="test-gym",
        email="owner@testgym.com",
        phone="+919876543210",
        status="active",
        subscription_status="trial",
        trial_ends_at=date.today() + timedelta(days=14),
        max_members=50,
    )
    db.session.add(gym)
    db.session.flush()

    owner = User(
        gym_id=gym.id,
        email="owner@testgym.com",
        full_name="Gym Owner",
        role="gym_owner",
    )
    owner.set_password("SecurePass123!")
    db.session.add(owner)

    plan = MembershipPlan(
        gym_id=gym.id,
        name="Monthly Standard",
        duration_days=30,
        price=1000,
    )
    db.session.add(plan)
    db.session.commit()
    return {"gym": gym, "owner": owner, "plan": plan}


@pytest.fixture
def seed_member(seed_gym):
    gym = seed_gym["gym"]
    plan = seed_gym["plan"]
    member = Member(
        gym_id=gym.id,
        plan_id=plan.id,
        full_name="John Doe",
        phone="+919998887776",
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=30),
        status="active",
    )
    db.session.add(member)
    db.session.commit()
    return member
