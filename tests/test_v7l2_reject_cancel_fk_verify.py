"""Unit tests for the V7-L2 verification migration
v7l2_verify_reject_cancel_fks.py.

No live database: Postgres is not available in this VM, and the FK
repair targets a live prod state. The migration's durable-record
helpers (``_ensure_notes_table`` / ``_record_failure`` /
``_resolve_note``) are pure SQLAlchemy Core over a raw connection, so
these tests drive them against an in-memory SQLite database; the
alembic-level upgrade/downgrade (FK create, idempotency, single head)
is verified separately on a scratch SQLite DB via
``ALLOW_SQLITE_MIGRATIONS=1 flask db upgrade/downgrade`` (see the
fix-all v7 worker report — it is not reproducible inside pytest
because the chain's earlier migrations are Postgres-only).

V7-L2 context: v5l44 printed a WARNING and let the deploy continue
when FK creation failed, then stamped itself applied — the missing
backstop FK was never retried or surfaced again. This migration
re-checks and creates missing FKs, runs each attempt inside a
SAVEPOINT (so a Postgres failure cannot poison the enclosing
transaction, which v5l44's bare try/except did not prevent), and
writes failures to a durable ``schema_repair_notes`` table.
"""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy import create_engine

import pytest

BASE = Path(__file__).resolve().parents[1] / "migrations" / "versions"


def _load(name, filename):
    path = BASE / filename
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mig = _load("v7l2_migration", "v7l2_verify_reject_cancel_fks.py")
v5l44 = _load("v5l44_migration", "v5l44_repair_reject_cancel_fks.py")

FK_REJECTED = "fk_payments_rejected_by_id"
FK_CANCELLED = "fk_payments_cancelled_by_id"


@pytest.fixture
def conn():
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as c:
        yield c


def _open_notes(c, subject):
    return c.execute(
        sa.select(mig._NOTES)
        .where(
            mig._NOTES.c.subject == subject,
            mig._NOTES.c.status == "open",
        )
    ).fetchall()


def _all_notes(c, subject):
    return c.execute(
        sa.select(mig._NOTES).where(mig._NOTES.c.subject == subject)
    ).fetchall()


# --- chain wiring ---------------------------------------------------------

def test_revision_and_parent():
    assert mig.revision == "v7l2rejectcancelfk"
    assert mig.down_revision == "m3rg3v5v6fixall"


def test_targets_the_same_fks_as_v5l44():
    # The repair must target exactly the backstops v5l44 owns — a typo
    # here would silently verify the wrong constraint.
    assert mig.TABLE == v5l44.TABLE == "payment_verifications"
    assert mig.FKS == v5l44.FKS == (
        ("rejected_by_id", FK_REJECTED),
        ("cancelled_by_id", FK_CANCELLED),
    )
    assert [name for name, _ in mig.COLUMNS] == [
        name for name, _ in v5l44.COLUMNS
    ]


def test_upgrade_does_not_reference_editing_v5l44():
    # Guardrail: the fix is a NEW migration, never an edit of the live
    # v5l44 file — upgrade() must not touch any migration file on disk.
    import inspect

    src = inspect.getsource(mig.upgrade)
    assert "v5l44_repair" not in src
    assert "open(" not in src


# --- durable notes --------------------------------------------------------

def test_ensure_notes_table_is_idempotent(conn):
    mig._ensure_notes_table(conn)
    mig._ensure_notes_table(conn)
    names = {
        row[0]
        for row in conn.execute(
            sa.text(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        )
    }
    assert mig.NOTES_TABLE in names


def test_record_failure_writes_open_note(conn):
    mig._record_failure(conn, FK_REJECTED, "orphaned rejected_by_id 999")
    notes = _open_notes(conn, FK_REJECTED)
    assert len(notes) == 1
    note = notes[0]
    assert note.migration == mig.revision
    assert note.status == "open"
    assert "orphaned rejected_by_id 999" in note.detail
    assert note.created_at is not None
    assert note.resolved_at is None


def test_record_failure_dedupes_open_notes(conn):
    mig._record_failure(conn, FK_REJECTED, "first failure")
    mig._record_failure(conn, FK_REJECTED, "second failure, same deploy?")
    assert len(_open_notes(conn, FK_REJECTED)) == 1
    # …but a different FK gets its own note.
    mig._record_failure(conn, FK_CANCELLED, "cancelled failure")
    assert len(_open_notes(conn, FK_CANCELLED)) == 1


def test_record_failure_creates_table_when_absent(conn):
    # No _ensure_notes_table call first: the helper must self-heal.
    mig._record_failure(conn, FK_CANCELLED, "no table yet")
    assert len(_open_notes(conn, FK_CANCELLED)) == 1


def test_resolve_note_marks_open_note_resolved(conn):
    mig._record_failure(conn, FK_REJECTED, "fk missing at deploy")
    mig._resolve_note(conn, FK_REJECTED)
    assert _open_notes(conn, FK_REJECTED) == []
    notes = _all_notes(conn, FK_REJECTED)
    assert len(notes) == 1
    assert notes[0].status == "resolved"
    assert notes[0].resolved_at is not None


def test_resolve_note_is_noop_without_open_note(conn):
    mig._ensure_notes_table(conn)
    mig._resolve_note(conn, FK_REJECTED)  # must not raise
    assert _all_notes(conn, FK_REJECTED) == []


def test_new_failure_after_resolve_opens_fresh_note(conn):
    mig._record_failure(conn, FK_REJECTED, "first failure")
    mig._resolve_note(conn, FK_REJECTED)
    mig._record_failure(conn, FK_REJECTED, "failed again on re-deploy")
    notes = _all_notes(conn, FK_REJECTED)
    assert len(notes) == 2
    assert [n.status for n in notes] == ["resolved", "open"]


# --- upgrade/downgrade structure (source-level, same style as the
#     Yodha downgrade test — the live run is the scratch-DB check) -----

def test_upgrade_uses_savepoint_and_records_failures():
    import inspect

    src = inspect.getsource(mig.upgrade)
    assert "conn.begin_nested()" in src
    assert "_record_failure(conn, fk_name, detail)" in src
    assert "_resolve_note(conn, fk_name)" in src


def test_downgrade_drops_only_the_two_fks_and_keeps_notes():
    import inspect

    src = inspect.getsource(mig.downgrade)
    assert "drop_constraint(fk_name" in src
    assert "drop_table" not in src
    # The notes table must survive a rollback — it is the audit trail.
    assert "schema_repair_notes is deliberately NOT dropped" in src
