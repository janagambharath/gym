"""Add direct ADMS commissioning command queue.

Revision ID: p5e7f9a1b3c4
Revises: o4d6e8f0a2b3
"""
from alembic import op
import sqlalchemy as sa


revision = "p5e7f9a1b3c4"
down_revision = "o4d6e8f0a2b3"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "rrr_adms_commands",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("gym_id", sa.Integer(), sa.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("integration_id", sa.Integer(), sa.ForeignKey("rrr_integrations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("test_enroll_number", sa.String(length=32), nullable=True),
        sa.Column("command_text", sa.Text(), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_code", sa.String(length=32), nullable=True),
        sa.Column("result_message", sa.String(length=500), nullable=True),
        sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("action IN ('probe_info', 'block_test', 'unblock_test')", name="ck_rrr_adms_command_action"),
        sa.CheckConstraint("status IN ('queued', 'delivered', 'acked', 'failed')", name="ck_rrr_adms_command_status"),
    )
    op.create_index("ix_rrr_adms_command_device_status", "rrr_adms_commands", ["integration_id", "status", "id"])
    op.create_index("ix_rrr_adms_commands_gym_id", "rrr_adms_commands", ["gym_id"])
    op.create_index("ix_rrr_adms_commands_integration_id", "rrr_adms_commands", ["integration_id"])
    op.create_index("ix_rrr_adms_commands_status", "rrr_adms_commands", ["status"])


def downgrade():
    op.drop_table("rrr_adms_commands")
