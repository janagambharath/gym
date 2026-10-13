"""Add advanced bridge command columns (delay_seconds, valid_from, valid_to) and expand command_type constraint.

Revises: x6y7z8a9b0c1
"""
from alembic import op
import sqlalchemy as sa

revision = "y7z8a9b0c1d2"
down_revision = "x6y7z8a9b0c1"


def upgrade():
    with op.batch_alter_table("bridge_commands") as batch_op:
        batch_op.add_column(sa.Column("delay_seconds", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("valid_from", sa.String(10), nullable=True))
        batch_op.add_column(sa.Column("valid_to", sa.String(10), nullable=True))
        try:
            batch_op.drop_constraint("ck_bridge_commands_type", type_="check")
        except Exception:
            pass
        batch_op.create_check_constraint(
            "ck_bridge_commands_type",
            "command_type IN ('enable_user', 'disable_user', 'create_user', "
            "'delete_user', 'unlock_door', 'set_valid_date', 'sync_users', "
            "'device_info', 'restart', 'clear_log')",
        )


def downgrade():
    with op.batch_alter_table("bridge_commands") as batch_op:
        try:
            batch_op.drop_constraint("ck_bridge_commands_type", type_="check")
        except Exception:
            pass
        batch_op.create_check_constraint(
            "ck_bridge_commands_type",
            "command_type IN ('enable_user', 'disable_user')",
        )
        batch_op.drop_column("valid_to")
        batch_op.drop_column("valid_from")
        batch_op.drop_column("delay_seconds")
