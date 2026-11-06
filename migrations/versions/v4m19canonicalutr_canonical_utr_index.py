"""Canonical UTR backstop (V4-M19).

REGRESSION vs the V3-M3/L5 fix: the duplicate-UTR protection was
case-sensitive at EVERY layer — the app check (``filter_by(reference=…)``),
the partial unique index (raw ``(gym_id, reference)``), and the
``f9e8d7c6b5a4`` migration — so "UTR123" and "utr123" (or "UTR 123")
both verified and double-counted collections. Separately, when
verified duplicates already existed, that migration SKIPPED creating
the index silently, with no error, no warning and no marker — the
deploy then ran with the verify-time check as the only guard and
nothing told anyone the backstop was absent.

This migration installs the canonical backstop, and fails LOUDLY
instead of silently skipping:

1. AUDIT: groups verified payments by the canonical reference
   (``upper(replace(trim(reference), ' ', ''))``) per gym. If any
   canonical duplicate exists, every offending (gym, reference,
   count) pair is printed and the migration RAISES — the deploy
   stops instead of running without the backstop. Clean the printed
   pairs up first (decide which payment is the real one), then
   re-run the deploy. This is deliberate: a silently-absent index
   is how V3-M3 regressed.
2. REPAIR the silently-skipped raw index: if
   ``uq_payments_gym_reference_verified`` is absent (the f9e8 skip),
   create it now — the audit above already proves no exact
   duplicates exist.
3. CREATE the canonical expression unique index
   ``uq_payments_gym_reference_verified_norm`` on
   ``(gym_id, upper(replace(trim(reference), ' ', '')))`` where
   ``status = 'verified'`` — the race backstop for case/space
   variants. Postgres-only: the expression index is a production
   (Postgres) artifact; the SQLite test environment relies on the
   app-level canonical check (all write paths store the canonical
   form, so the raw index already backstops new rows there).

The app layer (``payment_service.canonical_payment_reference``)
canonicalises at write time in every create path and compares
canonically in ``verified_payment_with_reference``, so new rows
store the canonical form and the raw index is already a canonical
backstop for them; this index covers legacy rows stored pre-fix.

Revises: m3rg3v3fixall
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "v4m19canonicalutr"
down_revision = "m3rg3v3fixall"

_NORM = "upper(replace(trim(reference), ' ', ''))"


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    # 1) Loud audit: canonical duplicates among verified payments.
    # Empty references are NOT UTRs (cash / no-reference payments) —
    # they must be excluded: 17 verified rows at Yodha share '' and
    # are legitimate, not duplicates. (V4-M19 deploy-halt fix, 2026-11-06.)
    dupes = conn.execute(
        text(
            "SELECT gym_id, "
            f"{_NORM} AS norm_ref, COUNT(*) AS n "
            "FROM payment_verifications "
            "WHERE status = 'verified' AND reference IS NOT NULL "
            "AND trim(reference) <> '' "
            f"GROUP BY gym_id, {_NORM} HAVING COUNT(*) > 1 "
            "ORDER BY gym_id, norm_ref LIMIT 50"
        )
    ).all()
    if dupes:
        print("[v4-m19-canonical-utr] CANONICAL DUPLICATE REFERENCES FOUND — refusing to install the backstop silently:")
        for gym_id, norm_ref, n in dupes:
            print(
                f"[v4-m19-canonical-utr] gym_id={gym_id} reference={norm_ref!r} verified_count={n}"
            )
        raise RuntimeError(
            "v4-m19: canonical duplicate verified references exist "
            f"({len(dupes)} group(s) printed above). Clean them up, then "
            "re-run the deploy — the canonical UTR index cannot be "
            "installed while duplicates exist."
        )
    print("[v4-m19-canonical-utr] audit: no canonical duplicate verified references.")

    # 2) Repair the f9e8 silent skip: create the raw index if absent.
    # Empty references excluded — they are not UTRs (see audit above).
    index_names = {ix["name"] for ix in inspector.get_indexes("payment_verifications")}
    if "uq_payments_gym_reference_verified" not in index_names:
        print(
            "[v4-m19-canonical-utr] raw index uq_payments_gym_reference_verified "
            "absent (f9e8d7c6b5a4 skipped it) — creating it now."
        )
        op.create_index(
            "uq_payments_gym_reference_verified",
            "payment_verifications",
            ["gym_id", "reference"],
            unique=True,
            postgresql_where=text("status = 'verified' AND trim(reference) <> ''"),
        )

    # 3) Canonical expression index (Postgres only).
    if conn.dialect.name == "postgresql":
        if "uq_payments_gym_reference_verified_norm" not in index_names:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX uq_payments_gym_reference_verified_norm "
                    "ON payment_verifications "
                    f"(gym_id, ({_NORM})) "
                    "WHERE status = 'verified' AND reference IS NOT NULL "
                    "AND trim(reference) <> ''"
                )
            )
            print(
                "[v4-m19-canonical-utr] created canonical index "
                "uq_payments_gym_reference_verified_norm."
            )
    else:
        print(
            "[v4-m19-canonical-utr] non-Postgres dialect "
            f"({conn.dialect.name}) — canonical expression index skipped; "
            "app-level canonical check is the backstop here."
        )


def downgrade():
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        conn.execute(
            text("DROP INDEX IF EXISTS uq_payments_gym_reference_verified_norm")
        )
