"""Merge the three v3 fix-all branches into a single head.

The three v3 migrations were written in parallel against three different
parents, leaving three heads:
* c4a9012b3d4e (canonicalize stored enroll numbers) <- 71e470eb6cb6
* f9e8d7c6b5a4 (money truth: is_creation, refund audit, campaign
  payment-backed flag, partial unique UTR index) <- a1b2c3d4e5f6
* v3m18a1b2c3d4 (previous_plan_id / previous_price on renewals)
  <- z8a9b0c1d2e3

The branches touch disjoint tables/columns, so this merge is a no-op:
it only unifies the heads so `flask db upgrade heads` has one target.

Revises: c4a9012b3d4e, f9e8d7c6b5a4, v3m18a1b2c3d4
"""

revision = "m3rg3v3fixall"
down_revision = ("c4a9012b3d4e", "f9e8d7c6b5a4", "v3m18a1b2c3d4")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
