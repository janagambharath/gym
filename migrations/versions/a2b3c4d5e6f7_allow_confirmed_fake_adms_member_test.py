"""Allow explicitly confirmed fake member IDs in eSSL Group tests.

Revision ID: a2b3c4d5e6f7
Revises: f8a1d2c3d4e5
"""
from alembic import op
import sqlalchemy as sa


revision = "a2b3c4d5e6f7"
down_revision = "f8a1d2c3d4e5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "rrr_adms_commands",
        sa.Column("test_member_id", sa.Integer(), nullable=True),
    )


def downgrade():
    op.drop_column("rrr_adms_commands", "test_member_id")
