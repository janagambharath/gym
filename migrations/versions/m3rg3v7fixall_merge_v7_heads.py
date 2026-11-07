"""Merge the three v7 fix-all branches into a single head.

The v7 fix-all workers wrote in parallel against the same parent
(m3rg3v5v6fixall), leaving three heads:
* v7l2rejectcancelfk (V7-L2: verify/repair the reject/cancel audit FKs
  on payment_verifications, with a durable schema_repair_notes record
  when a create fails)
* v7m1l10admsintent (V7-M1 / V7-L10: intended_member_id on
  rrr_adms_commands)
* v7m3l4idempexpiry (V7-L4 / V7-M3: expires_at on
  mobile_idempotency_keys)

The branches touch disjoint tables, so this merge is a no-op: it only
unifies the heads so `flask db upgrade heads` has one target.

NOTE: written when these were the only three v7 branches (a third
landed while this file was being verified). If another v7 worker
lands a further migration on m3rg3v5v6fixall after this file, heads
branch again and this merge must be extended (add the new revision
to down_revision) — re-run `alembic heads` before the push.

Revises: v7l2rejectcancelfk, v7m1l10admsintent, v7m3l4idempexpiry
"""

revision = "m3rg3v7fixall"
down_revision = (
    "v7l2rejectcancelfk",
    "v7m1l10admsintent",
    "v7m3l4idempexpiry",
)
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
