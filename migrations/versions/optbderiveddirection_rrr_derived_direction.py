"""Add derived_direction to rrr_attendance_events (Option B, 2026-11-16).

Server-side Live Access direction derivation: for direct-ADMS punches the
server derives ENTRY/EXIT from MemberAccessState instead of trusting the
terminal's status byte (the X2008 auto-alternates in/out with no midnight
reset, so morning arrivals were counted as EXIT). The derived att-state
("0" = derived ENTRY, "1" = derived EXIT) is stored at ingest in the new
nullable column; the raw `direction` is never rewritten. NULL = not
derived (unknown member, out-of-order punch, pre-deploy row, non-ADMS
source) — read paths fall back to raw via coalesce.

SQLite-safe add-column; downgrade drops it.

Revises: v12b2otpsendthrottle
"""

from alembic import op
import sqlalchemy as sa


revision = "optbderiveddirection"
down_revision = "v12b2otpsendthrottle"


def upgrade():
    op.add_column(
        "rrr_attendance_events",
        sa.Column("derived_direction", sa.String(length=16), nullable=True),
    )


def downgrade():
    op.drop_column("rrr_attendance_events", "derived_direction")
