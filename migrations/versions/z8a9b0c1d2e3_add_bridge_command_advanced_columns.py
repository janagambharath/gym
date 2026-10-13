"""Add advanced bridge command columns (delay_seconds, valid_from, valid_to) and expand command_type constraint.

Revises: y7z8a9b0c1d2
"""
from alembic import op
import sqlalchemy as sa

revision = "z8a9b0c1d2e3"
down_revision = "y7z8a9b0c1d2"


def upgrade():
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    existing = {c["name"] for c in inspector.get_columns("bridge_commands")}
    with op.batch_alter_table("bridge_commands") as batch_op:
        if "delay_seconds" not in existing:
            batch_op.add_column(sa.Column("delay_seconds", sa.Integer(), nullable=True))
        if "valid_from" not in existing:
            batch_op.add_column(sa.Column("valid_from", sa.String(10), nullable=True))
        if "valid_to" not in existing:
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
