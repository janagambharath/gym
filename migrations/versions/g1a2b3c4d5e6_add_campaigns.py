"""Add campaigns and campaign_recipients tables.

Revision ID: g1a2b3c4d5e6
Revises: a001_access_events
Create Date: 2026-09-11
"""
from alembic import op
import sqlalchemy as sa


revision = "g1a2b3c4d5e6"
down_revision = None  # Will be set dynamically during migration
branch_labels = None
depends_on = None


def upgrade():
    # --- Campaign table ---
    op.create_table(
        "campaigns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("gym_id", sa.Integer(), sa.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("segment_type", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft", index=True),
        sa.Column("message_template", sa.Text(), nullable=True),
        sa.Column("whatsapp_template_name", sa.String(120), nullable=True),
        sa.Column("attribution_window_days", sa.Integer(), nullable=False, server_default="7"),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_recipients", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_sent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_delivered", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_read", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_replied", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_renewed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_revenue_recovered", sa.Numeric(12, 2), nullable=False, server_default="0.00"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('draft', 'sending', 'sent', 'completed', 'failed')",
            name="ck_campaigns_status",
        ),
    )
    op.create_index("ix_campaigns_gym_status", "campaigns", ["gym_id", "status"])
    op.create_index("ix_campaigns_gym_segment", "campaigns", ["gym_id", "segment_type"])
    op.create_index("ix_campaigns_gym_created", "campaigns", ["gym_id", "created_at"])

    # --- Campaign Recipients table ---
    op.create_table(
        "campaign_recipients",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("member_id", sa.Integer(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("gym_id", sa.Integer(), sa.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("provider_message_id", sa.String(255), nullable=True),
        sa.Column("phone_snapshot", sa.String(40), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reply_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payment_claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("renewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("renewal_amount", sa.Numeric(10, 2), nullable=True),
        sa.Column("renewal_id", sa.Integer(), sa.ForeignKey("renewal_history.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("campaign_id", "member_id", name="uq_campaign_recipient"),
    )
    op.create_index("ix_campaign_recipients_campaign", "campaign_recipients", ["campaign_id"])
    op.create_index("ix_campaign_recipients_member", "campaign_recipients", ["member_id"])
    op.create_index("ix_campaign_recipients_message_id", "campaign_recipients", ["provider_message_id"])

    # --- Add campaign_id to renewal_history for attribution ---
    with op.batch_alter_table("renewal_history") as batch_op:
        batch_op.add_column(sa.Column("campaign_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_renewal_history_campaign", ["campaign_id"])
        batch_op.create_foreign_key(
            "fk_renewal_history_campaign",
            "campaigns",
            ["campaign_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade():
    with op.batch_alter_table("renewal_history") as batch_op:
        batch_op.drop_constraint("fk_renewal_history_campaign", type_="foreignkey")
        batch_op.drop_index("ix_renewal_history_campaign")
        batch_op.drop_column("campaign_id")

    op.drop_table("campaign_recipients")
    op.drop_table("campaigns")
