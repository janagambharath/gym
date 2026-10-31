"""Allow the owner-only eSSL group block/unblock test actions.

Revision ID: f8a1d2c3d4e5
Revises: d4e5f6a7b8c9
"""
from alembic import op
import sqlalchemy as sa


revision = "f8a1d2c3d4e5"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


_OLD_ACTION_CHECK = (
    "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock', "
    "'create_user', 'delete_user', 'unlock_door', 'clear_log', 'reboot', 'check', "
    "'sync_users', 'restore_template', 'delete_biodata_test', "
    "'delete_fingertmp_test', 'operlog_snapshot')"
)
_NEW_ACTION_CHECK = (
    "action IN ('probe_info', 'block_test', 'unblock_test', 'essl_group_block_test', "
    "'essl_group_unblock_test', 'block', 'unblock', 'create_user', 'delete_user', "
    "'unlock_door', 'clear_log', 'reboot', 'check', 'sync_users', 'restore_template', "
    "'delete_biodata_test', 'delete_fingertmp_test', 'operlog_snapshot')"
)


def upgrade():
    with op.batch_alter_table("rrr_adms_commands") as batch:
        batch.drop_constraint("ck_rrr_adms_command_action", type_="check")
        batch.create_check_constraint("ck_rrr_adms_command_action", _NEW_ACTION_CHECK)


def downgrade():
    bind = op.get_bind()
    test_rows = bind.execute(
        sa.text(
            "SELECT COUNT(*) FROM rrr_adms_commands "
            "WHERE action IN ('essl_group_block_test', 'essl_group_unblock_test')"
        )
    ).scalar_one()
    if test_rows:
        raise RuntimeError(
            "Cannot remove eSSL group-test actions while their command history exists."
        )
    with op.batch_alter_table("rrr_adms_commands") as batch:
        batch.drop_constraint("ck_rrr_adms_command_action", type_="check")
        batch.create_check_constraint("ck_rrr_adms_command_action", _OLD_ACTION_CHECK)
