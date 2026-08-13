from datetime import date, timedelta
from app.models import BridgeCommand, BridgeInstallation, Member
from app.extensions import db


def _login_owner(client) -> None:
    client.post(
        "/auth/login",
        data={"email": "owner@testgym.com", "password": "SecurePass123!"},
    )


def _installation(seed_gym) -> BridgeInstallation:
    installation, _api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "Test bridge", "TEST-TERMINAL-SERIAL-01"
    )
    db.session.add(installation)
    db.session.commit()
    return installation


def test_member_crud_and_export(client, seed_gym):
    # Log in
    _login_owner(client)

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
    _login_owner(client)

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


def test_manual_biometric_block_queues_disable_and_persists(client, seed_gym, seed_member):
    _login_owner(client)
    _installation(seed_gym)
    member = db.session.get(Member, seed_member.id)
    member.device_enroll_number = "3667"
    db.session.commit()

    response = client.post(
        f"/members/{member.id}/biometric-access/block", follow_redirects=True
    )

    member = db.session.get(Member, member.id)
    command = BridgeCommand.query.filter_by(member_id=member.id).one()
    assert response.status_code == 200
    assert b"Biometric access block queued" in response.data
    assert member.biometric_access_blocked is True
    assert command.command_type == "disable_user"


def test_manual_restore_queues_enable_only_for_active_members(client, seed_gym, seed_member):
    _login_owner(client)
    _installation(seed_gym)
    member = db.session.get(Member, seed_member.id)
    member.device_enroll_number = "3667"
    member.biometric_access_blocked = True
    db.session.commit()

    response = client.post(
        f"/members/{member.id}/biometric-access/restore", follow_redirects=True
    )

    member = db.session.get(Member, member.id)
    command = BridgeCommand.query.filter_by(member_id=member.id).one()
    assert response.status_code == 200
    assert b"Membership access restore queued" in response.data
    assert member.biometric_access_blocked is False
    assert command.command_type == "enable_user"


def test_manual_restore_keeps_expired_member_blocked(client, seed_gym, seed_member):
    _login_owner(client)
    _installation(seed_gym)
    member = db.session.get(Member, seed_member.id)
    member.device_enroll_number = "3667"
    member.biometric_access_blocked = True
    member.status = "expired"
    member.membership_end = date.today() - timedelta(days=1)
    db.session.commit()

    response = client.post(
        f"/members/{member.id}/biometric-access/restore", follow_redirects=True
    )

    member = db.session.get(Member, member.id)
    command = BridgeCommand.query.filter_by(member_id=member.id).one()
    assert response.status_code == 200
    assert b"membership is not currently active" in response.data
    assert member.biometric_access_blocked is False
    assert command.command_type == "disable_user"


def test_manual_block_requires_confirmed_biometric_enrollment(client, seed_gym, seed_member):
    _login_owner(client)
    _installation(seed_gym)
    member = db.session.get(Member, seed_member.id)

    response = client.post(
        f"/members/{member.id}/biometric-access/block", follow_redirects=True
    )

    member = db.session.get(Member, member.id)
    assert response.status_code == 200
    assert member.biometric_access_blocked is False
    assert BridgeCommand.query.count() == 0
