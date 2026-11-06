"""Repair the due-members composite index (V6-L39).

``e1a2b3c4d5e6`` created ``ix_members_due_reminders`` with
``postgresql_where=sa.text("deleted_at IS NULL")`` and no dialect
check, no existence check in ``upgrade()``, and an unguarded
``drop_index`` in ``downgrade()`` — the third instance of the
``postgresql_where`` class v5 flagged twice. On SQLite it created an
unfiltered (non-unique, so functionally harmless — just wider) index;
on a partial-state DB, re-upgrade fails with "index already exists"
and downgrade fails with "no such index".

e1a2b3c4d5e6 RAN LIVE (ancestor of m3rg3v4fixall) — it is NOT edited.
This migration:

* creates the index only when absent (inspector-checked);
* replaces it with a proper partial index when present-but-unfiltered
  (checked against ``pg_indexes`` on Postgres, ``sqlite_master`` on
  SQLite), so the stored index matches the intended predicate on
  every dialect;
* downgrade drops it only when present (inspector-checked).

Revises: m3rg3v4fixall
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "v6l39duemembersidx"
down_revision = "m3rg3v4fixall"

INDEX = "ix_members_due_reminders"
TABLE = "members"
COLUMNS = ["gym_id", "membership_end", "status", "whatsapp_opted_in"]
WHERE_SQL = "deleted_at IS NULL"


def _is_partial(conn):
    """True when the stored index carries the intended WHERE clause."""
    dialect = conn.dialect.name
    if dialect == "postgresql":
        row = conn.execute(
            text(
                "SELECT indexdef FROM pg_indexes "
                f"WHERE tablename = '{TABLE}' AND indexname = '{INDEX}'"
            )
        ).fetchone()
        return bool(row and "deleted_at IS NULL" in row[0])
    row = conn.execute(
        text(
            "SELECT sql FROM sqlite_master "
            f"WHERE type = 'index' AND name = '{INDEX}'"
        )
    ).fetchone()
    return bool(row and row[0] and "WHERE" in row[0].upper())


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        print(
            f"[v6-l39] table {TABLE} absent (partial-state DB) — "
            "nothing to repair."
        )
        return

    index_names = {ix["name"] for ix in inspector.get_indexes(TABLE)}
    if INDEX in index_names:
        if _is_partial(conn):
            print(
                f"[v6-l39] index {INDEX} already has the correct partial "
                "predicate — no-op."
            )
            return
        print(
            f"[v6-l39] index {INDEX} present but unfiltered — dropping "
            "and recreating as a partial index."
        )
        op.drop_index(INDEX, table_name=TABLE)
    else:
        print(f"[v6-l39] index {INDEX} absent — creating it.")

    if conn.dialect.name == "postgresql":
        op.create_index(
            INDEX, TABLE, COLUMNS, unique=False,
            postgresql_where=sa.text(WHERE_SQL),
        )
    else:
        # Raw DDL: op.create_index would drop the WHERE on SQLite —
        # the original bug.
        cols = ", ".join(COLUMNS)
        conn.execute(
            text(
                f"CREATE INDEX {INDEX} ON {TABLE} ({cols}) "
                f"WHERE {WHERE_SQL}"
            )
        )
    print(f"[v6-l39] created partial index {INDEX}.")


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        return
    index_names = {ix["name"] for ix in inspector.get_indexes(TABLE)}
    if INDEX in index_names:
        op.drop_index(INDEX, table_name=TABLE)
        print(f"[v6-l39] dropped index {INDEX}.")
