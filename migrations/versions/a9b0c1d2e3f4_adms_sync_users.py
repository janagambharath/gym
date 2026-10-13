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
    # Idempotent: the column may already exist from a previous partial run
    # (the old duplicate migration applied it before being removed).
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing = {c["name"] for c in inspector.get_columns("rrr_adms_commands")}
    if "result_data" not in existing:
        op.add_column(
            "rrr_adms_commands",
            sa.Column("result_data", sa.Text(), nullable=True),
        )
    # Idempotent constraint update: only if sync_users isn't already allowed.
    # We drop/recreate unconditionally inside a savepoint-safe block because
    # the constraint name is fixed; if the drop fails the constraint didn't exist.
    try:
        op.drop_constraint("ck_rrr_adms_command_action", "rrr_adms_commands", type_="check")
    except Exception:
        pass
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
