"""Allow 'operlog_snapshot' in ck_rrr_adms_command_action.

Revision ID: 16912c2a3121
Revises: b87640da5a46 (merge of b1c2d3e4f5a6 + c3d4e5f6a7b8)

Fixes finding M1: app/services/enroll_match_service.py
upsert_terminal_snapshot() stores OPERLOG enrollments as an
RRRAdmsCommand with action='operlog_snapshot', but the CHECK allowed
only 15 actions and no migration added the 16th, so every OPERLOG
enrollment POST failed at flush/commit and poisoned the cdata commit
(and get_adms_snapshot() never saw OPERLOG users). The model
(app/models/rrr.py) is updated in the same change.

Snapshot rows are inert: they are created with status='acked', and
getrequest only serves queued/delivered rows, so they can never be
served to a terminal. The fail-safe disable guard is untouched.

DEPLOY NOTE — determine production's head BEFORE deploying (the
coordinator runs this; this migration itself needs no choice, because
its down_revision is the merge above, but the pre-deploy check catches
a production DB that has drifted outside this graph):

1. Query production's alembic_version table, e.g. via psql on the
   Railway DATABASE_URL (never from a checkout's local DB):
       SELECT version_num FROM alembic_version ORDER BY version_num;
   Expected: one or both of b1c2d3e4f5a6 and c3d4e5f6a7b8 (Railway's
   release phase runs `flask db upgrade heads`, so both rows is a
   normal outcome). If version_num holds anything else — or a
   revision not present in migrations/versions/ — STOP and report it;
   do not force-deploy.
2. In this branch, `alembic heads` / `flask db heads` must print
   exactly one head: 16912c2a3121.
3. After deploy, alembic_version must hold exactly one row,
   16912c2a3121, and the app /health check must pass.

Downgrade note: downgrading fails on PostgreSQL if any
operlog_snapshot rows exist (the restored CHECK would reject them).
That is the same behaviour as the repo's earlier CHECK migrations;
delete such rows first if a downgrade is ever genuinely required.
"""

from alembic import op
import sqlalchemy as sa


revision = "16912c2a3121"
down_revision = "b87640da5a46"
branch_labels = None
depends_on = None

_NEW_CHECK = (
    "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock', "
    "'create_user', 'delete_user', 'unlock_door', 'clear_log', 'reboot', 'check', "
    "'sync_users', 'restore_template', 'delete_biodata_test', 'delete_fingertmp_test', "
    "'operlog_snapshot')"
)
_OLD_CHECK = (
    "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock', "
    "'create_user', 'delete_user', 'unlock_door', 'clear_log', 'reboot', 'check', "
    "'sync_users', 'restore_template', 'delete_biodata_test', 'delete_fingertmp_test')"
)


def upgrade():
    with op.batch_alter_table("rrr_adms_commands") as batch:
        batch.drop_constraint("ck_rrr_adms_command_action", type_="check")
        batch.create_check_constraint("ck_rrr_adms_command_action", _NEW_CHECK)


def downgrade():
    with op.batch_alter_table("rrr_adms_commands") as batch:
        batch.drop_constraint("ck_rrr_adms_command_action", type_="check")
        batch.create_check_constraint("ck_rrr_adms_command_action", _OLD_CHECK)
