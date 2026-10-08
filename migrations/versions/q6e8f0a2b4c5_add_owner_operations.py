"""Add owner-operation lead fields and daily cash closes.

Revision ID: q6e8f0a2b4c5
Revises: p5e7f9a1b3c4
"""
from alembic import op
import sqlalchemy as sa


revision = "q6e8f0a2b4c5"
down_revision = "p5e7f9a1b3c4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("bot_leads", sa.Column("next_follow_up_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("bot_leads", sa.Column("last_contacted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("bot_leads", sa.Column("trial_scheduled_for", sa.DateTime(timezone=True), nullable=True))
    op.add_column("bot_leads", sa.Column("trial_attended_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("bot_leads", sa.Column("lost_reason", sa.String(length=255), nullable=True))
    op.add_column("bot_leads", sa.Column("converted_member_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_bot_leads_converted_member", "bot_leads", "members", ["converted_member_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_bot_leads_next_follow_up_at", "bot_leads", ["next_follow_up_at"])
    op.create_index("ix_bot_leads_trial_scheduled_for", "bot_leads", ["trial_scheduled_for"])
    op.create_index("ix_bot_leads_converted_member_id", "bot_leads", ["converted_member_id"])

    op.create_table(
        "gym_cash_closes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("gym_id", sa.Integer(), sa.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("close_date", sa.Date(), nullable=False),
        sa.Column("expected_cash", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("counted_cash", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("variance", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("gym_id", "close_date", name="uq_cash_close_gym_date"),
    )
    op.create_index("ix_cash_close_gym_date", "gym_cash_closes", ["gym_id", "close_date"])
    op.create_index("ix_gym_cash_closes_gym_id", "gym_cash_closes", ["gym_id"])
    op.create_index("ix_gym_cash_closes_close_date", "gym_cash_closes", ["close_date"])


def downgrade():
    op.drop_table("gym_cash_closes")
    op.drop_index("ix_bot_leads_converted_member_id", table_name="bot_leads")
    op.drop_index("ix_bot_leads_trial_scheduled_for", table_name="bot_leads")
    op.drop_index("ix_bot_leads_next_follow_up_at", table_name="bot_leads")
    op.drop_constraint("fk_bot_leads_converted_member", "bot_leads", type_="foreignkey")
    op.drop_column("bot_leads", "converted_member_id")
    op.drop_column("bot_leads", "lost_reason")
    op.drop_column("bot_leads", "trial_attended_at")
    op.drop_column("bot_leads", "trial_scheduled_for")
    op.drop_column("bot_leads", "last_contacted_at")
    op.drop_column("bot_leads", "next_follow_up_at")
