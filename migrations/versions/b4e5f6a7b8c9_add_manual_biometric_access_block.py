"""Add a persistent manual biometric access block.

Revision ID: b4e5f6a7b8c9
Revises: a3c4d5e6f7a8
Create Date: 2026-08-13 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "b4e5f6a7b8c9"
down_revision = "a3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("members") as batch_op:
        batch_op.add_column(
            sa.Column(
                "biometric_access_blocked",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )

    # Existing members must begin in their present membership-controlled
    # state. Future inserts get the ORM default declared on Member.
    with op.batch_alter_table("members") as batch_op:
        batch_op.alter_column("biometric_access_blocked", server_default=None)


def downgrade():
    with op.batch_alter_table("members") as batch_op:
        batch_op.drop_column("biometric_access_blocked")
