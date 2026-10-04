"""Allow NULL previous_end in renewal_history table for new member enrollments.

Revision ID: l1a2b3c4d5e1
Revises: k1a2b3c4d5e0
Create Date: 2026-10-04 17:40:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "l1a2b3c4d5e1"
down_revision = "k1a2b3c4d5e0"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        op.execute("ALTER TABLE renewal_history ALTER COLUMN previous_end DROP NOT NULL")
    else:
        with op.batch_alter_table("renewal_history", schema=None) as batch_op:
            batch_op.alter_column("previous_end", existing_type=sa.Date(), nullable=True)


def downgrade():
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        op.execute("ALTER TABLE renewal_history ALTER COLUMN previous_end SET NOT NULL")
    else:
        with op.batch_alter_table("renewal_history", schema=None) as batch_op:
            batch_op.alter_column("previous_end", existing_type=sa.Date(), nullable=False)
