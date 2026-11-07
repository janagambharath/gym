"""Add expires_at to mobile_idempotency_keys (V7-L4, V7-M3).

Replay rows previously lived forever: unbounded growth, arbitrarily stale
replays, and — for create_staff / reset_staff_password — temp passwords
persisting in the replay table indefinitely. New rows get
``expires_at = created_at + 24h`` from the service (see
``app/services/idempotency_service.py``); the column is nullable so this
migration is a pure add-column on both SQLite and Postgres, and legacy
rows (NULL) are treated by the service as ``created_at + 24h``.

No data is deleted or rewritten by this migration — expiry enforcement
and pruning happen in the application (lazy prune in
``begin_idempotency`` + the scheduler job), so a partially-applied state
is harmless.

Revises: m3rg3v5v6fixall
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "v7m3l4idempexpiry"
down_revision = "m3rg3v5v6fixall"
branch_labels = None
depends_on = None

TABLE = "mobile_idempotency_keys"
COLUMN = "expires_at"


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        print(f"[v7-m3l4] table {TABLE} absent — nothing to do.")
        return
    columns = {c["name"] for c in inspector.get_columns(TABLE)}
    if COLUMN in columns:
        print(f"[v7-m3l4] column {COLUMN} already present — no-op.")
        return
    with op.batch_alter_table(TABLE) as batch_op:
        batch_op.add_column(
            sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True)
        )
    print(f"[v7-m3l4] added {TABLE}.{COLUMN} (nullable).")


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        return
    columns = {c["name"] for c in inspector.get_columns(TABLE)}
    if COLUMN not in columns:
        return
    with op.batch_alter_table(TABLE) as batch_op:
        batch_op.drop_column(COLUMN)
    print(f"[v7-m3l4] dropped {TABLE}.{COLUMN}.")
