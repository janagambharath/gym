"""Add secure online biometric bridge state.

Revision ID: a3c4d5e6f7a8
Revises: f2a1b3c4d5e7
Create Date: 2026-08-09 19:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "a3c4d5e6f7a8"
down_revision = "f2a1b3c4d5e7"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("members") as batch_op:
        batch_op.add_column(sa.Column("device_enroll_number", sa.String(length=32), nullable=True))
        batch_op.create_unique_constraint(
            "uq_members_gym_device_enroll", ["gym_id", "device_enroll_number"]
        )

    op.create_table(
        "bridge_installations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("api_key_hash", sa.String(length=64), nullable=False),
        sa.Column("device_serial", sa.String(length=120), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gym_id"),
        sa.UniqueConstraint("public_id"),
        sa.UniqueConstraint("api_key_hash"),
        sa.UniqueConstraint("device_serial"),
    )
    op.create_index("ix_bridge_installations_gym_id", "bridge_installations", ["gym_id"])
    op.create_index("ix_bridge_installations_public_id", "bridge_installations", ["public_id"])
    op.create_index("ix_bridge_installations_api_key_hash", "bridge_installations", ["api_key_hash"])
    op.create_index("ix_bridge_installations_device_serial", "bridge_installations", ["device_serial"])
    op.create_index("ix_bridge_installations_is_active", "bridge_installations", ["is_active"])

    op.create_table(
        "bridge_commands",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("bridge_id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("member_id", sa.Integer(), nullable=True),
        sa.Column("command_type", sa.String(length=32), nullable=False),
        sa.Column("enroll_number", sa.String(length=32), nullable=False),
        sa.Column("member_name", sa.String(length=160), nullable=True),
        sa.Column("delay_seconds", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("delivery_attempts", sa.Integer(), nullable=False),
        sa.Column("retry_attempt", sa.Integer(), nullable=False),
        sa.Column("not_before", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_token", sa.String(length=64), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "command_type IN ('enable_user', 'disable_user')", name="ck_bridge_commands_type"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'leased', 'acked', 'failed')", name="ck_bridge_commands_status"
        ),
        sa.ForeignKeyConstraint(["bridge_id"], ["bridge_installations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bridge_commands_bridge_id", "bridge_commands", ["bridge_id"])
    op.create_index("ix_bridge_commands_gym_id", "bridge_commands", ["gym_id"])
    op.create_index("ix_bridge_commands_member_id", "bridge_commands", ["member_id"])
    op.create_index("ix_bridge_commands_status", "bridge_commands", ["status"])
    op.create_index("ix_bridge_commands_not_before", "bridge_commands", ["not_before"])
    op.create_index("ix_bridge_commands_lease_token", "bridge_commands", ["lease_token"])
    op.create_index("ix_bridge_commands_lease_expires_at", "bridge_commands", ["lease_expires_at"])
    op.create_index(
        "ix_bridge_commands_ready",
        "bridge_commands",
        ["bridge_id", "status", "not_before", "lease_expires_at", "created_at"],
    )
    op.create_index(
        "ix_bridge_commands_member", "bridge_commands", ["gym_id", "member_id", "created_at"]
    )

    op.create_table(
        "bridge_attendance",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("bridge_id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("member_id", sa.Integer(), nullable=True),
        sa.Column("event_id", sa.String(length=128), nullable=False),
        sa.Column("device_enroll_number", sa.String(length=32), nullable=False),
        sa.Column("event_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("verify_method", sa.Integer(), nullable=False),
        sa.Column("is_invalid", sa.Boolean(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["bridge_id"], ["bridge_installations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("bridge_id", "event_id", name="uq_bridge_attendance_event"),
    )
    op.create_index("ix_bridge_attendance_bridge_id", "bridge_attendance", ["bridge_id"])
    op.create_index("ix_bridge_attendance_gym_id", "bridge_attendance", ["gym_id"])
    op.create_index("ix_bridge_attendance_member_id", "bridge_attendance", ["member_id"])
    op.create_index(
        "ix_bridge_attendance_gym_time", "bridge_attendance", ["gym_id", "event_time"]
    )


def downgrade():
    op.drop_index("ix_bridge_attendance_gym_time", table_name="bridge_attendance")
    op.drop_index("ix_bridge_attendance_member_id", table_name="bridge_attendance")
    op.drop_index("ix_bridge_attendance_gym_id", table_name="bridge_attendance")
    op.drop_index("ix_bridge_attendance_bridge_id", table_name="bridge_attendance")
    op.drop_table("bridge_attendance")

    op.drop_index("ix_bridge_commands_member", table_name="bridge_commands")
    op.drop_index("ix_bridge_commands_ready", table_name="bridge_commands")
    op.drop_index("ix_bridge_commands_lease_expires_at", table_name="bridge_commands")
    op.drop_index("ix_bridge_commands_lease_token", table_name="bridge_commands")
    op.drop_index("ix_bridge_commands_not_before", table_name="bridge_commands")
    op.drop_index("ix_bridge_commands_status", table_name="bridge_commands")
    op.drop_index("ix_bridge_commands_member_id", table_name="bridge_commands")
    op.drop_index("ix_bridge_commands_gym_id", table_name="bridge_commands")
    op.drop_index("ix_bridge_commands_bridge_id", table_name="bridge_commands")
    op.drop_table("bridge_commands")

    op.drop_index("ix_bridge_installations_is_active", table_name="bridge_installations")
    op.drop_index("ix_bridge_installations_api_key_hash", table_name="bridge_installations")
    op.drop_index("ix_bridge_installations_device_serial", table_name="bridge_installations")
    op.drop_index("ix_bridge_installations_public_id", table_name="bridge_installations")
    op.drop_index("ix_bridge_installations_gym_id", table_name="bridge_installations")
    op.drop_table("bridge_installations")

    with op.batch_alter_table("members") as batch_op:
        batch_op.drop_constraint("uq_members_gym_device_enroll", type_="unique")
        batch_op.drop_column("device_enroll_number")
