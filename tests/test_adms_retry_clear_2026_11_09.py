"""ADMS retry/clear for failed Direct ADMS commands (2026-11-09).

Live Access counts ``rrr_adms_commands`` rows with status='failed' for
an ADMS-direct gym, and until this change the retry/clear endpoints
409'd DIRECT_ADMS_ACTIVE for those gyms — so the banner (Yodha: 2,
Arun's: 8) could never come down, and failed rows had no detail view
anywhere. This file covers the ADMS branches:

* retry-sync re-derives the action from the member's CURRENT state
  (a failed block for a since-renewed member becomes a fresh unblock,
  and vice versa) and stamps the old row cancelled/superseded;
* unretryable rows (test actions, unlock_door, unresolvable enrolls,
  commands-disabled / never-polled terminals) stay failed and are
  reported in ``skipped``;
* clear-failed cancels failed rows (never deletes them) and the
  failed count drops to zero;
* ``cancel_adms_command`` now stamps status='cancelled' (the row no
  longer counts as failed);
* the migration widens the status CHECK to admit 'cancelled'.

Hard invariant pinned here too: retry never replays a failed row's own
action — the action always comes from current membership state via
``queue_adms_membership_command``, and the serve-time fail-safe guard
still judges any re-derived block before it can reach a terminal.
"""
from __future__ import annotations

import importlib.util
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import create_engine

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member
from app.models.audit_log import AuditLog
from app.models.rrr import RRRAdmsCommand, RRRIntegration
from app.services.bridge_service import (
    STALE_DISABLE_MARKER,
    adms_command_text,
    cancel_adms_command,
    invalidate_adms_enroll_index,
)


def _owner_headers(seed_gym):
    owner = seed_gym["owner"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, 'gym_owner')}"}


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
        display_name="ADMS retry/clear",
        device_serial=serial,
        device_name="Retry X2008",
        status="connected",
        commands_enabled=commands_enabled,
        commissioning_status="physical_test_passed",
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


def _failed_count(integration):
    return RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, status="failed"
    ).count()


# ─── retry: re-derivation from current state ───────────────────────────────

def test_retry_failed_block_becomes_unblock_when_member_renewed(client, seed_gym):
    """A failed block for a member who has since renewed → fresh unblock."""
    integration = _adms_integration(seed_gym, serial="RT-01-X2008", token="rt-01-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="Renewed Retry", phone="+919100600001",
        enroll="201", status="expired", end=date.today() - timedelta(days=3),
    )
    failed = _failed_adms_row(integration, action="block", enroll="201", member=member)
    assert _failed_count(integration) == 1

    # The member renews: active with a future end date.
    member.status = "active"
    member.membership_end = date.today() + timedelta(days=30)
    db.session.commit()

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 1
    assert data["skipped_count"] == 0

    saved = db.session.get(RRRAdmsCommand, failed.id)
    assert saved.status == "cancelled"
    assert saved.result_code == "superseded_by_retry"
    assert "Timeout: no ack within 10 min" in (saved.result_message or "")
    assert "Superseded by retry as command" in (saved.result_message or "")

    fresh = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, test_enroll_number="201", status="queued"
    ).one()
    assert fresh.action == "unblock"
    assert fresh.id != failed.id
    assert _failed_count(integration) == 0

    rows = AuditLog.query.filter_by(
        resource_type="rrr_integration", action="retry_failed_adms_syncs"
    ).all()
    assert any(
        (r.metadata_json or {}).get("retried_count") == 1 for r in rows
    ), "expected a retry_failed_adms_syncs audit row"


def test_retry_failed_unblock_becomes_block_when_member_expired(client, seed_gym):
    """A failed unblock for a member who has since expired → fresh block."""
    integration = _adms_integration(seed_gym, serial="RT-02-X2008", token="rt-02-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="Expired Retry", phone="+919100600002",
        enroll="202", status="active", end=date.today() + timedelta(days=30),
    )
    failed = _failed_adms_row(integration, action="unblock", enroll="202", member=member)

    member.status = "expired"
    member.membership_end = date.today() - timedelta(days=2)
    db.session.commit()

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 1
    assert data["skipped_count"] == 0

    saved = db.session.get(RRRAdmsCommand, failed.id)
    assert saved.status == "cancelled"
    assert saved.result_code == "superseded_by_retry"

    fresh = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, test_enroll_number="202", status="queued"
    ).one()
    assert fresh.action == "block"
    assert _failed_count(integration) == 0


def test_retry_failed_block_for_still_expired_member_requeues_block(client, seed_gym):
    """No state change: a failed block for a still-expired member re-queues."""
    integration = _adms_integration(seed_gym, serial="RT-03-X2008", token="rt-03-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="Still Expired", phone="+919100600003",
        enroll="203", status="expired", end=date.today() - timedelta(days=5),
    )
    failed = _failed_adms_row(integration, action="block", enroll="203", member=member)

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert res.get_json()["data"]["retried_count"] == 1

    saved = db.session.get(RRRAdmsCommand, failed.id)
    assert saved.status == "cancelled"
    fresh = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, test_enroll_number="203", status="queued"
    ).one()
    assert fresh.action == "block"
    assert _failed_count(integration) == 0


