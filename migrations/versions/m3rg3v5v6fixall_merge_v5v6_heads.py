"""Merge the six v5+v6 fix-all branches into a single head.

The six v5/v6 migrations were written in parallel against the same parent
(m3rg3v4fixall), leaving six heads:
* v5v6m1iscreation (V5-M1 corrected repair: un-flag + re-flag
  renewal_history.is_creation with the v6 previous_start guard, so
  payment_backed_amount is trustworthy again once this runs on prod data)
* v5m15m17utrpartial (V5-M15 + V6-M17: repair the canonical-UTR partial
  index predicate)
* v5l44rejectcancelfk (V5-L44: repair rejected/cancelled audit FKs on
  payment_verifications)
* v5l9a1b2c3d4e (V5-L9: recompute Yodha dedupe keys)
* v5v6a1b2c3d4e5 (V5-L16: override_reason audit columns on renewal_history
  and payment_verifications)
* v6l39duemembersidx (V6-L39: repair the due-members index)

The branches touch disjoint tables/columns/indexes, so this merge is a
no-op: it only unifies the heads so `flask db upgrade heads` has one target.

Revises: v5v6m1iscreation, v5m15m17utrpartial, v5l44rejectcancelfk,
    v5l9a1b2c3d4e, v5v6a1b2c3d4e5, v6l39duemembersidx
"""

revision = "m3rg3v5v6fixall"
down_revision = (
    "v5v6m1iscreation",
    "v5m15m17utrpartial",
    "v5l44rejectcancelfk",
    "v5l9a1b2c3d4e",
    "v5v6a1b2c3d4e5",
    "v6l39duemembersidx",
)
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
