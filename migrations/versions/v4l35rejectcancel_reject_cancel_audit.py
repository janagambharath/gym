"""Reject/cancel audit trail on payment_verifications (V4-L35).

REGRESSION vs the V3-L2 fix: ``refund_payment`` was fixed to record
``refunded_at``/``refunded_by_id`` and leave ``verified_*`` untouched,
but ``reject_payment``/``cancel_payment`` still wrote
``verified_at = utcnow()`` + ``verified_by_id = <decider>`` — so a
rejected/cancelled payment looked "verified at" the rejection moment
by the rejecter, and the real verification (there never was one)
could not be reconstructed from the money trail.

This migration adds ``rejected_at``/``rejected_by_id`` and
``cancelled_at``/``cancelled_by_id`` (same pattern as the refund fix:
nullable timestamp + FK to users with ondelete SET NULL, guarded by
inspector checks) and the service layer stops writing ``verified_*``
on those transitions.

No backfill: rows already rejected/cancelled in production carry a
wrong ``verified_at`` from the old code and there is no stored record
of the real decision time to recover — the new columns stay NULL for
them, which at least stops presenting the rejection moment as a
verification. A manual audit of pre-fix rejected/cancelled rows (via
the audit log) is a follow-up, not something this migration guesses.

Revises: m3rg3v3fixall
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "v4l35rejectcancel"
down_revision = "m3rg3v3fixall"


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    existing = {c["name"] for c in inspector.get_columns("payment_verifications")}
    with op.batch_alter_table("payment_verifications") as batch_op:
        if "rejected_at" not in existing:
            batch_op.add_column(sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True))
        if "rejected_by_id" not in existing:
            batch_op.add_column(sa.Column("rejected_by_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                "fk_payments_rejected_by_id",
                "users",
                ["rejected_by_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "cancelled_at" not in existing:
            batch_op.add_column(sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True))
        if "cancelled_by_id" not in existing:
            batch_op.add_column(sa.Column("cancelled_by_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                "fk_payments_cancelled_by_id",
                "users",
                ["cancelled_by_id"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    with op.batch_alter_table("payment_verifications") as batch_op:
        cols = {c["name"] for c in inspector.get_columns("payment_verifications")}
        if "cancelled_by_id" in cols:
            try:
                batch_op.drop_constraint("fk_payments_cancelled_by_id", type_="foreignkey")
            except Exception:
                pass
            batch_op.drop_column("cancelled_by_id")
        if "cancelled_at" in cols:
            batch_op.drop_column("cancelled_at")
        if "rejected_by_id" in cols:
            try:
                batch_op.drop_constraint("fk_payments_rejected_by_id", type_="foreignkey")
            except Exception:
                pass
            batch_op.drop_column("rejected_by_id")
        if "rejected_at" in cols:
            batch_op.drop_column("rejected_at")