# ─── retry: skips ──────────────────────────────────────────────────────────

def test_retry_skips_unresolvable_enroll_and_leaves_it_failed(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="RT-04-X2008", token="rt-04-token")
    failed = _failed_adms_row(integration, action="block", enroll="9999", member=None)

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 0
    assert data["skipped_count"] == 1
    assert data["skipped"][0]["reason"] == "unresolvable_member"

    saved = db.session.get(RRRAdmsCommand, failed.id)
    assert saved.status == "failed"
    assert _failed_count(integration) == 1


def test_retry_skips_test_action(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="RT-05-X2008", token="rt-05-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="Test Action", phone="+919100600005",
        enroll="205", status="expired", end=date.today() - timedelta(days=2),
    )
    failed = _failed_adms_row(
        integration, action="block_test", enroll="205", member=member
    )

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 0
    assert data["skipped_count"] == 1
    assert data["skipped"][0]["reason"] == "test_action"

    saved = db.session.get(RRRAdmsCommand, failed.id)
    assert saved.status == "failed"
    assert _failed_count(integration) == 1


def test_retry_skips_unlock_door(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="RT-06-X2008", token="rt-06-token")
    failed = _failed_adms_row(integration, action="unlock_door", enroll="SYSTEM")

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 0
    assert data["skipped_count"] == 1
    assert data["skipped"][0]["reason"] == "unlock_door"

    saved = db.session.get(RRRAdmsCommand, failed.id)
    assert saved.status == "failed"
    assert _failed_count(integration) == 1


def test_retry_skips_everything_when_terminal_never_polled(client, seed_gym):
    integration = _adms_integration(
        seed_gym, serial="RT-07-X2008", token="rt-07-token", last_success_at=None
    )
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="Never Polled", phone="+919100600007",
        enroll="207", status="expired", end=date.today() - timedelta(days=2),
    )
    failed = _failed_adms_row(integration, action="block", enroll="207", member=member)

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 0
    assert data["skipped_count"] == 1
    assert data["skipped"][0]["reason"] == "terminal_never_polled"

    saved = db.session.get(RRRAdmsCommand, failed.id)
    assert saved.status == "failed"
    assert _failed_count(integration) == 1


def test_retry_skips_everything_when_commands_disabled(client, seed_gym):
    integration = _adms_integration(
        seed_gym, serial="RT-08-X2008", token="rt-08-token", commands_enabled=False
    )
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="Disabled Cmds", phone="+919100600008",
        enroll="208", status="expired", end=date.today() - timedelta(days=2),
    )
    failed = _failed_adms_row(integration, action="block", enroll="208", member=member)

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 0
    assert data["skipped_count"] == 1
    assert data["skipped"][0]["reason"] == "commands_disabled"

    saved = db.session.get(RRRAdmsCommand, failed.id)
    assert saved.status == "failed"
    assert _failed_count(integration) == 1


def test_retry_mixed_batch_retries_some_skips_rest(client, seed_gym):
    """One retried row + one skipped row in a single call."""
    integration = _adms_integration(seed_gym, serial="RT-09-X2008", token="rt-09-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member = _member(
        gym_id, plan_id, name="Mixed Retry", phone="+919100600009",
        enroll="209", status="expired", end=date.today() - timedelta(days=2),
    )
    good = _failed_adms_row(integration, action="block", enroll="209", member=member)
    bad = _failed_adms_row(integration, action="block", enroll="9998", member=None)

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["retried_count"] == 1
    assert data["skipped_count"] == 1

    assert db.session.get(RRRAdmsCommand, good.id).status == "cancelled"
    assert db.session.get(RRRAdmsCommand, bad.id).status == "failed"
    assert _failed_count(integration) == 1


# ─── clear ─────────────────────────────────────────────────────────────────

