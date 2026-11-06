"""Repair the V3 money-truth backfill's mis-flagged creation rows (V4-M20).

REGRESSION, LIVE DATA — read this before deploying.

Migration ``f9e8d7c6b5a4`` (Batch 1, already LIVE on Railway) backfilled
``renewal_history.is_creation`` with the raw heuristic — every first
row per member with ``previous_end == new_start`` — and NO
``paid_on == membership_start`` check. The runtime heuristic
(``revenue_service._row_is_creation``) has that check precisely to
protect genuine first renewals of imported members backdated onto
``previous_end`` (continuous coverage, explicitly allowed for expired
members). Worse, ``_row_is_creation`` short-circuits on the flag, so
the runtime refinement can never rescue a wrongly backfilled row:
that genuine recovery is permanently labelled a signup and permanently
excluded from ``revenue_recovered``, ``recovery_rate`` and reports.

This migration repairs the live data with a targeted UPDATE (not just
a fixed migration — the bad flags are already in the production DB):

(a) AUDIT first — counts first-rows flagged ``is_creation=TRUE``
    whose backing payment has ``paid_on != membership_start``
    (genuine first renewals wrongly flagged), and prints the count
    as ``[v4-m20-repair] ...``.
(b) UN-FLAGS exactly those rows (``SET is_creation = FALSE``).
    A row is only un-flagged when its backing payment PROVES it is
    not a creation row (``paid_on`` present and != the member's
    start); genuine signups (``paid_on == membership_start``) and
    rows with no backing payment keep their flag.
(c) Idempotent and Postgres-safe: re-running finds zero rows to
    un-flag and is a no-op. The repair is also SQLite-safe (the
    same SQL runs in the test suite).

Reverse direction (NOT repaired): creation rows with
``previous_end IS NULL`` were never marked by the backfill (it
required ``previous_end = new_start``) and stay ``is_creation=FALSE``.
They are NOT flipped here — a NULL-``previous_end`` first row cannot
be safely identified as a creation row from the stored fields alone
(an imported member's genuine first renewal can share the same
shape), so the migration only audits/counts them and prints the
count for a manual follow-up. Do not treat the backfilled flag as
ground truth for the Nov 7 pull until this repair has run.

Revises: m3rg3v3fixall
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "v4m20repairiscreation"
down_revision = "m3rg3v3fixall"

# First row per member with previous_end == new_start, flagged as a
# creation row, whose backing payment proves otherwise.
_MISFLAGGED_WHERE = (
    "rh.is_creation IS TRUE "
    "AND rh.id IN (SELECT MIN(id) FROM renewal_history GROUP BY member_id) "
    "AND rh.previous_end IS NOT NULL "
    "AND rh.previous_end = rh.new_start "
    "AND pv.paid_on IS NOT NULL "
    "AND pv.paid_on <> m.membership_start"
)


def _repair_is_creation_backfill(conn):
    """Audit + repair. Returns {'misflagged': N, 'unflagged': N,
    'null_previous_end_unflagged': N}. Pure SQLAlchemy text — no
    Alembic context needed, so the test suite can call it directly
    against the SQLite test database."""
    inspector = inspect(conn)
    if "is_creation" not in {c["name"] for c in inspector.get_columns("renewal_history")}:
        print("[v4-m20-repair] renewal_history.is_creation missing; nothing to repair.")
        return {"misflagged": 0, "unflagged": 0, "null_previous_end_unflagged": 0}

    misflagged = conn.execute(
        text(
            "SELECT COUNT(*) FROM renewal_history rh "
            "JOIN members m ON m.id = rh.member_id "
            "JOIN payment_verifications pv ON pv.id = rh.payment_verification_id "
            f"WHERE {_MISFLAGGED_WHERE}"
        )
    ).scalar()
    print(
        "[v4-m20-repair] audit: "
        f"{misflagged} first-row(s) flagged is_creation=TRUE whose backing "
        "payment has paid_on != membership_start — genuine first "
        "renewals of imported members wrongly labelled signups."
    )

    # Reverse direction, audited only (see module docstring — not
    # safely identifiable, so never auto-flipped).
    null_prev = conn.execute(
        text(
            "SELECT COUNT(*) FROM renewal_history rh "
            "WHERE rh.is_creation IS FALSE "
            "AND rh.id IN (SELECT MIN(id) FROM renewal_history GROUP BY member_id) "
            "AND rh.previous_end IS NULL"
        )
    ).scalar()
    print(
        "[v4-m20-repair] audit: "
        f"{null_prev} first-row(s) with previous_end IS NULL still "
        "unflagged (possible unmarked creation rows — manual review, "
        "not auto-flipped)."
    )

    result = conn.execute(
        text(
            "UPDATE renewal_history SET is_creation = FALSE WHERE id IN ("
            "SELECT rh.id FROM renewal_history rh "
            "JOIN members m ON m.id = rh.member_id "
            "JOIN payment_verifications pv ON pv.id = rh.payment_verification_id "
            f"WHERE {_MISFLAGGED_WHERE})"
        )
    )
    unflagged = result.rowcount if result.rowcount is not None else 0
    print(f"[v4-m20-repair] repair: un-flagged {unflagged} row(s).")
    return {
        "misflagged": int(misflagged or 0),
        "unflagged": int(unflagged),
        "null_previous_end_unflagged": int(null_prev or 0),
    }


def upgrade():
    _repair_is_creation_backfill(op.get_bind())


def downgrade():
    # Deliberate no-op: this migration corrects wrongly-written flags
    # in live data. Re-flagging the repaired rows would re-corrupt
    # the money figures; there is no safe inverse.
    pass
