"""Persist the owner-selected renewal start date on payments.

Revision ID: b9c1d4e6f8a0
Revises: a2b3c4d5e6f7, c8d4e6a1f203, e7f8a9b0c1d2
"""
from alembic import op
import sqlalchemy as sa


revision = "b9c1d4e6f8a0"
down_revision = ("a2b3c4d5e6f7", "c8d4e6a1f203", "e7f8a9b0c1d2")
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "payment_verifications",
        sa.Column("renewal_start_date", sa.Date(), nullable=True),
    )


def downgrade():
    op.drop_column("payment_verifications", "renewal_start_date")
