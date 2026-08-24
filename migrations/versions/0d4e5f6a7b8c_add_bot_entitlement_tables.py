"""Add WhatsApp bot and feature-entitlement tables.

Revision ID: 0d4e5f6a7b8c
Revises: 8623a65211ec
Create Date: 2026-08-24 00:00:00.000000

This migration is intentionally forward-only metadata. Deployments must run
their normal reviewed Alembic workflow; importing the application never runs
this migration automatically.
"""

from alembic import op
import sqlalchemy as sa


revision = "0d4e5f6a7b8c"
down_revision = "8623a65211ec"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "feature_entitlements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("feature", sa.String(length=64), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gym_id", "feature", name="uq_entitlement_gym_feature"),
    )
    op.create_index(
        "ix_feature_entitlements_gym_id", "feature_entitlements", ["gym_id"], unique=False
    )
    op.create_index(
        "ix_feature_entitlements_feature", "feature_entitlements", ["feature"], unique=False
    )

    op.create_table(
        "gym_bot_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("greeting_message", sa.Text(), nullable=True),
        sa.Column("opening_hours", sa.Text(), nullable=True),
        sa.Column("map_link", sa.String(length=512), nullable=True),
        sa.Column("trial_enabled", sa.Boolean(), nullable=False),
        sa.Column("trial_price", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("trial_duration_days", sa.Integer(), nullable=True),
        sa.Column("registration_link", sa.String(length=512), nullable=True),
        sa.Column("payment_link", sa.String(length=512), nullable=True),
        sa.Column("followup_enabled", sa.Boolean(), nullable=False),
        sa.Column("followup_delay_hours", sa.Integer(), nullable=False),
        sa.Column("max_followups", sa.Integer(), nullable=False),
        sa.Column("handover_enabled", sa.Boolean(), nullable=False),
        sa.Column("handover_staff_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["handover_staff_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gym_id", name="uq_gym_bot_configs_gym_id"),
    )
    op.create_index("ix_gym_bot_configs_gym_id", "gym_bot_configs", ["gym_id"], unique=False)

    op.create_table(
        "bot_faqs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bot_faqs_gym_id", "bot_faqs", ["gym_id"], unique=False)

    op.create_table(
        "bot_knowledge_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_bot_knowledge_items_gym_id", "bot_knowledge_items", ["gym_id"], unique=False
    )

    op.create_table(
        "bot_conversations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("phone", sa.String(length=40), nullable=False),
        sa.Column("customer_name", sa.String(length=160), nullable=True),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("handover_status", sa.String(length=32), nullable=False),
        sa.Column("active_staff_id", sa.Integer(), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["active_staff_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gym_id", "phone", name="uq_conversation_gym_phone"),
    )
    op.create_index("ix_bot_conversations_gym_id", "bot_conversations", ["gym_id"], unique=False)
    op.create_index("ix_bot_conversations_phone", "bot_conversations", ["phone"], unique=False)

    op.create_table(
        "bot_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("sender", sa.String(length=16), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("provider_message_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["conversation_id"], ["bot_conversations.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_message_id", name="uq_bot_messages_provider_message_id"),
    )
    op.create_index(
        "ix_bot_messages_conversation_id", "bot_messages", ["conversation_id"], unique=False
    )

    op.create_table(
        "bot_leads",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=160), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("intent", sa.String(length=128), nullable=True),
        sa.Column("interested_plan", sa.String(length=160), nullable=True),
        sa.Column("trial_requested", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("assigned_staff_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["conversation_id"], ["bot_conversations.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["assigned_staff_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bot_leads_gym_id", "bot_leads", ["gym_id"], unique=False)
    op.create_index(
        "ix_bot_leads_conversation_id", "bot_leads", ["conversation_id"], unique=False
    )
    op.create_index("ix_bot_leads_phone", "bot_leads", ["phone"], unique=False)
    op.create_index("ix_bot_leads_status", "bot_leads", ["status"], unique=False)

    op.create_table(
        "bot_followups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lead_id", sa.Integer(), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["lead_id"], ["bot_leads.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bot_followups_lead_id", "bot_followups", ["lead_id"], unique=False)

    op.create_table(
        "bot_booking_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("lead_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=160), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=False),
        sa.Column("preferred_date", sa.Date(), nullable=True),
        sa.Column("preferred_time", sa.String(length=64), nullable=True),
        sa.Column("intent", sa.String(length=128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lead_id"], ["bot_leads.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_bot_booking_requests_gym_id", "bot_booking_requests", ["gym_id"], unique=False
    )

    op.create_table(
        "bot_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=True),
        sa.Column("lead_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("provider_message_id", sa.String(length=128), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["conversation_id"], ["bot_conversations.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["lead_id"], ["bot_leads.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bot_events_gym_id", "bot_events", ["gym_id"], unique=False)
    op.create_index(
        "ix_bot_events_conversation_id", "bot_events", ["conversation_id"], unique=False
    )
    op.create_index("ix_bot_events_lead_id", "bot_events", ["lead_id"], unique=False)
    op.create_index("ix_bot_events_event_type", "bot_events", ["event_type"], unique=False)
    op.create_index(
        "ix_bot_events_provider_message_id", "bot_events", ["provider_message_id"], unique=False
    )


def downgrade():
    # Drop child tables before their conversation/lead parents.
    op.drop_table("bot_events")
    op.drop_table("bot_booking_requests")
    op.drop_table("bot_followups")
    op.drop_table("bot_leads")
    op.drop_table("bot_messages")
    op.drop_table("bot_conversations")
    op.drop_table("bot_knowledge_items")
    op.drop_table("bot_faqs")
    op.drop_table("gym_bot_configs")
    op.drop_table("feature_entitlements")
