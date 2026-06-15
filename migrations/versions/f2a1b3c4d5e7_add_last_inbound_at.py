"""Add last_inbound_at to members for WhatsApp session tracking

Revision ID: f2a1b3c4d5e7
Revises: e1a2b3c4d5e6
Create Date: 2026-06-15 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "f2a1b3c4d5e7"
down_revision = "e1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("members") as batch_op:
        batch_op.add_column(
            sa.Column("last_inbound_at", sa.DateTime(timezone=True), nullable=True)
        )

    op.execute(
        """
        UPDATE members
        SET last_inbound_at = whatsapp_opted_in_at
        WHERE whatsapp_opted_in = true AND whatsapp_opted_in_at IS NOT NULL
        """
    )


def downgrade():
    with op.batch_alter_table("members") as batch_op:
        batch_op.drop_column("last_inbound_at")
