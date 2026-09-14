"""Add custom pricing, channel, and plan_id to payment_verifications and renewal_history.

Revision ID: i1a2b3c4d5e8
Revises: h1a2b3c4d5e7
Create Date: 2026-09-14
"""
from alembic import op
import sqlalchemy as sa


revision = "i1a2b3c4d5e8"
down_revision = "h1a2b3c4d5e7"
branch_labels = None
depends_on = None


def upgrade():
    # payment_verifications
    op.add_column(
        "payment_verifications",
        sa.Column("plan_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "payment_verifications",
        sa.Column("created_by_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "payment_verifications",
        sa.Column("standard_price", sa.Numeric(10, 2), nullable=True),
    )
    op.add_column(
        "payment_verifications",
        sa.Column("discount", sa.Numeric(10, 2), nullable=False, server_default="0.00"),
    )
    op.add_column(
        "payment_verifications",
        sa.Column("channel", sa.String(32), nullable=False, server_default="offline"),
    )

    # renewal_history
    op.add_column(
        "renewal_history",
        sa.Column("standard_price", sa.Numeric(10, 2), nullable=True),
    )
    op.add_column(
        "renewal_history",
        sa.Column("discount", sa.Numeric(10, 2), nullable=False, server_default="0.00"),
    )
    op.add_column(
        "renewal_history",
        sa.Column("channel", sa.String(32), nullable=False, server_default="offline"),
    )


def downgrade():
    op.drop_column("renewal_history", "channel")
    op.drop_column("renewal_history", "discount")
    op.drop_column("renewal_history", "standard_price")

    op.drop_column("payment_verifications", "channel")
    op.drop_column("payment_verifications", "discount")
    op.drop_column("payment_verifications", "standard_price")
    op.drop_column("payment_verifications", "created_by_id")
    op.drop_column("payment_verifications", "plan_id")
