"""Add renewal_history.previous_start for correct membership rollback.

Revises: s1t2u3v4w5x6
"""
from alembic import op
import sqlalchemy as sa

revision = "t7v8w9x0y1z2"
down_revision = "s1t2u3v4w5x6"


def upgrade():
    op.add_column(
        "renewal_history",
        sa.Column("previous_start", sa.Date(), nullable=True),
    )
    op.add_column(
        "members",
        sa.Column("price", sa.Numeric(10, 2), nullable=False, server_default="0.00"),
    )
    # Backfill the pinned renewal value for existing members from their plan.
    # Members without a plan keep 0 and are counted with amount 0.
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE members SET price = plans.price "
            "FROM membership_plans AS plans "
            "WHERE members.plan_id = plans.id "
            "AND (members.price IS NULL OR members.price = 0)"
        )
    )


def downgrade():
    op.drop_column("members", "price")
    op.drop_column("renewal_history", "previous_start")
