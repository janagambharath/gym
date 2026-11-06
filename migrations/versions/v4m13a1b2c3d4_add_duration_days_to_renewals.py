"""Add duration_days snapshot to renewal_history (V4-M13).

Date Repair measured oversized renewals against the plan's LIVE
duration, so an owner editing a plan's duration (e.g. 30 -> 28 days)
made every historical renewal on that plan suddenly read as
oversized, and Apply rewrote ledger history to match the new
duration. This column snapshots the plan duration in force when the
row was written; the scan/corrector compare against it.

Backfill: legacy rows take their plan's CURRENT duration_days — the
best determinable value, since the duration in force at write time
was not recorded anywhere. That is exact for every plan whose
duration was never edited, and the documented fallback for edited
plans: a legacy row on an edited plan keeps the current duration,
so the scan may still misjudge that row exactly as before. Rows
with no plan (plan_id NULL) stay NULL and the scan falls back to
the live plan duration at scan time.

Revises: m3rg3v3fixall
"""
from alembic import op
import sqlalchemy as sa


revision = "v4m13a1b2c3d4"
down_revision = "m3rg3v3fixall"


def upgrade():
    from sqlalchemy import inspect, text

    conn = op.get_bind()
    inspector = inspect(conn)
    existing = {c["name"] for c in inspector.get_columns("renewal_history")}
    with op.batch_alter_table("renewal_history") as batch_op:
        if "duration_days" not in existing:
            batch_op.add_column(
                sa.Column("duration_days", sa.Integer(), nullable=True)
            )
    # Backfill from the row's plan (current duration — see docstring).
    conn.execute(
        text(
            "UPDATE renewal_history SET duration_days = ("
            "SELECT duration_days FROM membership_plans "
            "WHERE membership_plans.id = renewal_history.plan_id) "
            "WHERE duration_days IS NULL AND plan_id IS NOT NULL"
        )
    )


def downgrade():
    with op.batch_alter_table("renewal_history") as batch_op:
        batch_op.drop_column("duration_days")
