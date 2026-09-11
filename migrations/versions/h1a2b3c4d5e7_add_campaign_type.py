"""Add campaign_type and promo_preset columns to campaigns table.

Revision ID: h1a2b3c4d5e7
Revises: g1a2b3c4d5e6
Create Date: 2026-09-11
"""
from alembic import op
import sqlalchemy as sa


revision = "h1a2b3c4d5e7"
down_revision = "g1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "campaigns",
        sa.Column("campaign_type", sa.String(32), nullable=False, server_default="recovery"),
    )
    op.add_column(
        "campaigns",
        sa.Column("promo_preset", sa.String(64), nullable=True),
    )
    op.create_index("ix_campaigns_gym_type", "campaigns", ["gym_id", "campaign_type"])


def downgrade():
    op.drop_index("ix_campaigns_gym_type", table_name="campaigns")
    op.drop_column("campaigns", "promo_preset")
    op.drop_column("campaigns", "campaign_type")
