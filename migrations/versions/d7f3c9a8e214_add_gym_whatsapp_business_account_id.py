"""Add per-gym WhatsApp Business Account ID

Revision ID: d7f3c9a8e214
Revises: c4e7a1b2d903
Create Date: 2026-05-31 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "d7f3c9a8e214"
down_revision = "c4e7a1b2d903"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("gyms") as batch_op:
        batch_op.add_column(
            sa.Column("whatsapp_business_account_id", sa.String(length=255), nullable=True)
        )
        batch_op.create_index(
            "ix_gyms_whatsapp_business_account_id",
            ["whatsapp_business_account_id"],
            unique=False,
        )


def downgrade():
    with op.batch_alter_table("gyms") as batch_op:
        batch_op.drop_index("ix_gyms_whatsapp_business_account_id")
        batch_op.drop_column("whatsapp_business_account_id")
