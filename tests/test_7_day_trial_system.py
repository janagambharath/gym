"""Comprehensive regression tests for Renewal Desk 7-Day Canonical Trial System."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

import pytest

from app.extensions import db
from app.models import Gym, User
from app.models.gym import DEFAULT_TRIAL_DAYS
from app.services.mobile_billing_service import entitlement_for


def test_canonical_trial_days_is_exactly_7():
    """Verify the authoritative trial duration constant is strictly 7 days."""
    assert DEFAULT_TRIAL_DAYS == 7


def test_mobile_signup_creates_exact_7_day_trial(client, app):
    """Test mobile signup creates a trial ending in exactly 7 calendar days."""
    payload = {
        "full_name": "Trial Tester",
        "email": "trial.tester@example.test",
        "phone": "+919876543999",
        "password": "SecurePassword123!",
        "gym_name": "Iron Pulse 7Day",
        "country": "India",
        "currency": "INR",
    }
    resp = client.post("/api/mobile/v1/auth/signup", json=payload)
    assert resp.status_code == 201

    with app.app_context():
        gym = Gym.query.filter_by(name="Iron Pulse 7Day").first()
        assert gym is not None
        assert gym.subscription_status == "trial"
        expected_expiry = date.today() + timedelta(days=7)
        assert gym.trial_ends_at == expected_expiry


def test_mobile_register_creates_exact_7_day_trial(client, app):
    """Test mobile registration endpoint assigns exactly 7 days."""
    payload = {
        "owner_name": "Gulf Owner",
        "email": "gulf.owner@example.test",
        "phone": "+971509998877",
        "password": "SecurePassword123!",
        "gym_name": "Dubai Power 7D",
        "country": "AE",
        "currency": "AED",
        "timezone": "Asia/Dubai",
        "terms_accepted": True,
    }
    resp = client.post("/api/mobile/v1/auth/register", json=payload)
    assert resp.status_code == 201

    with app.app_context():
        gym = Gym.query.filter_by(name="Dubai Power 7D").first()
        assert gym is not None
        assert gym.trial_ends_at == date.today() + timedelta(days=7)
        assert gym.subscription_status == "trial"


def test_trial_country_and_currency_independence(client, app):
    """Verify trial duration is strictly 7 days regardless of country or currency."""
    countries = [
        ("US", "USD", "America/New_York", "+15551234567", "US Gym"),
        ("GB", "GBP", "Europe/London", "+447911123456", "UK Gym"),
    ]
    for idx, (country, currency, tz, phone, name) in enumerate(countries):
        email = f"owner.{country.lower()}@example.test"
        payload = {
            "owner_name": f"Owner {country}",
            "email": email,
            "phone": phone,
            "password": "SecurePassword123!",
            "gym_name": name,
            "country": country,
            "currency": currency,
            "timezone": tz,
            "terms_accepted": True,
        }
        res = client.post("/api/mobile/v1/auth/register", json=payload)
        assert res.status_code == 201

        with app.app_context():
            g = Gym.query.filter_by(email=email).first()
            assert g is not None
            assert g.trial_ends_at == date.today() + timedelta(days=7)


def test_client_cannot_manipulate_trial_duration(client, app):
    """Client cannot supply custom trial_days or trial_ends_at to extend trial."""
    payload = {
        "owner_name": "Hacker Owner",
        "email": "hacker@example.test",
        "phone": "+919876543111",
        "password": "SecurePassword123!",
        "gym_name": "Hacker Fitness",
        "country": "IN",
        "currency": "INR",
        "timezone": "Asia/Kolkata",
        "terms_accepted": True,
        "trial_days": 365,
        "trial_ends_at": "2030-01-01",
        "subscription_status": "active",
    }
    res = client.post("/api/mobile/v1/auth/register", json=payload)
    assert res.status_code == 201

    with app.app_context():
        g = Gym.query.filter_by(name="Hacker Fitness").first()
        assert g is not None
        # Server ignores injected trial fields and enforces canonical 7 days
        assert g.trial_ends_at == date.today() + timedelta(days=7)
        assert g.subscription_status == "trial"


def test_trial_entitlement_serialization(app):
    """Verify entitlement_for serializes 7-day trial with exact ISO expiry."""
    with app.app_context():
        gym = Gym(
            name="Entitlement Gym",
            slug="entitlement-gym",
            subscription_status="trial",
            billing_source="MANUAL",
            trial_ends_at=date.today() + timedelta(days=7),
        )
        db.session.add(gym)
        db.session.flush()

        ent = entitlement_for(gym)
        assert ent["subscription_status"] == "TRIAL"
        assert ent["billing_source"] == "MANUAL"
        assert ent["expires_at"] is not None

        expected_dt = datetime.combine(date.today() + timedelta(days=7), time.max, tzinfo=timezone.utc)
        assert ent["expires_at"] == expected_dt.isoformat()


def test_active_manual_customer_does_not_receive_trial_expiry(app):
    """Active customer does not have trial expiry attached to their entitlement."""
    with app.app_context():
        gym = Gym(
            name="Paid Gym",
            slug="paid-gym",
            subscription_status="active",
            billing_source="MANUAL",
            trial_ends_at=None,
        )
        db.session.add(gym)
        db.session.flush()

        ent = entitlement_for(gym)
        assert ent["subscription_status"] == "ACTIVE"
        assert ent["expires_at"] is None
