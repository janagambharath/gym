"""Add previous_plan_id / previous_price to renewal_history (V3-M18).

Lets _revert_renewal restore the member's plan and price on a refund
or delete, instead of leaving them on the renewed plan at the
refunded price. NULL on creation rows (no prior plan/price).

Revises: z8a9b0c1d2e3
"""
from alembic import op
import sqlalchemy as sa


revision = "v3m18a1b2c3d4"
down_revision = "z8a9b0c1d2e3"


def upgrade():
    from sqlalchemy import inspect

    conn = op.get_bind()
    inspector = inspect(conn)
    existing = {c["name"] for c in inspector.get_columns("renewal_history")}
    with op.batch_alter_table("renewal_history") as batch_op:
        if "previous_plan_id" not in existing:
            batch_op.add_column(
                sa.Column("previous_plan_id", sa.Integer(), nullable=True)
            )
        if "previous_price" not in existing:
            batch_op.add_column(
                sa.Column("previous_price", sa.Numeric(10, 2), nullable=True)
            )


def downgrade():
    # V4-L30: guard the drops with the same inspector check upgrade()
    # uses — a downgrade on a DB where the columns were never added
    # (or were already dropped) must not fail on a missing column.
    from sqlalchemy import inspect

    conn = op.get_bind()
    inspector = inspect(conn)
    existing = {c["name"] for c in inspector.get_columns("renewal_history")}
    with op.batch_alter_table("renewal_history") as batch_op:
        if "previous_price" in existing:
            batch_op.drop_column("previous_price")
        if "previous_plan_id" in existing:
            batch_op.drop_column("previous_plan_id")
