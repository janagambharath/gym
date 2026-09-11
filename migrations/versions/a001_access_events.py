"""Add access events and member access state tables

Revision ID: a001_access_events
Revises: None (auto-detected by Alembic)
"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime, timezone


# revision identifiers
revision = "a001_access_events"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # 1. Add att_state column to existing bridge_attendance table
    with op.batch_alter_table("bridge_attendance") as batch_op:
        batch_op.add_column(sa.Column("att_state", sa.Integer(), nullable=True))

    # 2. Create access_events table
    op.create_table(
        "access_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("member_id", sa.Integer(), nullable=True),
        sa.Column("bridge_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("direction", sa.String(length=16), nullable=False, server_default="UNKNOWN"),
        sa.Column("event_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("device_enroll_number", sa.String(length=32), nullable=False),
        sa.Column("source_event_id", sa.String(length=128), nullable=False),
        sa.Column("att_state", sa.Integer(), nullable=True),
        sa.Column("verify_method", sa.Integer(), nullable=True),
        sa.Column("is_invalid", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("member_name", sa.String(length=160), nullable=True),
        sa.Column("membership_status", sa.String(length=32), nullable=True),
        sa.Column("device_name", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["bridge_id"], ["bridge_installations.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_access_events_gym_id", "access_events", ["gym_id"])
    op.create_index("ix_access_events_member_id", "access_events", ["member_id"])
    op.create_index("ix_access_events_bridge_id", "access_events", ["bridge_id"])
    op.create_index("ix_access_events_event_type", "access_events", ["event_type"])
    op.create_index("ix_access_events_gym_time", "access_events", ["gym_id", "event_timestamp"])
    op.create_index("ix_access_events_gym_member_time", "access_events", ["gym_id", "member_id", "event_timestamp"])
    op.create_index("ix_access_events_gym_type_time", "access_events", ["gym_id", "event_type", "event_timestamp"])
    op.create_unique_constraint("uq_access_events_source", "access_events", ["gym_id", "source_event_id"])

    # 3. Create member_access_states table
    op.create_table(
        "member_access_states",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("member_id", sa.Integer(), nullable=False),
        sa.Column("current_state", sa.String(length=16), nullable=False, server_default="UNKNOWN"),
        sa.Column("last_event_id", sa.Integer(), nullable=True),
        sa.Column("last_event_timestamp", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_entry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_exit_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["last_event_id"], ["access_events.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_member_access_state_gym_id", "member_access_states", ["gym_id"])
    op.create_index("ix_member_access_state_member_id", "member_access_states", ["member_id"])
    op.create_index("ix_member_access_state_gym_state", "member_access_states", ["gym_id", "current_state"])
    op.create_unique_constraint("uq_member_access_state_gym_member", "member_access_states", ["gym_id", "member_id"])


def downgrade():
    op.drop_table("member_access_states")
    op.drop_table("access_events")
    with op.batch_alter_table("bridge_attendance") as batch_op:
        batch_op.drop_column("att_state")
