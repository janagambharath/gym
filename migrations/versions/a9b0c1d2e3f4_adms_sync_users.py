"""ADMS sync_users: pull terminal user list via DATA QUERY.

- Adds result_data to rrr_adms_commands (stores USERINFO table snapshot).
- Extends ck_rrr_adms_command_action with 'sync_users'.

Revises: z8a9b0c1d2e3
"""
from alembic import op
import sqlalchemy as sa


revision = "a9b0c1d2e3f4"
down_revision = "z8a9b0c1d2e3"


def upgrade():
    op.add_column(
        "rrr_adms_commands",
        sa.Column("result_data", sa.Text(), nullable=True),
    )
    op.drop_constraint("ck_rrr_adms_command_action", "rrr_adms_commands", type_="check")
    op.create_check_constraint(
        "ck_rrr_adms_command_action",
        "rrr_adms_commands",
        "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock', "
        "'create_user', 'delete_user', 'unlock_door', 'clear_log', 'reboot', 'check', "
        "'sync_users')",
    )


def downgrade():
    op.drop_constraint("ck_rrr_adms_command_action", "rrr_adms_commands", type_="check")
    op.create_check_constraint(
        "ck_rrr_adms_command_action",
        "rrr_adms_commands",
        "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock', "
        "'create_user', 'delete_user', 'unlock_door', 'clear_log', 'reboot', 'check')",
    )
    op.drop_column("rrr_adms_commands", "result_data")
