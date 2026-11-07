"""Add token_version to users (V8-L4).

Stateless HMAC access tokens survive password change / logout-all for
up to 15 minutes because revoke_all_user_tokens only deleted refresh
rows. Tokens now carry the user's token_version ("ver" claim, see
app/mobile_api/token_service.py) and the middleware rejects a token
whose version no longer matches. set_password bumps the version on
every password change; revoke_all_user_tokens bumps it on logout-all.

Pure add-column on both SQLite and Postgres (server_default backfills
existing rows with 1). No data is rewritten. Downgrade drops the
column; tokens minted while it existed carry a "ver" the old code
ignores, so downgrade is safe (it re-opens the 15-minute window, which
is the pre-fix behaviour).

Revises: m3rg3v7fixall
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "v8l4usertokenver"
down_revision = "m3rg3v7fixall"
branch_labels = None
depends_on = None

TABLE = "users"
COLUMN = "token_version"


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        print(f"[v8-l4] table {TABLE} absent — nothing to do.")
        return
    columns = {c["name"] for c in inspector.get_columns(TABLE)}
    if COLUMN in columns:
        print(f"[v8-l4] column {COLUMN} already present — no-op.")
        return
    with op.batch_alter_table(TABLE) as batch_op:
        batch_op.add_column(
            sa.Column(COLUMN, sa.Integer(), nullable=False, server_default="1")
        )
    print(f"[v8-l4] added {TABLE}.{COLUMN} (NOT NULL, default 1).")


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
    print(f"[v8-l4] dropped {TABLE}.{COLUMN}.")
