"""Add is_test column to payment_verifications and renewal_history.

Revision ID: 5d6e7f8a9b0c
Revises: 4c5d6e7f8a9b
Create Date: 2026-08-26 19:48:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "5d6e7f8a9b0c"
down_revision = "4c5d6e7f8a9b"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("payment_verifications") as batch_op:
        batch_op.add_column(
            sa.Column("is_test", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.create_index("ix_payment_verifications_is_test", ["is_test"], unique=False)

    with op.batch_alter_table("renewal_history") as batch_op:
        batch_op.add_column(
            sa.Column("is_test", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.create_index("ix_renewal_history_is_test", ["is_test"], unique=False)


def downgrade():
    with op.batch_alter_table("renewal_history") as batch_op:
        batch_op.drop_index("ix_renewal_history_is_test")
        batch_op.drop_column("is_test")

    with op.batch_alter_table("payment_verifications") as batch_op:
        batch_op.drop_index("ix_payment_verifications_is_test")
        batch_op.drop_column("is_test")
