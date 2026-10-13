"""Add rrr_biometric_templates table for fingerprint backup/restore.

Revision ID: a1b2c3d4e5f6
Revises: a9b0c1d2e3f4
"""
from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "a9b0c1d2e3f4"


def upgrade():
    op.create_table(
        "rrr_biometric_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("integration_id", sa.Integer(), sa.ForeignKey("rrr_integrations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("enroll_number", sa.String(32), nullable=False),
        sa.Column("finger_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("template_data", sa.Text(), nullable=False),
        sa.Column("template_format", sa.String(32), nullable=False, server_default="unknown"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("gym_id", "integration_id", "enroll_number", "finger_id", name="uq_biometric_template"),
        sa.Index("ix_biometric_template_lookup", "gym_id", "integration_id", "enroll_number"),
    )
    # Expand the action check constraint to allow restore_template.
    with op.batch_alter_table("rrr_adms_commands") as batch_op:
        try:
            batch_op.drop_constraint("ck_rrr_adms_command_action", type_="check")
        except Exception:
            pass
        batch_op.create_check_constraint(
            "ck_rrr_adms_command_action",
            "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock', "
            "'create_user', 'delete_user', 'unlock_door', 'clear_log', 'reboot', 'check', "
            "'sync_users', 'restore_template')",
        )


def downgrade():
    with op.batch_alter_table("rrr_adms_commands") as batch_op:
        try:
            batch_op.drop_constraint("ck_rrr_adms_command_action", type_="check")
        except Exception:
            pass
        batch_op.create_check_constraint(
            "ck_rrr_adms_command_action",
            "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock', "
            "'create_user', 'delete_user', 'unlock_door', 'clear_log', 'reboot', 'check', "
            "'sync_users')",
        )
    op.drop_table("rrr_biometric_templates")