def test_clear_cancels_failed_rows_without_deleting_them(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="RT-10-X2008", token="rt-10-token")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    member_a = _member(
        gym_id, plan_id, name="Clear A", phone="+919100600010",
        enroll="210", status="expired", end=date.today() - timedelta(days=2),
    )
    member_b = _member(
        gym_id, plan_id, name="Clear B", phone="+919100600011",
        enroll="211", status="active", end=date.today() + timedelta(days=20),
    )
    failed_a = _failed_adms_row(
        integration, action="block", enroll="210", member=member_a,
        result_message="Terminal rejected the command.",
    )
    failed_b = _failed_adms_row(
        integration, action="unblock", enroll="211", member=member_b,
        result_message="Timeout: no ack within 10 min",
    )
    assert _failed_count(integration) == 2

    res = client.post("/api/mobile/v1/access/clear-failed", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["cleared_count"] == 2

    # Rows survive as audit history; only status/result_code change.
    saved_a = db.session.get(RRRAdmsCommand, failed_a.id)
    saved_b = db.session.get(RRRAdmsCommand, failed_b.id)
    assert saved_a is not None and saved_a.status == "cancelled"
    assert saved_a.result_code == "owner_cleared"
    assert saved_a.result_message == "Terminal rejected the command."
    assert saved_b is not None and saved_b.status == "cancelled"
    assert saved_b.result_code == "owner_cleared"
    assert saved_b.result_message == "Timeout: no ack within 10 min"
    assert _failed_count(integration) == 0

    rows = AuditLog.query.filter_by(
        resource_type="rrr_integration", action="clear_failed_adms_commands"
    ).all()
    assert any(
        (r.metadata_json or {}).get("cleared_count") == 2 for r in rows
    ), "expected a clear_failed_adms_commands audit row"


def test_clear_on_gym_with_no_failed_rows_is_a_noop(client, seed_gym):
    _adms_integration(seed_gym, serial="RT-11-X2008", token="rt-11-token")

    res = client.post("/api/mobile/v1/access/clear-failed", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert res.get_json()["data"]["cleared_count"] == 0


# ─── cancel_adms_command stamps 'cancelled' ────────────────────────────────

def test_cancel_adms_command_yields_cancelled_not_failed(seed_gym):
    integration = _adms_integration(seed_gym, serial="RT-12-X2008", token="rt-12-token")
    row = RRRAdmsCommand(
        gym_id=integration.gym_id,
        integration_id=integration.id,
        action="block",
        test_enroll_number="212",
        command_text=adms_command_text("block", "212", member_name="Cancel Test"),
        status="queued",
    )
    db.session.add(row)
    db.session.commit()

    cancel_adms_command(row, marker=STALE_DISABLE_MARKER, error="Stale state.")
    db.session.commit()

    saved = db.session.get(RRRAdmsCommand, row.id)
    assert saved.status == "cancelled"
    assert saved.result_code == STALE_DISABLE_MARKER
    assert saved.result_message == "Stale state."
    assert _failed_count(integration) == 0


# ─── migration wiring ──────────────────────────────────────────────────────

def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "migrations" / "versions"
        / "fcce2a90ef39_adms_command_cancelled_status.py"
    )
    spec = importlib.util.spec_from_file_location("adms_cancelled_status_mig", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_revision_and_parent():
    mig = _load_migration()
    assert mig.revision == "fcce2a90ef39"
    assert mig.down_revision == "v8l29l32memberidem"


def test_migration_upgrade_widens_status_check_and_downgrade_is_noop():
    """Drive upgrade()/downgrade() against in-memory SQLite with a table
    carrying the OLD four-value CHECK (the full alembic chain is
    Postgres-only, so the alembic-level upgrade is verified separately
    on a scratch DB via ALLOW_SQLITE_MIGRATIONS=1 flask db upgrade)."""
    mig = _load_migration()
    engine = create_engine("sqlite:///:memory:")
    old_check = "status IN ('queued', 'delivered', 'acked', 'failed')"
    with engine.connect() as conn:
        conn.execute(sa.text(
            "CREATE TABLE rrr_adms_commands ("
            "id INTEGER PRIMARY KEY, status VARCHAR(16) NOT NULL, "
            "CONSTRAINT ck_rrr_adms_command_status "
            f"CHECK ({old_check}))"
        ))
        conn.execute(sa.text(
            "INSERT INTO rrr_adms_commands (id, status) VALUES (1, 'failed')"
        ))
        conn.commit()
        # Pre-upgrade: 'cancelled' is rejected by the old CHECK.
        with pytest.raises(Exception):
            conn.execute(sa.text(
                "INSERT INTO rrr_adms_commands (id, status) VALUES (2, 'cancelled')"
            ))
        conn.rollback()
        # Drive the migration's real upgrade() with its op proxy bound
        # to this connection.
        from alembic.operations import Operations
        from alembic.runtime.migration import MigrationContext
        ctx = MigrationContext.configure(conn)
        mig.op = Operations(ctx)
        mig.upgrade()
        conn.execute(sa.text(
            "INSERT INTO rrr_adms_commands (id, status) VALUES (2, 'cancelled')"
        ))
        conn.commit()
        assert conn.execute(
            sa.text("SELECT status FROM rrr_adms_commands WHERE id = 2")
        ).scalar_one() == "cancelled"
        # A bogus status is still rejected by the widened CHECK.
        with pytest.raises(Exception):
            conn.execute(sa.text(
                "INSERT INTO rrr_adms_commands (id, status) VALUES (3, 'bogus')"
            ))
        conn.rollback()
        # Downgrade is a documented no-op: it must not raise and must
        # not touch the widened CHECK.
        mig.downgrade()
        assert conn.execute(
            sa.text("SELECT status FROM rrr_adms_commands WHERE id = 2")
        ).scalar_one() == "cancelled"
