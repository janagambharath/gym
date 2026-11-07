"""Verify/repair the reject/cancel audit FKs (V7-L2).

``v5l44_repair_reject_cancel_fks`` fixed v4l35's silently-skipped FKs,
but its failure path only printed a WARNING to deploy stdout and let
the deploy continue: the migration then stamped itself applied, so no
later ``flask db upgrade heads`` ever retried the FK, and the missing
backstop FK left no durable trace. A deploy could report green with
``fk_payments_rejected_by_id`` / ``fk_payments_cancelled_by_id``
absent, silently, permanently.

v5l44 RAN LIVE — it is NOT edited. This migration re-checks FK
existence independently (inspector) and creates any missing FKs
(``fk_payments_rejected_by_id``, ``fk_payments_cancelled_by_id`` on
``payment_verifications``), so a prod DB where v5l44's FK create
failed gets the backstop on the next deploy. It is idempotent: on a
DB where the FKs already exist it prints a skip and changes nothing,
and it is safe on a fresh DB (v5l44 runs first in the chain and adds
the columns; the column adds are repeated here, guarded, so a
partial-state DB missing the columns gets them too).

Two improvements over v5l44's failure path:

* Each FK-create attempt runs inside a SAVEPOINT (``conn.begin_nested()``).
  v5l44's bare try/except swallows the error, but on Postgres a failed
  DDL statement aborts the enclosing transaction, so the very next
  statement (the second FK attempt, or the alembic-version stamp)
  would fail with InFailedSqlTransaction — the "deploy continues"
  intent only ever worked on the success path. The savepoint rolls
  back just the failed attempt and leaves the outer transaction
  usable.
* A failed FK create is written to a durable ``schema_repair_notes``
  table (created here if absent: migration, subject, detail, status,
  timestamps), de-duplicated on open notes, so the gap is surfaced on
  every later inspection instead of living only in one deploy log.
  When a later run finds the FK present, any open note for it is
  marked ``resolved``.

SQLite-safe: inspector checks, batch alter table for the FK DDL, and
SQLAlchemy Core (``Table.create(checkfirst=True)``) for the notes
table — no Postgres-only SQL. Safe/no-op downgrade: drops only the
two FKs when present; ``schema_repair_notes`` is deliberately left
intact (it is an audit trail — a rollback must not erase the record
of a missing backstop).

Revises: m3rg3v5v6fixall
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "v7l2rejectcancelfk"
down_revision = "m3rg3v5v6fixall"

TABLE = "payment_verifications"

# (column, fk name) — same DDL as v4l35 / v5l44.
FKS = (
    ("rejected_by_id", "fk_payments_rejected_by_id"),
    ("cancelled_by_id", "fk_payments_cancelled_by_id"),
)

COLUMNS = (
    ("rejected_at", sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True)),
    ("rejected_by_id", sa.Column("rejected_by_id", sa.Integer(), nullable=True)),
    ("cancelled_at", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True)),
    ("cancelled_by_id", sa.Column("cancelled_by_id", sa.Integer(), nullable=True)),
)

NOTES_TABLE = "schema_repair_notes"

# SQLAlchemy Core table: create(checkfirst=True) + Core insert/select/
# update work on a raw connection with no alembic context, on both
# dialects — which is also what makes the note helpers unit-testable.
_NOTES = sa.Table(
    NOTES_TABLE,
    sa.MetaData(),
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("migration", sa.String(120), nullable=False),
    sa.Column("subject", sa.String(200), nullable=False),
    sa.Column("detail", sa.Text, nullable=True),
    sa.Column("status", sa.String(20), nullable=False, server_default="open"),
    sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
)


def _now():
    return datetime.now(timezone.utc)


def _ensure_notes_table(conn):
    """Create schema_repair_notes if absent (no-op when present)."""
    _NOTES.create(conn, checkfirst=True)


def _open_note_exists(conn, fk_name):
    row = conn.execute(
        sa.select(_NOTES.c.id).where(
            _NOTES.c.migration == revision,
            _NOTES.c.subject == fk_name,
            _NOTES.c.status == "open",
        )
    ).fetchone()
    return row is not None


def _record_failure(conn, fk_name, detail):
    """Durably record a failed FK create (de-duplicated on open notes).

    Best-effort by design: note-writing must never fail the deploy,
    so every failure here degrades to a printed warning.
    """
    try:
        _ensure_notes_table(conn)
        if _open_note_exists(conn, fk_name):
            print(
                f"[v7-l2] open repair note already exists for {fk_name} — "
                "not duplicating."
            )
            return
        conn.execute(
            _NOTES.insert().values(
                created_at=_now(),
                migration=revision,
                subject=fk_name,
                detail=detail,
                status="open",
            )
        )
        print(
            f"[v7-l2] recorded missing-FK note for {fk_name} in "
            f"{NOTES_TABLE} (status=open)."
        )
    except Exception as exc:  # noqa: BLE001 — notes must never block deploy
        print(
            f"[v7-l2] WARNING: could not record repair note for {fk_name}: "
            f"{exc}. The FK is still missing — check for orphaned *_by_id "
            "values and create the FK manually."
        )


def _resolve_note(conn, fk_name):
    """Mark any open note for this FK resolved (the FK is now present)."""
    try:
        _ensure_notes_table(conn)
        if not _open_note_exists(conn, fk_name):
            return
        conn.execute(
            _NOTES.update()
            .where(
                _NOTES.c.migration == revision,
                _NOTES.c.subject == fk_name,
                _NOTES.c.status == "open",
            )
            .values(status="resolved", resolved_at=_now())
        )
        print(f"[v7-l2] resolved open repair note for {fk_name}.")
    except Exception as exc:  # noqa: BLE001 — notes must never block deploy
        print(
            f"[v7-l2] WARNING: could not resolve repair note for {fk_name}: "
            f"{exc}."
        )


def _existing_fks(conn):
    inspector = inspect(conn)
    return {
        fk["name"]
        for fk in inspector.get_foreign_keys(TABLE)
        if fk.get("name")
    }


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        print(
            f"[v7-l2] table {TABLE} absent (partial-state DB) — "
            "nothing to verify."
        )
        return

    # 1) Columns first, guarded — independent of the FK step below
    # (same guarded repeat as v5l44, so a partial-state DB missing the
    # columns gets them too).
    existing = {c["name"] for c in inspector.get_columns(TABLE)}
    missing_cols = [name for name, _ in COLUMNS if name not in existing]
    if missing_cols:
        with op.batch_alter_table(TABLE) as batch_op:
            for name, col in COLUMNS:
                if name in missing_cols:
                    batch_op.add_column(col)
        print(f"[v7-l2] added missing columns: {missing_cols}")
        inspector = inspect(conn)
        existing = {c["name"] for c in inspector.get_columns(TABLE)}

    # 2) FKs — checked independently of column pre-existence, each
    # create attempt inside a SAVEPOINT so a Postgres failure cannot
    # poison the enclosing transaction (the v5l44 bare try/except
    # left the txn aborted on the failure path).
    try:
        _ensure_notes_table(conn)
    except Exception as exc:  # noqa: BLE001 — notes are best-effort
        print(f"[v7-l2] WARNING: could not ensure {NOTES_TABLE}: {exc}.")

    existing_fks = _existing_fks(conn)
    for col, fk_name in FKS:
        if col not in existing:
            print(f"[v7-l2] column {col} absent — cannot create {fk_name}.")
            continue
        if fk_name in existing_fks:
            print(f"[v7-l2] FK {fk_name} already exists — skipping.")
            _resolve_note(conn, fk_name)
            continue
        try:
            with conn.begin_nested():
                with op.batch_alter_table(TABLE) as batch_op:
                    batch_op.create_foreign_key(
                        fk_name, "users", [col], ["id"], ondelete="SET NULL"
                    )
            print(f"[v7-l2] created FK {fk_name}.")
            _resolve_note(conn, fk_name)
        except Exception as exc:  # noqa: BLE001 — loud warning + durable note
            detail = (
                f"FK {fk_name} on {TABLE}.{col} -> users.id could not be "
                f"created: {exc}. Check for orphaned {col} values pointing "
                "at deleted users and create the FK manually."
            )
            print(f"[v7-l2] WARNING: {detail} Deploy continues.")
            _record_failure(conn, fk_name, detail)


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        return
    existing_fks = _existing_fks(conn)
    # Drops only the two FKs this migration owns (guarded). In a full
    # downgrade chain v5l44's downgrade follows and drops the columns;
    # dropping the FKs first is consistent with that order. Rolling
    # back just this revision removes the backstop again — that is the
    # point of the downgrade.
    for _, fk_name in FKS:
        if fk_name not in existing_fks:
            continue
        with op.batch_alter_table(TABLE) as batch_op:
            batch_op.drop_constraint(fk_name, type_="foreignkey")
        print(f"[v7-l2] dropped FK {fk_name}.")
    # schema_repair_notes is deliberately NOT dropped: it is the audit
    # trail of missing backstops, and a rollback must not erase it. A
    # later re-upgrade re-resolves notes for FKs it recreates.
