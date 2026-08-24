"""Add user_push_tokens and app_notifications tables.

Revision ID: 3a4b5c6d7e8f
Revises: 2f3a4b5c6d7e
Create Date: 2026-08-24 18:52:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "3a4b5c6d7e8f"
down_revision = "2f3a4b5c6d7e"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "user_push_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("push_token", sa.String(length=255), nullable=False),
        sa.Column("device_name", sa.String(length=128), nullable=True),
        sa.Column("platform", sa.String(length=32), nullable=False, server_default="android"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gym_id", "user_id", "push_token", name="uq_user_push_token"),
    )
    op.create_index("ix_user_push_tokens_gym_id", "user_push_tokens", ["gym_id"], unique=False)
    op.create_index("ix_user_push_tokens_user_id", "user_push_tokens", ["user_id"], unique=False)
    op.create_index("ix_user_push_tokens_push_token", "user_push_tokens", ["push_token"], unique=False)

    op.create_table(
        "app_notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False, server_default="general"),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_app_notifications_gym_id", "app_notifications", ["gym_id"], unique=False)
    op.create_index("ix_app_notifications_user_id", "app_notifications", ["user_id"], unique=False)
    op.create_index("ix_app_notifications_category", "app_notifications", ["category"], unique=False)
    op.create_index("ix_app_notifications_is_read", "app_notifications", ["is_read"], unique=False)


def downgrade():
    op.drop_table("app_notifications")
    op.drop_table("user_push_tokens")
