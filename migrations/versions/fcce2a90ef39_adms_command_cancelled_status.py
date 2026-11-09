"""Add 'cancelled' to the RRRAdmsCommand status CHECK constraint.

The Live Access "N command(s) failed to sync" banner counts
``rrr_adms_commands`` rows with status='failed' for an ADMS-direct gym,
and until now every terminal-state row that was NOT a terminal rejection
landed there too: owner-cancelled queued commands, stale disables/enables
cancelled by the serve-time fail-safe guards, expired stale unlocks, and
retired legacy DELETE blocks all went through ``cancel_adms_command``,
which stamped them status='failed'. The banner therefore inflated with
rows that were never failures, and the ADMS retry/clear endpoints 409'd
for ADMS gyms, so nothing could ever bring the count down.

This migration widens ``ck_rrr_adms_command_status`` to
``('queued', 'delivered', 'acked', 'failed', 'cancelled')`` so those
rows can be terminal-stated as 'cancelled' instead. No data is
rewritten: every existing row keeps its status. The failed count
(``status == 'failed'``) is unchanged by this migration on its own;
the code change that stamps 'cancelled' rides with it.

Downgrade is a deliberate no-op (same pattern as V9-L20): restoring the
four-value CHECK while 'cancelled' rows exist would fail on Postgres,
and rewriting those rows back to 'failed' would destroy the audit
distinction this migration exists to record. A downgraded codebase
simply ignores 'cancelled' rows — its queries filter status=='failed'
for counts and serve only queued/delivered.

Revises: v8l29l32memberidem
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "fcce2a90ef39"
down_revision = "v8l29l32memberidem"
branch_labels = None
depends_on = None

TABLE = "rrr_adms_commands"
CONSTRAINT = "ck_rrr_adms_command_status"
NEW_STATUSES = "status IN ('queued', 'delivered', 'acked', 'failed', 'cancelled')"


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    if TABLE not in inspector.get_table_names():
        print(f"[adms-cancelled-status] table {TABLE} absent — nothing to do.")
        return
    constraints = [
        c["name"] for c in inspector.get_check_constraints(TABLE)
    ]
    with op.batch_alter_table(TABLE) as batch_op:
        if CONSTRAINT in constraints:
            batch_op.drop_constraint(CONSTRAINT, type_="check")
        else:
            # No CHECK at all (e.g. a table predating the constraint):
            # create the widened one instead of skipping — every
            # existing status is inside the new list, so this cannot
            # fail on real data.
            print(
                f"[adms-cancelled-status] constraint {CONSTRAINT} absent — "
                "creating the widened CHECK."
            )
        batch_op.create_check_constraint(CONSTRAINT, NEW_STATUSES)


def downgrade():
    # Deliberate no-op (see module docstring): restoring the four-value
    # CHECK while 'cancelled' rows exist would fail, and rewriting those
    # rows back to 'failed' would destroy audit history. A downgraded
    # codebase ignores 'cancelled' rows.
    print(
        "[adms-cancelled-status] downgrade is a no-op by design; "
        "'cancelled' rows and the widened CHECK are left in place."
    )
