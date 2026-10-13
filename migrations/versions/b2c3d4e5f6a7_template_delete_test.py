"""Allow template-delete test actions on ADMS command queue.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
"""
from alembic import op
import sqlalchemy as sa

revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"

_NEW_CHECK = (
    "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock', "
    "'create_user', 'delete_user', 'unlock_door', 'clear_log', 'reboot', 'check', "
    "'sync_users', 'restore_template', 'delete_biodata_test', 'delete_fingertmp_test')"
)
_OLD_CHECK = (
    "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock', "
    "'create_user', 'delete_user', 'unlock_door', 'clear_log', 'reboot', 'check', "
    "'sync_users', 'restore_template')"
)


def upgrade():
    with op.batch_alter_table("rrr_adms_commands") as batch:
        batch.drop_constraint("ck_rrr_adms_command_action", type_="check")
        batch.create_check_constraint("ck_rrr_adms_command_action", _NEW_CHECK)


def downgrade():
    with op.batch_alter_table("rrr_adms_commands") as batch:
        batch.drop_constraint("ck_rrr_adms_command_action", type_="check")
        batch.create_check_constraint("ck_rrr_adms_command_action", _OLD_CHECK)
