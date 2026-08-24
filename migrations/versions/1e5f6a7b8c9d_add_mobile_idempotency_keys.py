"""Add replay protection storage for mobile mutations.

Revision ID: 1e5f6a7b8c9d
Revises: 0d4e5f6a7b8c
Create Date: 2026-08-24 00:00:00.000000

This migration is not applied automatically. Use the normal reviewed Alembic
deployment workflow after taking a production backup.
"""

from alembic import op
import sqlalchemy as sa


revision = "1e5f6a7b8c9d"
down_revision = "0d4e5f6a7b8c"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "mobile_idempotency_keys",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("scope", sa.String(length=96), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("response_body", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "gym_id", "user_id", "scope", "key", name="uq_mobile_idempotency_scope_key"
        ),
    )
    op.create_index(
        "ix_mobile_idempotency_keys_gym_id", "mobile_idempotency_keys", ["gym_id"], unique=False
    )
    op.create_index(
        "ix_mobile_idempotency_keys_user_id", "mobile_idempotency_keys", ["user_id"], unique=False
    )


def downgrade():
    op.drop_table("mobile_idempotency_keys")
