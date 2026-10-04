"""Add address column to members table.

Revision ID: k1a2b3c4d5e0
Revises: j1a2b3c4d5e9
Create Date: 2026-10-04 15:30:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "k1a2b3c4d5e0"
down_revision = "j1a2b3c4d5e9"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_columns = {col["name"] for col in inspector.get_columns("members")}
    if "address" not in existing_columns:
        with op.batch_alter_table("members", schema=None) as batch_op:
            batch_op.add_column(
                sa.Column("address", sa.Text(), nullable=True)
            )


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_columns = {col["name"] for col in inspector.get_columns("members")}
    if "address" in existing_columns:
        with op.batch_alter_table("members", schema=None) as batch_op:
            batch_op.drop_column("address")

