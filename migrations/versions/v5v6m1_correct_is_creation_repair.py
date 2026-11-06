"""Corrected follow-up to the V4-M20 money-truth repair (V5-M1 + V6 correction).

V4-M20's repair un-flagged genuine signups of members who had renewed
since signup: it anchored on the member's CURRENT ``membership_start``,
which moves to the new period on every renewal, instead of the row's
own ``new_start``. It already ran live (Batch 1), so prod data now has
genuine signup rows with ``is_creation = FALSE`` and
``payment_backed_amount`` may OVERCOUNT (signups counted as recoveries).

This migration repairs both directions, anchored on the row itself:

(a) UN-FLAG (corrected M20 predicate): a flagged first row is NOT a
    creation row when its backing payment proves otherwise — ``paid_on``
    present and ``<> rh.new_start`` — OR when ``previous_start`` is
    present and ``<> rh.new_start`` (the create_member shape writes
    ``previous_start == new_start``; a first renewal carries the
    member's old start there).
(b) RE-FLAG (the rows M20 wrongly un-flagged): a first row with
    ``previous_end == new_start`` AND (``previous_start`` IS NULL OR
    ``== new_start``) AND ``paid_on == rh.new_start`` IS a creation
    row. The ``previous_start`` guard is the V6 correction: without it
    an imported member created and renewed the same day (genuine first
    renewal, ``paid_on == new_start`` but ``previous_start`` = old
    start) would be wrongly re-flagged — the opposite error.

Both passes are audit-printed as ``[v5v6-m1-repair] ...`` like v4m20
did, idempotent (re-running finds zero rows), and SQLite-safe (same
SQL runs in the test suite). The runtime heuristic was fixed in the
same change (``revenue_service._row_is_creation`` / ``_creation_row_ids``
now compare ``paid_on`` to the row's own ``new_start``), so rows
re-flagged here stay correct and rows the runtime already classified
via the flag are consistent with it.

Revises: m3rg3v4fixall
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "v5v6m1iscreation"
down_revision = "m3rg3v4fixall"

_FIRST_ROW = "rh.id IN (SELECT MIN(id) FROM renewal_history GROUP BY member_id)"

# Flagged first row, creation-shaped, whose backing payment (or the
# previous_start snapshot) proves it is a renewal, not a signup.
_MISFLAGGED_WHERE = (
    "rh.is_creation IS TRUE "
    f"AND {_FIRST_ROW} "
    "AND rh.previous_end IS NOT NULL "
    "AND rh.previous_end = rh.new_start "
    "AND ("
    "(pv.paid_on IS NOT NULL AND pv.paid_on <> rh.new_start) "
    "OR (rh.previous_start IS NOT NULL AND rh.previous_start <> rh.new_start)"
    ")"
)

# Unflagged first row matching the full creation shape, anchored on
# the row's own new_start (NOT the member's current membership_start).
_WRONGLY_UNFLAGGED_WHERE = (
    "rh.is_creation IS FALSE "
    f"AND {_FIRST_ROW} "
    "AND rh.previous_end IS NOT NULL "
    "AND rh.previous_end = rh.new_start "
    "AND (rh.previous_start IS NULL OR rh.previous_start = rh.new_start) "
    "AND pv.paid_on IS NOT NULL "
    "AND pv.paid_on = rh.new_start"
)


def _repair_is_creation_v5v6(conn):
    """Audit + repair. Returns {'misflagged', 'unflagged', 'reflagged',
    'wrongly_unflagged'}. Pure SQLAlchemy text — no Alembic context
    needed, so the test suite can call it directly against the SQLite
    test database."""
    inspector = inspect(conn)
    if "is_creation" not in {c["name"] for c in inspector.get_columns("renewal_history")}:
        print("[v5v6-m1-repair] renewal_history.is_creation missing; nothing to repair.")
        return {"misflagged": 0, "unflagged": 0, "reflagged": 0, "wrongly_unflagged": 0}

    misflagged = conn.execute(
        text(
            "SELECT COUNT(*) FROM renewal_history rh "
            "JOIN payment_verifications pv ON pv.id = rh.payment_verification_id "
            f"WHERE {_MISFLAGGED_WHERE}"
        )
    ).scalar()
    print(
        "[v5v6-m1-repair] audit: "
        f"{misflagged} first-row(s) flagged is_creation=TRUE whose backing "
        "payment (paid_on <> row new_start) or previous_start snapshot "
        "proves a genuine first renewal."
    )

    wrongly_unflagged = conn.execute(
        text(
            "SELECT COUNT(*) FROM renewal_history rh "
            "JOIN payment_verifications pv ON pv.id = rh.payment_verification_id "
            f"WHERE {_WRONGLY_UNFLAGGED_WHERE}"
        )
    ).scalar()
    print(
        "[v5v6-m1-repair] audit: "
        f"{wrongly_unflagged} first-row(s) with is_creation=FALSE matching "
        "the full creation shape (paid_on == row new_start) — genuine "
        "signups the v4m20 repair wrongly un-flagged."
    )

    unflagged = conn.execute(
        text(
            "UPDATE renewal_history SET is_creation = FALSE WHERE id IN ("
            "SELECT rh.id FROM renewal_history rh "
            "JOIN payment_verifications pv ON pv.id = rh.payment_verification_id "
            f"WHERE {_MISFLAGGED_WHERE})"
        )
    )
    unflagged_n = unflagged.rowcount if unflagged.rowcount is not None else 0
    print(f"[v5v6-m1-repair] repair: un-flagged {unflagged_n} row(s).")

    reflagged = conn.execute(
        text(
            "UPDATE renewal_history SET is_creation = TRUE WHERE id IN ("
            "SELECT rh.id FROM renewal_history rh "
            "JOIN payment_verifications pv ON pv.id = rh.payment_verification_id "
            f"WHERE {_WRONGLY_UNFLAGGED_WHERE})"
        )
    )
    reflagged_n = reflagged.rowcount if reflagged.rowcount is not None else 0
    print(f"[v5v6-m1-repair] repair: re-flagged {reflagged_n} row(s).")

    return {
        "misflagged": int(misflagged or 0),
        "unflagged": int(unflagged_n),
        "reflagged": int(reflagged_n),
        "wrongly_unflagged": int(wrongly_unflagged or 0),
    }


def upgrade():
    _repair_is_creation_v5v6(op.get_bind())


def downgrade():
    # Deliberate no-op: this migration corrects wrongly-written flags
    # in live data. Reversing it would re-corrupt the money figures;
    # there is no safe inverse.
    pass
