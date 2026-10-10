"""Allow automatic block/unblock actions on the ADMS command queue.

Revision ID: r7f9g0a1b2c3d
Revises: q6e8f0a2b4c5
"""
from alembic import op
import sqlalchemy as sa


revision = "r7f9g0a1b2c3d"
down_revision = "q6e8f0a2b4c5"
branch_labels = None
depends_on = None


_NEW_CHECK = "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock')"
_OLD_CHECK = "action IN ('probe_info', 'block_test', 'unblock_test')"


def upgrade():
    with op.batch_alter_table("rrr_adms_commands") as batch:
        batch.drop_constraint("ck_rrr_adms_command_action", type_="check")
        batch.create_check_constraint("ck_rrr_adms_command_action", _NEW_CHECK)


def downgrade():
    with op.batch_alter_table("rrr_adms_commands") as batch:
        batch.drop_constraint("ck_rrr_adms_command_action", type_="check")
        batch.create_check_constraint("ck_rrr_adms_command_action", _OLD_CHECK)
