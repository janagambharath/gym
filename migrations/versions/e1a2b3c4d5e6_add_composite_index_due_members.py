"""Add composite index for due member reminder scans

Revision ID: e1a2b3c4d5e6
Revises: d7f3c9a8e214
Create Date: 2026-06-06 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "e1a2b3c4d5e6"
down_revision = "d7f3c9a8e214"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_members_due_reminders",
        "members",
        ["gym_id", "membership_end", "status", "whatsapp_opted_in"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade():
    op.drop_index("ix_members_due_reminders", table_name="members")
