"""Merge the two ADMS migration heads.

Revision ID: b87640da5a46
Revises: b1c2d3e4f5a6, c3d4e5f6a7b8

The graph diverged at a9b0c1d2e3f4 into two branches that were both
deployed:

* b1c2d3e4f5a6 — fix_missing_bridge_columns (bridge_commands columns,
  added only if missing; idempotent).
* a1b2c3d4e5f6 -> b2c3d4e5f6a7 -> c3d4e5f6a7b8 — biometric template
  table + ADMS CHECK expansions + the Elite Gym enablement UPDATE.

(Correction to the investigation note: this checkout has TWO heads, not
six — verified by walking migrations/versions; the main checkout shows
the same two.)

This merge is a no-op by itself, following the repo's earlier merge
migrations (4d750d2fb69b, 8f6d4f8844fb). It exists so the OPERLOG CHECK
migration that follows it has exactly one down_revision, whichever head
production is on: upgrading to the merge applies whichever branch
production has not applied yet, then the CHECK migration applies on a
single head. Railway's release phase runs `flask db upgrade heads`, so
production's alembic_version may hold one or both of these revisions —
both cases converge through this merge.

Before deploying, confirm production's alembic_version (see the CHECK
migration's deploy note): if it holds a revision outside this graph,
STOP — do not deploy.
"""

from alembic import op
import sqlalchemy as sa


revision = "b87640da5a46"
down_revision = ("b1c2d3e4f5a6", "c3d4e5f6a7b8")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
