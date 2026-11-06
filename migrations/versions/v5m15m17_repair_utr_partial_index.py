"""Repair the UTR unique index on SQLite (V5-M15 + V6-M17, combined).

Two live migrations created ``uq_payments_gym_reference_verified``
with ``postgresql_where=...`` and no dialect guard:

* ``f9e8d7c6b5a4`` (V6-M17) — ``WHERE status = 'verified'``, with NO
  empty-reference exclusion at all. Its skip-when-dupes gate only
  helps when duplicates already exist; on a clean SQLite DB the gate
  passes and the unfiltered index is created.
* ``v4m19canonicalutr`` step 2 (V5-M15) — ``WHERE status =
  'verified' AND trim(reference) <> ''``.

SQLAlchemy drops ``postgresql_where`` on non-Postgres dialects, so on
SQLite both created a plain ``CREATE UNIQUE INDEX ... ON
payment_verifications (gym_id, reference)``. That index then rejects
the second verified cash / no-reference payment per gym (17 verified
rows at Yodha share ``''``) and makes ``flask db upgrade`` fail on
any SQLite DB that already holds them.

Both source migrations RAN LIVE on Postgres — they are NOT edited.
This repair migration:

* SQLite: drops the unfiltered index if present and recreates it as
  a proper SQLite partial index (``CREATE UNIQUE INDEX ... WHERE
  status = 'verified' AND trim(reference) <> ''``). If the index is
  absent (f9e8 skipped it and v4m19 never created it), the partial
  index is created outright. A raw-duplicate audit runs first and
  fails LOUDLY instead of dying mid-DDL.
* Postgres: no-op when the correct partial index already exists
  (verified against ``pg_indexes``); creates it with the correct
  ``WHERE`` clause if it is absent or unfiltered.

The canonical expression index
(``uq_payments_gym_reference_verified_norm``) is deliberately
untouched: it is a Postgres-only artifact by v4m19's design, and the
app-level canonical check is the backstop on SQLite.

Revises: m3rg3v4fixall
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "v5m15m17utrpartial"
down_revision = "m3rg3v4fixall"

INDEX = "uq_payments_gym_reference_verified"
TABLE = "payment_verifications"
# The predicate both live migrations intended (v4m19's version, which
# also excludes empty references — f9e8's lacked that exclusion).
WHERE_SQL = "status = 'verified' AND trim(reference) <> ''"


def _raw_duplicate_audit(conn):
    """Fail loudly if duplicate verified non-empty references exist.

    Those rows would make the (partial) unique index creation fail.
    Same fail-loud philosophy as v4m19's canonical audit.
    """
    dupes = conn.execute(
        text(
            "SELECT gym_id, reference, COUNT(*) AS n "
            f"FROM {TABLE} "
            "WHERE status = 'verified' AND reference IS NOT NULL "
            "AND trim(reference) <> '' "
            "GROUP BY gym_id, reference HAVING COUNT(*) > 1 "
            "ORDER BY gym_id, reference LIMIT 50"
        )
    ).all()
    if dupes:
        print("[v5-m15-m17-utr] DUPLICATE VERIFIED REFERENCES FOUND — refusing:")
        for gym_id, reference, n in dupes:
            print(
                f"[v5-m15-m17-utr] gym_id={gym_id} reference={reference!r} "
                f"verified_count={n}"
            )
        raise RuntimeError(
            "v5-m15-m17-utr: duplicate verified references exist "
            f"({len(dupes)} group(s) printed above). Clean them up, then "
            "re-run — the partial UTR index cannot be installed while "
            "duplicates exist."
        )
    print("[v5-m15-m17-utr] audit: no duplicate verified references.")


def _postgres_indexdef(conn):
    row = conn.execute(
        text(
            "SELECT indexdef FROM pg_indexes "
            f"WHERE tablename = '{TABLE}' AND indexname = '{INDEX}'"
        )
    ).fetchone()
    return row[0] if row else None


def _sqlite_index_sql(conn):
    row = conn.execute(
        text(
            "SELECT sql FROM sqlite_master "
            f"WHERE type = 'index' AND name = '{INDEX}'"
        )
    ).fetchone()
    return row[0] if row else None


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        print(
            f"[v5-m15-m17-utr] table {TABLE} absent (partial-state DB) — "
            "nothing to repair."
        )
        return

    _raw_duplicate_audit(conn)

    index_names = {ix["name"] for ix in inspector.get_indexes(TABLE)}
    dialect = conn.dialect.name

    if dialect == "postgresql":
        indexdef = _postgres_indexdef(conn)
        if indexdef and "trim(reference)" in indexdef and "verified" in indexdef:
            print(
                f"[v5-m15-m17-utr] Postgres index {INDEX} already has the "
                "correct partial predicate — no-op."
            )
            return
        if INDEX in index_names:
            print(
                f"[v5-m15-m17-utr] Postgres index {INDEX} present but "
                "unfiltered — dropping and recreating as partial."
            )
            op.drop_index(INDEX, table_name=TABLE)
        op.create_index(
            INDEX,
            TABLE,
            ["gym_id", "reference"],
            unique=True,
            postgresql_where=text(WHERE_SQL),
        )
        print(f"[v5-m15-m17-utr] created partial index {INDEX} (Postgres).")
        return

    # SQLite (and any other non-Postgres dialect): the live migrations
    # created an unfiltered index here. Replace it with a real partial
    # index via raw DDL — op.create_index would drop the WHERE again.
    if INDEX in index_names:
        print(
            f"[v5-m15-m17-utr] dropping unfiltered index {INDEX} "
            f"({dialect}) — recreating as a partial index."
        )
        op.drop_index(INDEX, table_name=TABLE)
    else:
        print(
            f"[v5-m15-m17-utr] index {INDEX} absent ({dialect}) — "
            "creating the partial index outright."
        )
    conn.execute(
        text(
            f"CREATE UNIQUE INDEX {INDEX} ON {TABLE} (gym_id, reference) "
            f"WHERE {WHERE_SQL}"
        )
    )
    print(f"[v5-m15-m17-utr] created partial index {INDEX} ({dialect}).")


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        return
    index_names = {ix["name"] for ix in inspector.get_indexes(TABLE)}
    if INDEX in index_names:
        # Deliberately does NOT restore the unfiltered index — that
        # was the bug this migration repaired.
        op.drop_index(INDEX, table_name=TABLE)
        print(f"[v5-m15-m17-utr] dropped partial index {INDEX}.")
