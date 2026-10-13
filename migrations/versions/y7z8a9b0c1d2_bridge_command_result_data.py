"""Add result_data to bridge_commands for sync_users terminal snapshots.

Revises: x6y7z8a9b0c1
"""
from alembic import op
import sqlalchemy as sa


revision = "y7z8a9b0c1d2"
down_revision = "x6y7z8a9b0c1"


def upgrade():
    op.add_column(
        "bridge_commands",
        sa.Column("result_data", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("bridge_commands", "result_data")
