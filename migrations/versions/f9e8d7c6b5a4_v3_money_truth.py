"""V3 money-truth fixes (deep review v3, 2026-11-06).

- V3-M5: renewal_history.is_creation — explicit signup marker set at
  write time by create_member. Backfilled for legacy rows with the old
  heuristic (member's first row with previous_end == new_start).
- V3-M3: partial unique index uq_payments_gym_reference_verified on
  (gym_id, reference) where status = 'verified', so two payments sharing
  one UTR cannot both verify. Created only when no duplicate verified
  reference already exists in the gym (a pre-existing duplicate is a
  data-cleanup job, not something a migration should silently resolve).
- V3-L2: payment_verifications.refunded_at / refunded_by_id — the
  refund audit trail, kept separate from the immutable verification.
- V3-M2: campaign_recipients.is_payment_backed + campaigns
  .total_recorded_revenue. Backfilled from the renewal rows, and the
  stored total_revenue_recovered is recomputed as payment-backed only.

Revises: a1b2c3d4e5f6 (one of the two current heads; the other head
b1c2d3e4f5a6 descends from the same parent).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "f9e8d7c6b5a4"
down_revision = "a1b2c3d4e5f6"


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    # ── renewal_history.is_creation (V3-M5) ──────────────────────────
    existing = {c["name"] for c in inspector.get_columns("renewal_history")}
    if "is_creation" not in existing:
        with op.batch_alter_table("renewal_history") as batch_op:
            batch_op.add_column(
                sa.Column("is_creation", sa.Boolean(), nullable=False, server_default=sa.false())
            )
        # Backfill legacy signup rows: first row per member whose
        # previous_end == new_start.
        conn.execute(
            text(
                "UPDATE renewal_history rh SET is_creation = TRUE "
                "WHERE rh.id IN (SELECT MIN(id) FROM renewal_history "
                "GROUP BY gym_id, member_id) "
                "AND rh.previous_end IS NOT NULL "
                "AND rh.previous_end = rh.new_start"
            )
        )

    # ── payment_verifications.refunded_at / refunded_by_id (V3-L2) ───
    existing = {c["name"] for c in inspector.get_columns("payment_verifications")}
    with op.batch_alter_table("payment_verifications") as batch_op:
        if "refunded_at" not in existing:
            batch_op.add_column(sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True))
        if "refunded_by_id" not in existing:
            batch_op.add_column(sa.Column("refunded_by_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                "fk_payments_refunded_by_id",
                "users",
                ["refunded_by_id"],
                ["id"],
                ondelete="SET NULL",
            )

    # ── Partial unique index on verified references (V3-M3) ──────────
    dupes = conn.execute(
        text(
            "SELECT COUNT(*) FROM ("
            "SELECT gym_id, reference FROM payment_verifications "
            "WHERE status = 'verified' AND reference IS NOT NULL "
            "GROUP BY gym_id, reference HAVING COUNT(*) > 1) dup"
        )
    ).scalar()
    if not dupes:
        op.create_index(
            "uq_payments_gym_reference_verified",
            "payment_verifications",
            ["gym_id", "reference"],
            unique=True,
            postgresql_where=text("status = 'verified'"),
        )

    # ── Campaign payment-backed flag + recorded total (V3-M2) ────────
    existing = {c["name"] for c in inspector.get_columns("campaign_recipients")}
    if "is_payment_backed" not in existing:
        with op.batch_alter_table("campaign_recipients") as batch_op:
            batch_op.add_column(sa.Column("is_payment_backed", sa.Boolean(), nullable=True))
        conn.execute(
            text(
                "UPDATE campaign_recipients cr "
                "SET is_payment_backed = (rh.payment_verification_id IS NOT NULL) "
                "FROM renewal_history rh WHERE cr.renewal_id = rh.id"
            )
        )
    existing = {c["name"] for c in inspector.get_columns("campaigns")}
    if "total_recorded_revenue" not in existing:
        with op.batch_alter_table("campaigns") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "total_recorded_revenue",
                    sa.Numeric(12, 2),
                    nullable=False,
                    server_default="0.00",
                )
            )
        # Recorded total keeps the old all-attributed value; the headline
        # becomes payment-backed only.
        conn.execute(
            text(
                "UPDATE campaigns SET total_recorded_revenue = total_revenue_recovered"
            )
        )
        conn.execute(
            text(
                "UPDATE campaigns c SET total_revenue_recovered = COALESCE("
                "(SELECT SUM(cr.renewal_amount) FROM campaign_recipients cr "
                "WHERE cr.campaign_id = c.id AND cr.renewed_at IS NOT NULL "
                "AND cr.renewal_amount IS NOT NULL "
                "AND cr.is_payment_backed IS TRUE), 0)"
            )
        )


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    try:
        op.drop_index(
            "uq_payments_gym_reference_verified",
            table_name="payment_verifications",
        )
    except Exception:
        pass
    with op.batch_alter_table("campaigns") as batch_op:
        if "total_recorded_revenue" in {c["name"] for c in inspector.get_columns("campaigns")}:
            batch_op.drop_column("total_recorded_revenue")
    with op.batch_alter_table("campaign_recipients") as batch_op:
        if "is_payment_backed" in {c["name"] for c in inspector.get_columns("campaign_recipients")}:
            batch_op.drop_column("is_payment_backed")
    with op.batch_alter_table("payment_verifications") as batch_op:
        cols = {c["name"] for c in inspector.get_columns("payment_verifications")}
        if "refunded_by_id" in cols:
            try:
                batch_op.drop_constraint("fk_payments_refunded_by_id", type_="foreignkey")
            except Exception:
                pass
            batch_op.drop_column("refunded_by_id")
        if "refunded_at" in cols:
            batch_op.drop_column("refunded_at")
    with op.batch_alter_table("renewal_history") as batch_op:
        if "is_creation" in {c["name"] for c in inspector.get_columns("renewal_history")}:
            batch_op.drop_column("is_creation")
