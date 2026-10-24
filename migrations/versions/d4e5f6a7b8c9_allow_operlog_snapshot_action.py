"""Allow OPERLOG snapshot rows in the direct ADMS command queue.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
"""
from alembic import op


revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


_NEW_ACTION_CHECK = (
    "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock', "
    "'create_user', 'delete_user', 'unlock_door', 'clear_log', 'reboot', 'check', "
    "'sync_users', 'restore_template', 'delete_biodata_test', "
    "'delete_fingertmp_test', 'operlog_snapshot')"
)
_OLD_ACTION_CHECK = (
    "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock', "
    "'create_user', 'delete_user', 'unlock_door', 'clear_log', 'reboot', 'check', "
    "'sync_users', 'restore_template', 'delete_biodata_test', 'delete_fingertmp_test')"
)


def upgrade():
    with op.batch_alter_table("rrr_adms_commands") as batch:
        batch.drop_constraint("ck_rrr_adms_command_action", type_="check")
        batch.create_check_constraint("ck_rrr_adms_command_action", _NEW_ACTION_CHECK)


def downgrade():
    # Remove snapshot-only rows before restoring the old constraint.
    op.execute(
        "DELETE FROM rrr_adms_commands WHERE action = 'operlog_snapshot'"
    )
    with op.batch_alter_table("rrr_adms_commands") as batch:
        batch.drop_constraint("ck_rrr_adms_command_action", type_="check")
        batch.create_check_constraint("ck_rrr_adms_command_action", _OLD_ACTION_CHECK)
