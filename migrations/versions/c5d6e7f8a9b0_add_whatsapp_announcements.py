"""Add persistent WhatsApp announcement campaigns.

Revision ID: c5d6e7f8a9b0
Revises: b4e5f6a7b8c9
Create Date: 2026-08-23 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "c5d6e7f8a9b0"
down_revision = "b4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "announcements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("message_body", sa.Text(), nullable=False),
        sa.Column("delivery_mode", sa.String(length=32), nullable=False),
        sa.Column("template_name", sa.String(length=512), nullable=True),
        sa.Column("template_language", sa.String(length=32), nullable=True),
        sa.Column("template_body_parameters", sa.Text(), nullable=True),
        sa.Column("is_test", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="queued"),
        sa.Column("total_recipients", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dispatch_lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "delivery_mode IN ('session_message', 'approved_template')",
            name="ck_announcements_delivery_mode",
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'sending', 'completed', 'completed_with_failures')",
            name="ck_announcements_status",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_announcements_gym_id", "announcements", ["gym_id"], unique=False)
    op.create_index("ix_announcements_created_by_user_id", "announcements", ["created_by_user_id"], unique=False)
    op.create_index("ix_announcements_status", "announcements", ["status"], unique=False)
    op.create_index("ix_announcements_gym_created", "announcements", ["gym_id", "created_at"], unique=False)
    op.create_index(
        "ix_announcements_status_lease",
        "announcements",
        ["status", "dispatch_lease_expires_at"],
        unique=False,
    )

    op.create_table(
        "announcement_deliveries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("announcement_id", sa.Integer(), nullable=False),
        sa.Column("member_id", sa.Integer(), nullable=False),
        sa.Column("phone_snapshot", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_message_id", sa.String(length=255), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'sent', 'failed', 'skipped')",
            name="ck_announcement_deliveries_status",
        ),
        sa.ForeignKeyConstraint(["announcement_id"], ["announcements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("announcement_id", "member_id", name="uq_announcement_delivery_member"),
    )
    op.create_index(
        "ix_announcement_deliveries_gym_id", "announcement_deliveries", ["gym_id"], unique=False
    )
    op.create_index(
        "ix_announcement_deliveries_announcement_id",
        "announcement_deliveries",
        ["announcement_id"],
        unique=False,
    )
    op.create_index(
        "ix_announcement_deliveries_member_id", "announcement_deliveries", ["member_id"], unique=False
    )
    op.create_index(
        "ix_announcement_deliveries_status", "announcement_deliveries", ["status"], unique=False
    )
    op.create_index(
        "ix_announcement_deliveries_announcement_status",
        "announcement_deliveries",
        ["announcement_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_announcement_deliveries_gym_created",
        "announcement_deliveries",
        ["gym_id", "created_at"],
        unique=False,
    )

    # ORM defaults cover new rows after this deployment; remove database
    # defaults so the schema matches the existing model conventions.
    with op.batch_alter_table("announcements") as batch_op:
        batch_op.alter_column("is_test", server_default=None)
        batch_op.alter_column("status", server_default=None)
        batch_op.alter_column("total_recipients", server_default=None)
        batch_op.alter_column("sent_count", server_default=None)
        batch_op.alter_column("failed_count", server_default=None)
        batch_op.alter_column("skipped_count", server_default=None)
    with op.batch_alter_table("announcement_deliveries") as batch_op:
        batch_op.alter_column("status", server_default=None)
        batch_op.alter_column("attempts", server_default=None)


def downgrade():
    op.drop_table("announcement_deliveries")
    op.drop_table("announcements")
