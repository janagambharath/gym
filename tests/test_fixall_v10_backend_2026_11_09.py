"""Fix-all v10 backend regressions (2026-11-09).

Covers the backend findings of deep-review v10:

* V10-M1 — audit rows must survive the request: every audit() is
  staged BEFORE the final commit, so a fresh session (not the
  same-session autoflush artifact the v9 tests relied on) sees the
  AuditLog row. The proof helper below closes the session with
  ``db.session.remove()`` and re-queries: an uncommitted row is rolled
  back on close and invisible afterwards.
* V10-M2 — re-provisioning a commissioned ADMS gym never demotes it;
  rate limit + idempotency key.
* V10-L1 — bridge remote-unlock double-tap is 409 COMMAND_PENDING.
* V10-L2 — non-finite Decimal amounts are 400s, not 500s.
* V10-L3 — member self-service /renew custom_amount needs 2dp.
* V10-L4 — trial dates use the gym-local day.
* V10-L5 — only the owner can wipe unmapped punches.
* V10-L6 — change-password / delete-account are rate-limited and
  wrong guesses count toward lockout.
* V10-L7 — a late devicecmd cannot resurrect a cancelled row.
* V10-L8 — retry audit logs the FRESH command ids; "already in
  desired state" is reported; "no_terminal_identity" is split out.
* V10-L9 — failed create_user rows retry for enableable members.
* V10-L10 — retry resolves the current holder of the enroll first.
* V10-L11 — retry-sync is owner-only.
* V10-L12 — retry-sync caps the batch at 50 and isolates per-row
  failures.
* V10-M5 (server side) — PATCH /settings validates the timezone as a
  real IANA name (already present; pinned here).
* V10-L33 — the access summary carries queued_adms_commands.

The block fail-safe is pinned wherever a retry touches door state:
no test here ever queues a block for an active member.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from unittest import mock

import pytest

from app.extensions import db
from app.mobile_api import access as access_module
from app.mobile_api.token_service import create_access_token
from app.models import Member
from app.models.audit_log import AuditLog
from app.models.bridge import BridgeInstallation
from app.models.gym import DEFAULT_TRIAL_DAYS
from app.models.rrr import RRRAdmsCommand, RRRAttendanceEvent, RRRIntegration
from app.models.user import User
from app.services.bridge_service import (
    adms_command_text,
    invalidate_adms_enroll_index,
)
from app.services.timezone_service import today_for_gym


def _owner_headers(seed_gym, role="gym_owner"):
    owner = seed_gym["owner"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, role)}"}


def _staff_headers(seed_gym):
    staff = User(gym_id=seed_gym["gym"].id, email="staff@testgym.com",
                 full_name="Staff One", role="staff")
    staff.set_password("SecurePass123!")
    db.session.add(staff)
    db.session.commit()
    return {"Authorization": f"Bearer {create_access_token(staff.id, seed_gym['gym'].id, 'staff')}"}


def _member(gym_id, plan_id, *, name, phone, enroll, status, end):
    member = Member(
        gym_id=gym_id,
        plan_id=plan_id,
        full_name=name,
        phone=phone,
        membership_start=(end or date.today()) - timedelta(days=30),
        membership_end=end,
        status=status,
        device_enroll_number=enroll,
    )
    db.session.add(member)
    db.session.commit()
    invalidate_adms_enroll_index(gym_id)
    return member


def _adms_integration(seed_gym, *, serial, token, commands_enabled=True,
                      last_success_at="now"):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V10 ADMS",
        device_serial=serial,
        device_name="V10 X2008",
        status="connected",
        commands_enabled=commands_enabled,
        commissioning_status="physical_test_passed" if commands_enabled else "not_started",
        adms_path_token=token,
        last_success_at=(
            datetime.now(timezone.utc) if last_success_at == "now"
            else last_success_at
        ),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _failed_adms_row(integration, *, action, enroll, member=None,
                     result_message="Timeout: no ack within 10 min",
                     result_code="TIMEOUT"):
    if action in ("block", "unblock"):
        text = adms_command_text(action, enroll, member_name="Test Member")
    elif action == "create_user":
        text = adms_command_text(action, enroll, member_name="Test Member")
    else:
        text = f"C:TEST {action} PIN={enroll}"
    row = RRRAdmsCommand(
        gym_id=integration.gym_id,
        integration_id=integration.id,
        action=action,
        test_enroll_number=enroll,
        command_text=text,
        status="failed",
        result_code=result_code,
        result_message=result_message,
        intended_member_id=member.id if member is not None else None,
    )
    db.session.add(row)
    db.session.commit()
    return row


def _fresh_audit(action, *, resource_type=None):
    """Re-query AuditLog from a FRESH session.

    ``db.session.remove()`` closes the test session, rolling back any
    uncommitted work — exactly what Flask teardown does in prod. A row
    only visible via same-session autoflush (the v9 test artifact)
    disappears here; a committed row survives.
    """
    db.session.remove()
    query = AuditLog.query.filter_by(action=action)
    if resource_type is not None:
        query = query.filter_by(resource_type=resource_type)
    return query.all()


def _fresh_command(row_id):
    db.session.remove()
    return db.session.get(RRRAdmsCommand, row_id)


# ─── V10-M1: audit rows survive the request ───────────────────────────────

def test_audit_persists_after_adms_retry_sync(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-01", token="v10-01-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="M1 Retry", phone="+919100700001",
        enroll="301", status="expired", end=date.today() - timedelta(days=2),
    )
    failed_id = _failed_adms_row(
        integration, action="block", enroll="301", member=member
    ).id

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert res.get_json()["data"]["retried_count"] == 1

    rows = _fresh_audit("retry_failed_adms_syncs", resource_type="rrr_integration")
    assert len(rows) == 1, "audit row must exist in a fresh session, not just same-session state"
    assert (rows[0].metadata_json or {}).get("retried_count") == 1
    assert (rows[0].metadata_json or {}).get("superseded_command_ids") == [failed_id]
    assert (rows[0].metadata_json or {}).get("retried_command_ids") != [failed_id]


def test_audit_persists_after_adms_clear_failed(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-02", token="v10-02-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="M1 Clear", phone="+919100700002",
        enroll="302", status="expired", end=date.today() - timedelta(days=2),
    )
    _failed_adms_row(integration, action="block", enroll="302", member=member)

    res = client.post("/api/mobile/v1/access/clear-failed", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert res.get_json()["data"]["cleared_count"] == 1

    rows = _fresh_audit("clear_failed_adms_commands", resource_type="rrr_integration")
    assert len(rows) == 1
    assert (rows[0].metadata_json or {}).get("cleared_count") == 1


def test_audit_persists_after_owner_cancel(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-03", token="v10-03-token")
    queued = RRRAdmsCommand(
        gym_id=integration.gym_id,
        integration_id=integration.id,
        action="unlock_door",
        test_enroll_number="SYSTEM",
        command_text="CONTROL DEVICE 1 50",
        status="queued",
    )
    db.session.add(queued)
    db.session.commit()
    queued_id = queued.id

    res = client.post(
        f"/api/mobile/v1/access/adms-commands/{queued_id}/cancel",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]

    rows = _fresh_audit("adms_command_cancelled_by_owner", resource_type="rrr_adms_command")
    assert len(rows) == 1
    assert rows[0].resource_id == str(queued_id)


# ─── V10-M2: re-provisioning a live integration ───────────────────────────

def test_provision_same_serial_on_commissioned_gym_preserves_flags(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-04", token="v10-04-token")
    integration_id = integration.id
    assert integration.commands_enabled is True

    res = client.post(
        "/api/mobile/v1/rrr/integrations/adms/provision",
        headers=_owner_headers(seed_gym),
        json={"device_serial": "V10-04", "device_name": "Renamed X2008"},
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]

    db.session.remove()
    saved = db.session.get(RRRIntegration, integration_id)
    assert saved.commands_enabled is True
    assert saved.commissioning_status == "physical_test_passed"
    assert saved.status == "connected"
    assert saved.device_name == "Renamed X2008"


def test_provision_different_serial_on_commissioned_gym_is_409(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-05", token="v10-05-token")
    integration_id = integration.id

    res = client.post(
        "/api/mobile/v1/rrr/integrations/adms/provision",
        headers=_owner_headers(seed_gym),
        json={"device_serial": "V10-05-REPLACEMENT", "device_name": "New Terminal"},
    )
    assert res.status_code == 409, res.get_data(as_text=True)[:300]
    assert res.get_json()["error"]["code"] == "ALREADY_COMMISSIONED"

    db.session.remove()
    saved = db.session.get(RRRIntegration, integration_id)
    assert saved.device_serial == "V10-05"
    assert saved.commands_enabled is True


def test_provision_idempotency_key_replays(client, seed_gym):
    headers = dict(_owner_headers(seed_gym))
    headers["Idempotency-Key"] = "v10-provision-key-1"
    payload = {"device_serial": "V10-06", "device_name": "Idempotent X2008"}

    first = client.post("/api/mobile/v1/rrr/integrations/adms/provision", headers=headers, json=payload)
    assert first.status_code == 200, first.get_data(as_text=True)[:300]
    first_id = first.get_json()["data"]["integration"]["id"]

    second = client.post("/api/mobile/v1/rrr/integrations/adms/provision", headers=headers, json=payload)
    assert second.status_code == 200, second.get_data(as_text=True)[:300]
    assert second.get_json()["data"]["integration"]["id"] == first_id

    assert RRRIntegration.query.filter_by(
        gym_id=seed_gym["gym"].id, connector_type="adms_direct"
    ).count() == 1


def test_provision_rate_limited(client, seed_gym):
    headers = _owner_headers(seed_gym)
    for i in range(10):
        res = client.post(
            "/api/mobile/v1/rrr/integrations/adms/provision",
            headers=headers,
            json={"device_serial": "V10-07", "device_name": f"Rate {i}"},
        )
        assert res.status_code == 200, res.get_data(as_text=True)[:300]
    res = client.post(
        "/api/mobile/v1/rrr/integrations/adms/provision",
        headers=headers,
        json={"device_serial": "V10-07", "device_name": "Rate 11"},
    )
    assert res.status_code == 429


# ─── V10-L1: bridge remote-unlock pending guard ───────────────────────────

def test_bridge_remote_unlock_second_tap_is_409(client, seed_gym):
    installation, _api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "Main Entrance", "V10-BRIDGE-01"
    )
    db.session.add(installation)
    db.session.commit()
    installation.last_heartbeat_at = datetime.now(timezone.utc)
    db.session.commit()

    headers = _owner_headers(seed_gym)
    first = client.post(
        "/api/mobile/v1/access/remote-unlock",
        headers=headers,
        json={"confirm": True, "delay_seconds": 5},
    )
    assert first.status_code == 201, first.get_data(as_text=True)[:300]

    second = client.post(
        "/api/mobile/v1/access/remote-unlock",
        headers=headers,
        json={"confirm": True, "delay_seconds": 5},
    )
    assert second.status_code == 409, second.get_data(as_text=True)[:300]
    assert second.get_json()["error"]["code"] == "COMMAND_PENDING"


# ─── V10-L2: non-finite money ─────────────────────────────────────────────

def test_create_payment_rejects_non_finite_amounts(client, seed_gym, seed_member):
    headers = _owner_headers(seed_gym)
    base = {"member_id": seed_member.id, "renewal_days": 30}
    for bad in ("NaN", "Infinity", "-Infinity"):
        res = client.post(
            "/api/mobile/v1/payments", headers=headers,
            json={**base, "amount": bad},
        )
        assert res.status_code == 400, (bad, res.get_data(as_text=True)[:300])
    res = client.post(
        "/api/mobile/v1/payments", headers=headers,
        json={**base, "amount": "100", "standard_price": "NaN"},
    )
    assert res.status_code == 400, res.get_data(as_text=True)[:300]
    res = client.post(
        "/api/mobile/v1/payments", headers=headers,
        json={**base, "amount": "100", "discount": "Infinity"},
    )
    assert res.status_code == 400, res.get_data(as_text=True)[:300]


def test_create_member_rejects_nan_initial_amount(client, seed_gym):
    today = date.today()
    res = client.post(
        "/api/mobile/v1/members",
        headers=_owner_headers(seed_gym),
        json={
            "full_name": "NaN Payer",
            "phone": "+919999900201",
            "plan_id": seed_gym["plan"].id,
            "membership_start": today.isoformat(),
            "membership_end": (today + timedelta(days=30)).isoformat(),
            "amount": "NaN",
        },
    )
    assert res.status_code == 400, res.get_data(as_text=True)[:300]
    assert Member.query.filter_by(full_name="NaN Payer").first() is None


# ─── V10-L3: member self-service renew 2dp ───────────────────────────────

def _member_token(member):
    return {"Authorization": f"Bearer {create_access_token(member.id, member.gym_id, 'member')}"}


def test_member_renew_rejects_non_finite_and_3dp_custom_amount(client, seed_member):
    headers = _member_token(seed_member)
    plan_id = seed_member.plan_id
    for bad, why in (("100.999", "3dp"), ("NaN", "NaN"), ("Infinity", "Infinity")):
        res = client.post(
            "/api/member/v1/renew", headers=headers,
            json={"plan_id": plan_id, "custom_amount": bad},
        )
        assert res.status_code == 422, (why, res.get_data(as_text=True)[:300])

    res = client.post(
        "/api/member/v1/renew", headers=headers,
        json={"plan_id": plan_id, "custom_amount": "100.50"},
    )
    assert res.status_code == 201, res.get_data(as_text=True)[:300]


# ─── V10-L4: gym-local trial dates ────────────────────────────────────────

def test_register_uses_gym_local_trial_end(client, app):
    payload = {
        "full_name": "NY Owner",
        "terms_accepted": True,
        "email": "ny.owner@example.com",
        "phone": "+19175550199",
        "password": "SecurePassword123!",
        "gym_name": "NY Fit Arena",
        "country": "United States",
        "currency": "USD",
        "timezone": "America/New_York",
    }
    resp = client.post("/api/mobile/v1/auth/signup", json=payload)
    assert resp.status_code == 201, resp.get_data(as_text=True)[:300]

    with app.app_context():
        from app.models import Gym

        gym = Gym.query.filter_by(name="NY Fit Arena").first()
        assert gym is not None
        assert gym.timezone == "America/New_York"
        assert gym.trial_ends_at == (
            today_for_gym("America/New_York") + timedelta(days=DEFAULT_TRIAL_DAYS)
        )


def test_is_trial_expired_uses_gym_timezone(app):
    from app.mobile_api.middleware import _is_trial_expired
    from app.models import Gym

    with app.app_context():
        ny = Gym(
            name="NY", slug="ny", email="ny@x.com", phone="+1",
            timezone="America/New_York",
            status="active", subscription_status="trial",
            trial_ends_at=today_for_gym("America/New_York"),
        )
        assert _is_trial_expired(ny) is False
        ny.trial_ends_at = today_for_gym("America/New_York") - timedelta(days=1)
        assert _is_trial_expired(ny) is True
        ist = Gym(
            name="IST", slug="ist", email="ist@x.com", phone="+1",
            timezone="Asia/Kolkata",
            status="active", subscription_status="trial",
            trial_ends_at=today_for_gym("Asia/Kolkata") - timedelta(days=1),
        )
        assert _is_trial_expired(ist) is True


# ─── V10-L5: unmapped-punch wipe is owner-only ────────────────────────────

def test_staff_cannot_clear_unmapped_punches(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-08", token="v10-08-token")
    db.session.add(RRRAttendanceEvent(
        gym_id=seed_gym["gym"].id,
        integration_id=integration.id,
        member_id=None,
        source="adms",
        biometric_user_id="999",
        punch_time=datetime.now(timezone.utc),
        dedupe_key="v10-unmapped-1",
    ))
    db.session.commit()

    res = client.delete("/api/mobile/v1/rrr/attendance/unmapped", headers=_staff_headers(seed_gym))
    assert res.status_code == 403, res.get_data(as_text=True)[:300]

    res = client.delete("/api/mobile/v1/rrr/attendance/unmapped", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert res.get_json()["data"]["deleted"] == 1


# ─── V10-L6: password endpoints throttled + counted ───────────────────────

def test_change_password_wrong_current_counts_toward_lockout(client, seed_gym):
    owner_id = seed_gym["owner"].id
    headers = _owner_headers(seed_gym)
    for _ in range(5):
        res = client.post(
            "/api/mobile/v1/auth/change-password", headers=headers,
            json={"current_password": "WrongPassword123!", "new_password": "NewSecurePass123!"},
        )
        assert res.status_code == 403, res.get_data(as_text=True)[:300]
    # 6th guess inside the same minute hits the per-endpoint limiter.
    res = client.post(
        "/api/mobile/v1/auth/change-password", headers=headers,
        json={"current_password": "WrongPassword123!", "new_password": "NewSecurePass123!"},
    )
    assert res.status_code == 429, res.get_data(as_text=True)[:300]

    db.session.remove()
    saved = db.session.get(User, owner_id)
    assert saved.failed_login_count == 5


def test_delete_account_wrong_password_counts_toward_lockout(client, seed_gym):
    owner_id = seed_gym["owner"].id
    res = client.delete(
        "/api/mobile/v1/auth/account", headers=_owner_headers(seed_gym),
        json={"password": "WrongPassword123!"},
    )
    assert res.status_code == 403, res.get_data(as_text=True)[:300]

    db.session.remove()
    saved = db.session.get(User, owner_id)
    assert saved.failed_login_count == 1
    assert saved is not None


# ─── V10-L7: devicecmd cannot resurrect cancelled rows ────────────────────

def _devicecmd_url(token, serial, cmd_id, ret):
    return f"/iclock/{token}/devicecmd?SN={serial}&ID={cmd_id}&Return={ret}"


def test_devicecmd_cannot_resurrect_superseded_row(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-09", token="v10-09-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="L7 Superseded", phone="+919100700009",
        enroll="309", status="expired", end=date.today() - timedelta(days=2),
    )
    failed = _failed_adms_row(integration, action="block", enroll="309", member=member)
    failed_id = failed.id

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    assert res.get_json()["data"]["retried_count"] == 1
    assert _fresh_command(failed_id).status == "cancelled"

    ack = client.get(_devicecmd_url("v10-09-token", "V10-09", failed_id, 0))
    assert ack.status_code == 200
    assert ack.get_data(as_text=True) == "OK"

    saved = _fresh_command(failed_id)
    assert saved.status == "cancelled"
    assert saved.result_code == "superseded_by_retry"


def test_devicecmd_cannot_resurrect_owner_cleared_row(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-10", token="v10-10-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="L7 Cleared", phone="+919100700010",
        enroll="310", status="expired", end=date.today() - timedelta(days=2),
    )
    failed = _failed_adms_row(integration, action="block", enroll="310", member=member)
    failed_id = failed.id

    res = client.post("/api/mobile/v1/access/clear-failed", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    assert _fresh_command(failed_id).status == "cancelled"

    ack = client.get(_devicecmd_url("v10-10-token", "V10-10", failed_id, 0))
    assert ack.status_code == 200

    saved = _fresh_command(failed_id)
    assert saved.status == "cancelled"
    assert saved.result_code == "owner_cleared"


# ─── V10-L8: retry audit ids, already-state, reason split ─────────────────

def test_retry_reports_already_in_desired_state(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-11", token="v10-11-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="L8 Already", phone="+919100700011",
        enroll="311", status="expired", end=date.today() - timedelta(days=2),
    )
    failed = _failed_adms_row(integration, action="block", enroll="311", member=member)
    # The desired block is already acked for this member — the retry
    # must report "already in desired state", not a fresh queue.
    acked = RRRAdmsCommand(
        gym_id=integration.gym_id,
        integration_id=integration.id,
        action="block",
        test_enroll_number="311",
        command_text=adms_command_text("block", "311", member_name="L8 Already"),
        status="acked",
        result_code="0",
        intended_member_id=member.id,
    )
    db.session.add(acked)
    db.session.commit()
    acked_id, failed_id = acked.id, failed.id

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 0
    assert data["already_in_desired_state_count"] == 1
    assert "already in the desired state" in data["message"]

    rows = _fresh_audit("retry_failed_adms_syncs", resource_type="rrr_integration")
    assert len(rows) == 1
    meta = rows[0].metadata_json or {}
    assert meta["retried_command_ids"] == []
    assert meta["already_in_desired_state_ids"] == [acked_id]
    assert meta["superseded_command_ids"] == [failed_id]
    assert _fresh_command(failed_id).status == "cancelled"


def test_retry_reports_no_terminal_identity(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-12", token="v10-12-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    # Member with no terminal identity at all (no enroll, no mapping).
    member = _member(
        gym_id, plan_id, name="L8 No Enroll", phone="+919100700012",
        enroll=None, status="expired", end=date.today() - timedelta(days=2),
    )
    failed = _failed_adms_row(integration, action="block", enroll="312", member=member)
    failed_id = failed.id

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 0
    assert data["skipped_count"] == 1
    assert data["skipped"][0]["reason"] == "no_terminal_identity"
    assert _fresh_command(failed_id).status == "failed"


# ─── V10-L9: retry failed enrollments ─────────────────────────────────────

def test_retry_requeues_failed_create_user_for_enableable_member(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-13", token="v10-13-token")
    integration_id = integration.id
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="L9 Enroll", phone="+919100700013",
        enroll="313", status="active", end=date.today() + timedelta(days=20),
    )
    member_id = member.id
    failed = _failed_adms_row(integration, action="create_user", enroll="313", member=member)
    failed_id = failed.id

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 1
    assert data["skipped_count"] == 0

    assert _fresh_command(failed_id).status == "cancelled"
    fresh = RRRAdmsCommand.query.filter_by(
        integration_id=integration_id, test_enroll_number="313", status="queued"
    ).one()
    assert fresh.action == "create_user"
    assert fresh.intended_member_id == member_id


def test_retry_skips_create_user_for_not_enableable_member(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-14", token="v10-14-token")
    integration_id = integration.id
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="L9 Expired", phone="+919100700014",
        enroll="314", status="expired", end=date.today() - timedelta(days=2),
    )
    failed = _failed_adms_row(integration, action="create_user", enroll="314", member=member)
    failed_id = failed.id

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 0
    assert data["skipped_count"] == 1
    assert data["skipped"][0]["reason"] == "not_enableable"
    assert _fresh_command(failed_id).status == "failed"
    assert RRRAdmsCommand.query.filter_by(
        integration_id=integration_id, test_enroll_number="314", status="queued"
    ).count() == 0


# ─── V10-L10: retry resolves the current holder ───────────────────────────

def test_retry_resolves_current_holder_not_stale_intended_member(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-15", token="v10-15-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    # A is the stale intended member (expired, enroll since recycled).
    member_a = _member(
        gym_id, plan_id, name="L10 Stale A", phone="+919100700015",
        enroll="399", status="expired", end=date.today() - timedelta(days=2),
    )
    # B is the current holder of enroll 201 — active, so the re-derived
    # action must be an unblock for B, never a block for A.
    member_b = _member(
        gym_id, plan_id, name="L10 Holder B", phone="+919100700016",
        enroll="201", status="active", end=date.today() + timedelta(days=20),
    )
    failed = _failed_adms_row(integration, action="block", enroll="201", member=member_a)
    failed_id = failed.id

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 1

    fresh = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, test_enroll_number="201", status="queued"
    ).one()
    assert fresh.action == "unblock"
    assert fresh.intended_member_id == member_b.id

    rows = _fresh_audit("retry_failed_adms_syncs", resource_type="rrr_integration")
    assert len(rows) == 1
    assert (rows[0].metadata_json or {}).get("member_resolution") == {str(failed_id): "current_holder"}


# ─── V10-L11: retry-sync is owner-only ────────────────────────────────────

def test_staff_cannot_trigger_retry_sync(client, seed_gym):
    _adms_integration(seed_gym, serial="V10-16", token="v10-16-token")
    res = client.post("/api/mobile/v1/access/retry-sync", headers=_staff_headers(seed_gym))
    assert res.status_code == 403, res.get_data(as_text=True)[:300]


# ─── V10-L12: batch cap + per-row isolation ───────────────────────────────

def test_retry_sync_caps_batch_at_50(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-17", token="v10-17-token")
    for i in range(55):
        _failed_adms_row(integration, action="block", enroll=str(9000 + i), member=None)

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["skipped_count"] == 50
    assert data["remaining_failed_count"] == 5


def test_retry_sync_isolates_a_failing_row(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-18", token="v10-18-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    good = _member(
        gym_id, plan_id, name="L12 Good", phone="+919100700018",
        enroll="318", status="expired", end=date.today() - timedelta(days=2),
    )
    bad = _member(
        gym_id, plan_id, name="L12 Bad", phone="+919100700019",
        enroll="319", status="expired", end=date.today() - timedelta(days=2),
    )
    good_failed = _failed_adms_row(integration, action="block", enroll="318", member=good)
    bad_failed = _failed_adms_row(integration, action="block", enroll="319", member=bad)

    real_queue = access_module.queue_adms_membership_command

    def _flaky(member):
        if member.id == bad.id:
            raise RuntimeError("boom in re-derive")
        return real_queue(member)

    with mock.patch.object(access_module, "queue_adms_membership_command", side_effect=_flaky):
        res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 1
    assert data["skipped_count"] == 1
    assert data["skipped"][0] == {"command_id": bad_failed.id, "reason": "requeue_failed"}
    assert _fresh_command(good_failed.id).status == "cancelled"
    assert _fresh_command(bad_failed.id).status == "failed"


# ─── V10-M5 (server side): timezone is a real IANA name ──────────────────

def test_settings_patch_rejects_invalid_timezone(client, seed_gym):
    res = client.patch(
        "/api/mobile/v1/settings", headers=_owner_headers(seed_gym),
        json={"timezone": "india"},
    )
    assert res.status_code == 400, res.get_data(as_text=True)[:300]
    res = client.patch(
        "/api/mobile/v1/settings", headers=_owner_headers(seed_gym),
        json={"timezone": "Asia/Kolkata"},
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]


# ─── V10-L33: queued ADMS commands in the summary ────────────────────────

def test_access_summary_includes_queued_adms_commands(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V10-19", token="v10-19-token")
    queued = RRRAdmsCommand(
        gym_id=integration.gym_id,
        integration_id=integration.id,
        action="unblock",
        test_enroll_number="321",
        command_text=adms_command_text("unblock", "321", member_name="L33"),
        status="queued",
    )
    db.session.add(queued)
    db.session.commit()
    queued_id = queued.id

    res = client.get("/api/mobile/v1/access/summary", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    queued_payload = res.get_json()["data"]["queued_adms_commands"]
    assert queued_payload["count"] == 1
    assert len(queued_payload["commands"]) == 1
    row = queued_payload["commands"][0]
    assert row["id"] == queued_id
    assert row["action"] == "unblock"
    assert row["enroll_number"] == "321"
    assert row["queued_at"] is not None


def test_access_summary_queued_adms_commands_empty_without_adms(client, seed_gym):
    res = client.get("/api/mobile/v1/access/summary", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert res.get_json()["data"]["queued_adms_commands"] == {"count": 0, "commands": []}
