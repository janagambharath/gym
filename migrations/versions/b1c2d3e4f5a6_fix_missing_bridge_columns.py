"""Fix missing bridge_commands columns (valid_from, valid_to, delay_seconds).

Revision z8a9b0c1d2e3 was marked as applied on production but the columns
were never actually created. This migration adds them if missing.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "b1c2d3e4f5a6"
down_revision = "a9b0c1d2e3f4"


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    existing = {c["name"] for c in inspector.get_columns("bridge_commands")}
    with op.batch_alter_table("bridge_commands") as batch_op:
        if "delay_seconds" not in existing:
            batch_op.add_column(sa.Column("delay_seconds", sa.Integer(), nullable=True))
        if "valid_from" not in existing:
            batch_op.add_column(sa.Column("valid_from", sa.String(10), nullable=True))
        if "valid_to" not in existing:
            batch_op.add_column(sa.Column("valid_to", sa.String(10), nullable=True))


def downgrade():
    pass
