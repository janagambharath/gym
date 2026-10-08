"""Add RRR Growth System integration, signals and attendance tables.

Revision ID: m2b4c6d8e0f1
Revises: l1a2b3c4d5e1
"""
from alembic import op
import sqlalchemy as sa


revision = "m2b4c6d8e0f1"
down_revision = "l1a2b3c4d5e1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("bridge_installations", sa.Column("connector_type", sa.String(32), nullable=False, server_default="direct_bridge"))
    op.add_column("bridge_installations", sa.Column("device_name", sa.String(160), nullable=True))
    op.create_index("ix_bridge_installations_connector_type", "bridge_installations", ["connector_type"])

    op.create_table(
        "rrr_integrations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("gym_id", sa.Integer(), sa.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("connector_type", sa.String(32), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="not_configured"),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("device_serial", sa.String(120), nullable=True),
        sa.Column("device_name", sa.String(160), nullable=True),
        sa.Column("pairing_code_hash", sa.String(64), nullable=True),
        sa.Column("pairing_code_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(500), nullable=True),
        sa.Column("records_synced", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unmapped_records", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("commissioning_status", sa.String(32), nullable=False, server_default="not_started"),
        sa.Column("commands_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("gym_id", "connector_type", name="uq_rrr_integration_type"),
        sa.UniqueConstraint("pairing_code_hash"),
    )
    op.create_index("ix_rrr_integrations_connector_type", "rrr_integrations", ["connector_type"])
    op.create_index("ix_rrr_integrations_status", "rrr_integrations", ["status"])
    op.create_index("ix_rrr_integrations_device_serial", "rrr_integrations", ["device_serial"])

    op.create_table(
        "rrr_identity_mappings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("gym_id", sa.Integer(), sa.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("member_id", sa.Integer(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("external_id", sa.String(120), nullable=False),
        sa.Column("source", sa.String(32), nullable=False, server_default="ebioserver"),
        sa.Column("status", sa.String(32), nullable=False, server_default="confirmed"),
        sa.Column("confirmed_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("gym_id", "external_id", name="uq_rrr_mapping_external"),
        sa.UniqueConstraint("gym_id", "member_id", "source", name="uq_rrr_mapping_member_source"),
    )

    op.create_table(
        "rrr_attendance_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("gym_id", sa.Integer(), sa.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("integration_id", sa.Integer(), sa.ForeignKey("rrr_integrations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("member_id", sa.Integer(), sa.ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("device_serial", sa.String(120), nullable=True),
        sa.Column("external_event_id", sa.String(160), nullable=True),
        sa.Column("biometric_user_id", sa.String(120), nullable=False),
        sa.Column("punch_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("direction", sa.String(16), nullable=True),
        sa.Column("verify_method", sa.String(32), nullable=True),
        sa.Column("dedupe_key", sa.String(64), nullable=False),
        sa.Column("processing_status", sa.String(32), nullable=False, server_default="processed"),
        sa.Column("raw_payload_hash", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("gym_id", "dedupe_key", name="uq_rrr_attendance_dedupe"),
    )
    op.create_index("ix_rrr_attendance_member_time", "rrr_attendance_events", ["gym_id", "member_id", "punch_time"])
    op.create_index("ix_rrr_attendance_unmapped", "rrr_attendance_events", ["gym_id", "member_id", "processing_status"])

    op.create_table(
        "rrr_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("gym_id", sa.Integer(), sa.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("rule_key", sa.String(64), nullable=False),
        sa.Column("value", sa.Integer(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("gym_id", "rule_key", name="uq_rrr_rule_key"),
    )

    op.create_table(
        "rrr_opportunities",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("gym_id", sa.Integer(), sa.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("member_id", sa.Integer(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("pillar", sa.String(16), nullable=False),
        sa.Column("reason_code", sa.String(64), nullable=False),
        sa.Column("reason_text", sa.Text(), nullable=False),
        sa.Column("priority", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("potential_revenue", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("outcome_revenue", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(24), nullable=False, server_default="open"),
        sa.Column("dedupe_key", sa.String(160), nullable=False),
        sa.Column("actioned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("gym_id", "dedupe_key", name="uq_rrr_opportunity_dedupe"),
    )
    op.create_index("ix_rrr_opportunity_pillar_status", "rrr_opportunities", ["gym_id", "pillar", "status"])

    op.create_table(
        "rrr_automation_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("gym_id", sa.Integer(), sa.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("member_id", sa.Integer(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("opportunity_id", sa.Integer(), sa.ForeignKey("rrr_opportunities.id", ondelete="SET NULL"), nullable=True),
        sa.Column("rule_key", sa.String(64), nullable=False),
        sa.Column("period_key", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="queued"),
        sa.Column("provider_message_id", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("gym_id", "rule_key", "member_id", "period_key", name="uq_rrr_automation_period"),
    )


def downgrade():
    for table in ("rrr_automation_runs", "rrr_opportunities", "rrr_rules", "rrr_attendance_events", "rrr_identity_mappings", "rrr_integrations"):
        op.drop_table(table)
    op.drop_index("ix_bridge_installations_connector_type", table_name="bridge_installations")
    op.drop_column("bridge_installations", "device_name")
    op.drop_column("bridge_installations", "connector_type")
