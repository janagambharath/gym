"""Merge the six v4 fix-all branches into a single head.

The six v4 migrations were written in parallel against the same parent
(m3rg3v3fixall), leaving six heads:
* v4m20repairiscreation (V4-M20 repair: un-flag genuine first renewals
  wrongly backfilled as signups by the v3 money-truth migration)
* v4l35rejectcancel (V4-L35: rejected_at/rejected_by_id and
  cancelled_at/cancelled_by_id audit columns on payment_verifications)
* v4m19canonicalutr (V4-M19: canonical UTR expression index + repair of
  the silently-skipped raw index)
* v4m13a1b2c3d4 (V4-M13: duration_days snapshot on renewal_history)
* v4l30a1b2c3d4e (V4-L30: FK previous_plan_id -> membership_plans.id)
* v4a3a3conflicts (V4-M6: report-only audit of conflicting canonical
  enrol-number pairs)

The branches touch disjoint tables/columns (the M20 repair only updates
renewal_history.is_creation flags), so this merge is a no-op: it only
unifies the heads so `flask db upgrade heads` has one target.

Revises: v4m20repairiscreation, v4l35rejectcancel, v4m19canonicalutr,
    v4m13a1b2c3d4, v4l30a1b2c3d4e, v4a3a3conflicts
"""

revision = "m3rg3v4fixall"
down_revision = (
    "v4m20repairiscreation",
    "v4l35rejectcancel",
    "v4m19canonicalutr",
    "v4m13a1b2c3d4",
    "v4l30a1b2c3d4e",
    "v4a3a3conflicts",
)
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
