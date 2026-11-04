"""Tests for the campaign system — models, service, and API endpoints."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.extensions import db
from app.models import AccessEvent, Gym, Member, MembershipPlan, PaymentVerification, RenewalHistory, User
from app.models.campaign import Campaign, CampaignRecipient


@pytest.fixture
def gym(app):
    """Create a test gym with WhatsApp enabled."""
    with app.app_context():
        g = Gym(
            name="Test Gym",
            slug="test-gym",
            phone_number_id="12345",
            whatsapp_enabled=True,
            business_phone_number="+919999999999",
            timezone="Asia/Kolkata",
        )
        db.session.add(g)
        db.session.flush()
        yield g


@pytest.fixture
def owner(app, gym):
    """Create a gym owner user."""
    with app.app_context():
        u = User(
            gym_id=gym.id,
            email="owner@test.com",
            full_name="Test Owner",
            role="gym_owner",
        )
        u.set_password("testpass123")
        db.session.add(u)
        db.session.flush()
        yield u


@pytest.fixture
def plan(app, gym):
    """Create a membership plan."""
    with app.app_context():
        p = MembershipPlan(
            gym_id=gym.id,
            name="Monthly",
            duration_days=30,
            price=Decimal("2000.00"),
        )
        db.session.add(p)
        db.session.flush()
        yield p


@pytest.fixture
def expiring_members(app, gym, plan):
    """Create members expiring within 7 days with WhatsApp opted in."""
    with app.app_context():
        members = []
        today = date.today()
        for i in range(5):
            m = Member(
                gym_id=gym.id,
                full_name=f"Expiring Member {i}",
                phone=f"+9199000000{i:02d}",
                status="active",
                membership_start=today - timedelta(days=25),
                membership_end=today + timedelta(days=i),
                plan_id=plan.id,
                whatsapp_opted_in=True,
            )
            db.session.add(m)
            members.append(m)
        db.session.flush()
        yield members


class TestCampaignModel:
    """Test Campaign and CampaignRecipient model basics."""

    def test_create_campaign(self, app, gym, owner):
        with app.app_context():
            c = Campaign(
                gym_id=gym.id,
                name="Test Campaign",
                segment_type="expiring_7d",
                status="draft",
                created_by_id=owner.id,
            )
            db.session.add(c)
            db.session.flush()
            assert c.id is not None
            assert c.status == "draft"
            assert c.attribution_window_days == 7

    def test_create_recipient(self, app, gym, owner, expiring_members):
        with app.app_context():
            c = Campaign(
                gym_id=gym.id,
                name="Test",
                segment_type="expiring_7d",
                created_by_id=owner.id,
            )
            db.session.add(c)
            db.session.flush()

            r = CampaignRecipient(
                campaign_id=c.id,
                member_id=expiring_members[0].id,
                gym_id=gym.id,
                phone_snapshot="+919900000000",
                status="pending",
            )
            db.session.add(r)
            db.session.flush()
            assert r.id is not None
            assert r.campaign_id == c.id


class TestCampaignService:
    """Test campaign service functions."""

    def test_get_segment_members_expiring_7d(self, app, gym, expiring_members):
        with app.app_context():
            from app.services.campaign_service import get_segment_members
            members = get_segment_members(gym.id, "expiring_7d", "Asia/Kolkata")
            # All 5 members expire within 0-4 days from today
            assert len(members) > 0
            assert all(m.whatsapp_opted_in for m in members)

    def test_preview_segment(self, app, gym, expiring_members):
        with app.app_context():
            from app.services.campaign_service import preview_segment
            result = preview_segment(gym.id, "expiring_7d", "Asia/Kolkata")
            assert result["segment_type"] == "expiring_7d"
            assert result["total"] > 0
            assert len(result["preview"]) <= 20

    def test_create_campaign_service(self, app, gym, owner):
        with app.app_context():
            from app.services.campaign_service import create_campaign
            c = create_campaign(
                gym_id=gym.id,
                name="Service Test",
                segment_type="expiring_7d",
                created_by_id=owner.id,
            )
            db.session.commit()
            assert c.id is not None
            assert c.status == "draft"

    def test_campaign_attribution(self, app, gym, owner, plan, expiring_members):
        with app.app_context():
            from app.services.campaign_service import attribute_renewal_to_campaign

            # Create a sent campaign with a recipient
            c = Campaign(
                gym_id=gym.id,
                name="Attribution Test",
                segment_type="expiring_7d",
                status="sent",
                created_by_id=owner.id,
                sent_at=datetime.now(timezone.utc),
                attribution_window_days=7,
            )
            db.session.add(c)
            db.session.flush()

            member = expiring_members[0]
            r = CampaignRecipient(
                campaign_id=c.id,
                member_id=member.id,
                gym_id=gym.id,
                sent_at=datetime.now(timezone.utc),
                status="sent",
            )
            db.session.add(r)
            db.session.flush()

            # Create a renewal for this member
            renewal = RenewalHistory(
                gym_id=gym.id,
                member_id=member.id,
                plan_id=plan.id,
                renewed_by_id=owner.id,
                previous_end=member.membership_end,
                new_start=member.membership_end + timedelta(days=1),
                new_end=member.membership_end + timedelta(days=31),
                amount=Decimal("2000.00"),
            )
            db.session.add(renewal)
            db.session.flush()

            # Attribute
            campaign_id = attribute_renewal_to_campaign(
                member_id=member.id,
                gym_id=gym.id,
                renewal_id=renewal.id,
                renewal_amount=Decimal("2000.00"),
            )
            assert campaign_id == c.id
            assert r.status == "renewed"
            assert r.renewal_amount == Decimal("2000.00")


class TestRevenueService:
    """Test revenue recovered calculations."""

    def test_revenue_at_risk(self, app, gym, plan, expiring_members):
        with app.app_context():
            from app.services.revenue_service import revenue_at_risk
            result = revenue_at_risk(gym.id, "Asia/Kolkata")
            # Should have some at-risk amount from our expiring members
            assert "total" in result
            assert "expiring_count" in result
            assert int(result["expiring_count"]) > 0

    def test_revenue_recovered(self, app, gym):
        with app.app_context():
            from app.services.revenue_service import revenue_recovered
            result = revenue_recovered(gym.id, "Asia/Kolkata")
            assert "total_renewals" in result
            assert "total_amount" in result
            assert "campaign_renewals" in result

    def test_recovery_rate(self, app, gym, plan, expiring_members):
        with app.app_context():
            from app.services.revenue_service import recovery_rate
            result = recovery_rate(gym.id, "Asia/Kolkata")
            assert "recovery_rate" in result
            assert "revenue_at_risk" in result
            assert "revenue_recovered" in result


def test_recent_access_event_protects_member_from_inactive_campaign_segment(app, gym, plan):
    from app.services.campaign_service import _inactive_since

    with app.app_context():
        member = Member(
            gym_id=gym.id,
            plan_id=plan.id,
            full_name="Recent Visitor",
            phone="+919900001111",
            membership_start=date.today() - timedelta(days=90),
            membership_end=date.today() + timedelta(days=30),
            status="active",
            whatsapp_opted_in=True,
        )
        db.session.add(member)
        db.session.flush()
        db.session.add(AccessEvent(
            gym_id=gym.id,
            member_id=member.id,
            event_type="ENTRY",
            direction="IN",
            event_timestamp=datetime.now(timezone.utc),
            device_enroll_number="1101",
            source_event_id="recent-visit-1101",
        ))
        db.session.commit()

        assert _inactive_since(gym.id, 30, "Asia/Kolkata") == []


def test_revenue_period_uses_collection_record_time_not_membership_start(app, gym):
    from app.services.revenue_service import revenue_recovered

    with app.app_context():
        member = Member(
            gym_id=gym.id,
            full_name="Future Start Renewal",
            phone="+919900001112",
            membership_start=date.today(),
            membership_end=date.today() + timedelta(days=30),
            status="active",
        )
        db.session.add(member)
        db.session.flush()
        renewal = RenewalHistory(
            gym_id=gym.id,
            member_id=member.id,
            previous_end=date.today(),
            new_start=date.today() + timedelta(days=60),
            new_end=date.today() + timedelta(days=90),
            amount=Decimal("1200.00"),
            is_test=False,
        )
        db.session.add(renewal)
        db.session.commit()

        result = revenue_recovered(gym.id, "Asia/Kolkata", period_days=30)
        assert result["total_renewals"] == 1
        assert result["total_amount"] == "1200.00"
