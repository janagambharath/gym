"""Add sanitized eBioServer device inventory for owner selection.

Revision ID: n3c5d7e9f1a2
Revises: m2b4c6d8e0f1
"""
from alembic import op
import sqlalchemy as sa


revision = "n3c5d7e9f1a2"
down_revision = "m2b4c6d8e0f1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "rrr_devices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("gym_id", sa.Integer(), sa.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("integration_id", sa.Integer(), sa.ForeignKey("rrr_integrations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("serial_number", sa.String(120), nullable=False),
        sa.Column("device_name", sa.String(160), nullable=False, server_default="eSSL device"),
        sa.Column("status", sa.String(32), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_selected", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("gym_id", "serial_number", name="uq_rrr_device_serial"),
    )
    op.create_index("ix_rrr_devices_integration_id", "rrr_devices", ["integration_id"])


def downgrade():
    op.drop_index("ix_rrr_devices_integration_id", table_name="rrr_devices")
    op.drop_table("rrr_devices")
