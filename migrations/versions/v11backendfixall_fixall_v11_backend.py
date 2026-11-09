"""Fix-all v11 backend batch (2026-11-09): duplicate-phone backstop + reject reason.

NOTE on the model: the index is deliberately NOT declared in
``app/models/member.py``. The suite's fixtures reuse the reserved
synthetic test phone (+919999900001) for many members per gym, so a
model-level index (built by ``db.create_all()`` in tests) would break
dozens of pre-existing tests that never go through the API guard. The
migration below is the backstop in production, where real members can
never carry the synthetic phone; the 409 DUPLICATE_PHONE code guard is
the enforcement in-app. (Autogenerate would propose dropping this
index — do not accept that; the index is intentional.)

1. V11-H1 — partial unique index ``uq_members_gym_phone_active`` on
   ``members (gym_id, phone) WHERE deleted_at IS NULL``: at most one
   live member per (gym, phone). Soft-deleted rows are excluded so a
   deactivated member's number can be reused on re-add. The code guard
   (409 DUPLICATE_PHONE in create/PATCH/web form) is the real
   enforcement; this index is the race backstop.
2. V11-M10 — ``payment_verifications.rejected_reason`` (String 500,
   nullable): why a payment was rejected, surfaced to the member with
   the REJECTED status.

DEFENSIVE upgrade (deploy must never fail on real data): the index is
created ONLY when no live duplicate (gym_id, phone) rows exist. If
conflicting rows exist the migration logs a note and SKIPS the index
— the code guard still enforces uniqueness for new writes, and the
existing duplicates must be resolved by hand (merge/deactivate one
row) before the index can be added on a later pass. The column add is
unconditional (a nullable column cannot fail on data).

Downgrade drops both additions. Dropping the column discards any
stored reject reasons — acceptable: a downgraded codebase has no
reader for the column.

Revises: fcce2a90ef39 (single head at time of writing)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "v11backendfixall"
down_revision = "fcce2a90ef39"
branch_labels = None
depends_on = None

INDEX_NAME = "uq_members_gym_phone_active"
REJECTED_REASON_COLUMN = "rejected_reason"


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    # 1. V11-M10 — reject reason column (nullable: cannot fail).
    pv_columns = [c["name"] for c in inspector.get_columns("payment_verifications")]
    if REJECTED_REASON_COLUMN not in pv_columns:
        op.add_column(
            "payment_verifications",
            sa.Column(REJECTED_REASON_COLUMN, sa.String(500), nullable=True),
        )
        print(f"[v11-backend] added payment_verifications.{REJECTED_REASON_COLUMN}.")
    else:
        print(f"[v11-backend] payment_verifications.{REJECTED_REASON_COLUMN} already present — skipping.")

    # 2. V11-H1 — partial unique index, DEFENSIVE: never fail the deploy.
    existing_indexes = [i["name"] for i in inspector.get_indexes("members")]
    if INDEX_NAME in existing_indexes:
        print(f"[v11-backend] index {INDEX_NAME} already exists — skipping.")
        return
    conflicts = conn.execute(
        text(
            "SELECT gym_id, phone, COUNT(*) AS n FROM members "
            "WHERE deleted_at IS NULL "
            "GROUP BY gym_id, phone HAVING COUNT(*) > 1 LIMIT 5"
        )
    ).fetchall()
    if conflicts:
        print(
            "[v11-backend] SKIPPING partial unique index "
            f"{INDEX_NAME}: {len(conflicts)} live duplicate (gym_id, phone) "
            "group(s) still exist (showing up to 5): "
            + ", ".join(f"gym {c[0]} phone {c[1]} x{c[2]}" for c in conflicts)
            + ". Resolve the duplicates (merge/deactivate one row each) "
            "then add the index with a follow-up migration (this "
            "revision is stamped head, so Alembic will not re-run it); "
            "the 409 DUPLICATE_PHONE code guard still enforces "
            "uniqueness for new writes in the meantime."
        )
        return
    op.create_index(
        INDEX_NAME,
        "members",
        ["gym_id", "phone"],
        unique=True,
        postgresql_where=text("deleted_at IS NULL"),
        sqlite_where=text("deleted_at IS NULL"),
    )
    print(f"[v11-backend] created partial unique index {INDEX_NAME}.")


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    existing_indexes = [i["name"] for i in inspector.get_indexes("members")]
    if INDEX_NAME in existing_indexes:
        op.drop_index(INDEX_NAME, table_name="members")
        print(f"[v11-backend] dropped index {INDEX_NAME}.")
    pv_columns = [c["name"] for c in inspector.get_columns("payment_verifications")]
    if REJECTED_REASON_COLUMN in pv_columns:
        op.drop_column("payment_verifications", REJECTED_REASON_COLUMN)
        print(f"[v11-backend] dropped payment_verifications.{REJECTED_REASON_COLUMN}.")
