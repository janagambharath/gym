"""Add per-gym WhatsApp token, business ID, and template provisioning columns.

Revision ID: j1a2b3c4d5e9
Revises: i1a2b3c4d5e8
Create Date: 2026-09-19 15:30:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "j1a2b3c4d5e9"
down_revision = "i1a2b3c4d5e8"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("gyms", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("whatsapp_access_token_enc", sa.Text(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("whatsapp_meta_business_id", sa.String(length=255), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "whatsapp_templates_provisioned",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            )
        )


def downgrade():
    with op.batch_alter_table("gyms", schema=None) as batch_op:
        batch_op.drop_column("whatsapp_templates_provisioned")
        batch_op.drop_column("whatsapp_meta_business_id")
        batch_op.drop_column("whatsapp_access_token_enc")
