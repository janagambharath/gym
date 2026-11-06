"""Regression tests for the Tier 0 (money truth) + Tier 2 (door safety) fixes
from deep review v2 (2026-11-05).

* C1 / B-H3: recovery cohort excludes signup creation rows; the recovered
  breakdown splits payment-backed from direct renewals.
* H1: dashboard, reports and recovery_rate return ONE at-risk number
  (the revenue_service canonical definition).
* H5: restore_deleted_members queues an unblock per restored active member.
* H6: a group test whose enroll number resolves to a real member is refused
  at serve time, even when the owner confirmed the name at queue time.
* M10: a bridge block of a non-blockable member 409s up front (bridge only;
  the ADMS owner-override B-H1 is untouched and still 201s — see the last
  test, which pins that scoping).
* B-H2: create_user for a brand-new terminal user serves instead of being
  cancelled with CANCELLED_STALE_ENABLE.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import BridgeCommand, BridgeInstallation, Member, PaymentVerification
from app.models.mixins import utcnow
from app.models.renewal_history import RenewalHistory
from app.models.rrr import RRRAdmsCommand, RRRIntegration
from app.services.bridge_service import adms_command_text
from app.services.revenue_service import recovery_rate
from app.services.timezone_service import today_for_gym


def _owner_headers(seed_gym):
    owner = seed_gym["owner"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, 'gym_owner')}"}


def _member(gym_id, plan_id, *, name, phone, enroll=None, status="active",
            start=None, end=None, price=1000):
    today = date.today()
    member = Member(
        gym_id=gym_id,
        plan_id=plan_id,
        full_name=name,
        phone=phone,
        membership_start=start or (today - timedelta(days=30)),
        membership_end=end if end is not None else today + timedelta(days=30),
        status=status,
        price=price,
        device_enroll_number=enroll,
    )
    db.session.add(member)
    db.session.commit()
    return member


def _payment(gym_id, member_id, amount):
    row = PaymentVerification(
        gym_id=gym_id, member_id=member_id, amount=amount, status="verified"
    )
    db.session.add(row)
    db.session.commit()
    return row


def _history(gym_id, member_id, plan_id, *, previous_end, new_start, new_end,
             amount, standard_price, payment_id=None):
    row = RenewalHistory(
        gym_id=gym_id,
        member_id=member_id,
        plan_id=plan_id,
        payment_verification_id=payment_id,
        previous_end=previous_end,
        new_start=new_start,
        new_end=new_end,
        standard_price=standard_price,
        amount=amount,
        is_test=False,
    )
    db.session.add(row)
    db.session.commit()
    return row


def _adms_integration(seed_gym, *, serial, token):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="Tier0/2 ADMS",
        device_serial=serial,
        device_name="Tier0/2 X2008",
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        adms_path_token=token,
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _bridge(seed_gym):
    installation, _api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "Test bridge", "TIER02-BRIDGE-01"
    )
    db.session.add(installation)
    db.session.commit()
    return installation


# ─── C1 / B-H3: signup creation rows are not recoveries ────────────────────

def test_recovery_cohort_excludes_signup_creation_rows(seed_gym):
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)

    # Paid signup: first ledger row with previous_end == new_start.
    signup = _member(gym.id, plan_id, name="New Signup", phone="+919100020001")
    paid_signup = _payment(gym.id, signup.id, 1000)
    _history(
        gym.id, signup.id, plan_id,
        previous_end=today - timedelta(days=5), new_start=today - timedelta(days=5),
        new_end=today + timedelta(days=45), amount=1000, standard_price=1000,
        payment_id=paid_signup.id,
    )
    # Genuine paid renewal: new_start is previous_end + 1.
    renewed = _member(gym.id, plan_id, name="Renewed Paid", phone="+919100020002")
    paid_renewal = _payment(gym.id, renewed.id, 800)
    _history(
        gym.id, renewed.id, plan_id,
        previous_end=today - timedelta(days=5), new_start=today - timedelta(days=4),
        new_end=today + timedelta(days=45), amount=800, standard_price=1000,
        payment_id=paid_renewal.id,
    )
    # Genuine direct (unrecorded-payment) renewal: still a renewal, not a signup.
    direct = _member(gym.id, plan_id, name="Renewed Direct", phone="+919100020003")
    _history(
        gym.id, direct.id, plan_id,
        previous_end=today - timedelta(days=3), new_start=today - timedelta(days=2),
        new_end=today + timedelta(days=45), amount=500, standard_price=1000,
    )

    result = recovery_rate(gym.id, gym.timezone)
    # V3-H2: the headline and the rate are payment-backed only — the
    # ₹500 direct renewal is recorded, not recovered.
    assert result["revenue_recovered"] == "800.00"
    assert result["recorded_amount"] == "1300.00"
    assert result["recovered_breakdown"]["total_renewals"] == 2
    assert result["recovered_breakdown"]["total_amount"] == "1300.00"
    assert result["recovered_breakdown"]["payment_backed_amount"] == "800.00"
    assert result["recovered_breakdown"]["payment_backed_renewals"] == 1
    assert result["recovered_breakdown"]["direct_amount"] == "500.00"
    assert result["recovered_breakdown"]["direct_renewals"] == 1
    # V4-M2: denominator is outstanding risk + PAID expected value
    # only (1000) — the direct renewal's expected 1000 is excluded,
    # so the rate is 800/1000 = 80.0, not 800/2000.
    assert result["recovery_denominator"] == "1000.00"
    assert result["recovery_rate"] == "80.0"


# ─── H1: one at-risk number everywhere ─────────────────────────────────────

def test_dashboard_reports_and_recovery_agree_on_at_risk(client, seed_gym):
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)
    _member(
        gym.id, plan_id, name="Expiring Soon", phone="+919100020011",
        end=today + timedelta(days=3), price=1000,
    )
    _member(
        gym.id, plan_id, name="Expired Days Ago", phone="+919100020012",
        status="expired", end=today - timedelta(days=4), price=2000,
    )

    dash = client.get("/api/mobile/v1/dashboard", headers=_owner_headers(seed_gym))
    assert dash.status_code == 200
    data = dash.get_json()["data"]
    assert data["revenue_at_risk"] == "3000.00"
    assert data["recovery_rate"]["revenue_at_risk"] == "3000.00"
    # B-H4 backend part: the dashboard payload carries the verified-only split.
    assert "payment_backed_amount" in data["revenue_recovered"]
    assert "direct_amount" in data["revenue_recovered"]
    assert "payment_backed_amount" in data["recovery_rate"]["recovered_breakdown"]

    reports = client.get(
        "/api/mobile/v1/reports/summary?period=30d", headers=_owner_headers(seed_gym)
    )
    assert reports.status_code == 200
    assert reports.get_json()["data"]["revenue"]["at_risk"] == "3000.00"


# ─── H5: restore queues the unblock ────────────────────────────────────────

def test_restore_deleted_members_queues_unblock_for_active(client, seed_gym):
    _bridge(seed_gym)
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = date.today()
    active = _member(
        gym.id, plan_id, name="Restored Active", phone="+919100020021",
        enroll="201", end=today + timedelta(days=30),
    )
    active.deleted_at = utcnow()
    active.status = "deleted"
    expired = _member(
        gym.id, plan_id, name="Restored Expired", phone="+919100020022",
        enroll="202", status="expired", end=today - timedelta(days=5),
    )
    expired.deleted_at = utcnow()
    expired.status = "deleted"
    db.session.commit()

    res = client.post(
        "/api/mobile/v1/rrr/restore-deleted-members", headers=_owner_headers(seed_gym)
    )
    assert res.status_code == 200
    assert res.get_json()["data"]["restored"] == 2
    assert res.get_json()["data"]["unblocks_queued"] == 1

    db.session.refresh(active)
    assert active.status == "active"
    assert active.deleted_at is None
    db.session.refresh(expired)
    assert expired.status == "expired"

    cmds = BridgeCommand.query.filter_by(gym_id=gym.id).all()
    assert len(cmds) == 1
    assert cmds[0].command_type == "enable_user"
    assert cmds[0].enroll_number == "201"
    assert cmds[0].member_id == active.id


def test_restore_deleted_member_without_terminal_identity_queues_nothing(
    client, seed_gym
):
    gym = seed_gym["gym"]
    member = _member(gym.id, seed_gym["plan"].id, name="No Terminal", phone="+919100020023")
    member.deleted_at = utcnow()
    member.status = "deleted"
    db.session.commit()

    res = client.post(
        "/api/mobile/v1/rrr/restore-deleted-members", headers=_owner_headers(seed_gym)
    )
    assert res.status_code == 200
    assert res.get_json()["data"]["unblocks_queued"] == 0
    assert BridgeCommand.query.filter_by(gym_id=gym.id).count() == 0


# ─── H6: confirmed group test refused at serve ─────────────────────────────

def test_group_test_resolving_to_confirmed_member_refused_at_serve(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="H6-X2008", token="h6-token")
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Confirmed Member",
        phone="+919100020031", enroll="930",
    )
    # Exactly what the queue endpoint stores when the owner types the real
    # member's ID + exact name and ticks the confirmation checkbox.
    trapped = RRRAdmsCommand(
        gym_id=gym_id, integration_id=integration.id,
        action="essl_group_block_test", test_enroll_number="930",
        test_member_id=member.id,
        command_text=adms_command_text(
            "essl_group_block_test", "930", member_name="Confirmed Member"
        ),
        status="queued",
    )
    ghost = RRRAdmsCommand(
        gym_id=gym_id, integration_id=integration.id,
        action="essl_group_block_test", test_enroll_number="999",
        command_text=adms_command_text(
            "essl_group_block_test", "999", member_name="Test Fake"
        ),
        status="queued",
    )
    db.session.add_all([trapped, ghost])
    db.session.commit()

    res = client.get("/iclock/h6-token/getrequest?SN=H6-X2008")
    assert res.status_code == 200
    # The member-targeting test cancels in place; the terminal-local fake serves.
    assert res.get_data(as_text=True) == f"C:{ghost.id}:{ghost.command_text}\n"
    saved = db.session.get(RRRAdmsCommand, trapped.id)
    assert saved.status == "failed"
    assert "belongs to a member" in (saved.result_message or "")


# ─── B-H2: create_user for a brand-new terminal user serves ────────────────

def test_create_user_for_new_terminal_user_serves(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="B2-X2008", token="b2-token")
    queued = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/adms/device-command",
        headers=_owner_headers(seed_gym),
        json={"action": "create_user", "enroll_number": "777", "member_name": "New User"},
    )
    assert queued.status_code == 201, queued.get_data(as_text=True)[:300]
    command_id = queued.get_json()["data"]["command"]["id"]

    served = client.get("/iclock/b2-token/getrequest?SN=B2-X2008")
    assert served.status_code == 200
    assert served.get_data(as_text=True) == (
        f"C:{command_id}:DATA UPDATE USERINFO PIN=777\tName=New User\tPri=0\n"
    )
    assert db.session.get(RRRAdmsCommand, command_id).status == "delivered"


# ─── M10 scoping: ADMS owner-override (B-H1) is untouched ──────────────────

def test_manual_block_active_member_on_adms_still_201(client, seed_gym):
    """M10's 409 is bridge-only. On ADMS the owner-override (B-H1) is
    awaiting Bharath's explicit decision, so a manual block of an active
    member must still queue here — this test pins that scoping."""
    integration = _adms_integration(seed_gym, serial="M10-X2008", token="m10-token")
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="ADMS Active",
        phone="+919100020041", enroll="101",
    )
    res = client.post(
        f"/api/mobile/v1/rrr/members/{member.id}/access",
        headers=_owner_headers(seed_gym),
        json={"action": "block"},
    )
    assert res.status_code == 201
    cmd = RRRAdmsCommand.query.filter_by(integration_id=integration.id).one()
    assert cmd.action == "block"
