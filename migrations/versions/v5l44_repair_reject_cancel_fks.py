"""Repair v4l35's silently-skipped FKs (V5-L44).

``v4l35rejectcancel`` nested each ``create_foreign_key`` inside the
``if "<col>" not in existing`` branch, so a DB with the column present
but the FK missing (e.g. a first run that failed between ``add_column``
and FK creation) never gets the FK and still reports success.

v4l35 RAN LIVE — it is NOT edited. This migration checks FK existence
independently of column existence (inspector) and creates any missing
FKs (``fk_payments_rejected_by_id``,
``fk_payments_cancelled_by_id`` on ``payment_verifications``). The
column adds are repeated here, guarded, so a partial-state DB missing
the columns gets them too.

An FK creation that fails (e.g. orphaned ``*_by_id`` values pointing
at deleted users) prints a LOUD warning and lets the deploy continue
instead of blocking it: the FK is a backstop, and a failed deploy
re-creates the partial-state trap this migration exists to fix.

Revises: m3rg3v4fixall
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "v5l44rejectcancelfk"
down_revision = "m3rg3v4fixall"

TABLE = "payment_verifications"

# (column, fk name) — same DDL as v4l35.
FKS = (
    ("rejected_by_id", "fk_payments_rejected_by_id"),
    ("cancelled_by_id", "fk_payments_cancelled_by_id"),
)

COLUMNS = (
    ("rejected_at", sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True)),
    ("rejected_by_id", sa.Column("rejected_by_id", sa.Integer(), nullable=True)),
    ("cancelled_at", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True)),
    ("cancelled_by_id", sa.Column("cancelled_by_id", sa.Integer(), nullable=True)),
)


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        print(
            f"[v5-l44] table {TABLE} absent (partial-state DB) — "
            "nothing to repair."
        )
        return

    # 1) Columns first, guarded — independent of the FK step below.
    existing = {c["name"] for c in inspector.get_columns(TABLE)}
    missing_cols = [name for name, _ in COLUMNS if name not in existing]
    if missing_cols:
        with op.batch_alter_table(TABLE) as batch_op:
            for name, col in COLUMNS:
                if name in missing_cols:
                    batch_op.add_column(col)
        print(f"[v5-l44] added missing columns: {missing_cols}")
        # Re-inspect: the batch above may have added the FK columns.
        inspector = inspect(conn)
        existing = {c["name"] for c in inspector.get_columns(TABLE)}

    # 2) FKs — checked independently of whether the column pre-existed
    # at migration start (the v4l35 bug: the FK check was nested inside
    # the column-absent branch).
    existing_fks = {
        fk["name"]
        for fk in inspector.get_foreign_keys(TABLE)
        if fk.get("name")
    }
    for col, fk_name in FKS:
        if col not in existing:
            print(f"[v5-l44] column {col} absent — cannot create {fk_name}.")
            continue
        if fk_name in existing_fks:
            print(f"[v5-l44] FK {fk_name} already exists — skipping.")
            continue
        try:
            with op.batch_alter_table(TABLE) as batch_op:
                batch_op.create_foreign_key(
                    fk_name, "users", [col], ["id"], ondelete="SET NULL"
                )
            print(f"[v5-l44] created FK {fk_name}.")
        except Exception as exc:  # noqa: BLE001 — loud warning, not silent
            print(
                f"[v5-l44] WARNING: could not create FK {fk_name}: {exc}. "
                "Deploy continues — check for orphaned *_by_id values "
                "and create the FK manually."
            )


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        return
    existing_fks = {
        fk["name"]
        for fk in inspector.get_foreign_keys(TABLE)
        if fk.get("name")
    }
    # Drops only the two FKs this migration owns (guarded). In a full
    # downgrade chain v4l35's downgrade follows and drops the columns;
    # dropping the FKs first is consistent with that order.
    for _, fk_name in FKS:
        if fk_name not in existing_fks:
            continue
        with op.batch_alter_table(TABLE) as batch_op:
            batch_op.drop_constraint(fk_name, type_="foreignkey")
        print(f"[v5-l44] dropped FK {fk_name}.")
