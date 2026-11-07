"""Add intended_member_id to rrr_adms_commands (V7-M1 / V7-L10).

V7-M1: a mapping-only deleted member's delete-time block queues but can
never serve — at serve time the mappings are gone, so
resolve_adms_member_for_disable() returns None and the block is cancelled
CANCELLED_STALE_STATE. Stamping the intended member on the command row at
queue time lets the serve guard fall back to the stored intent (deleted
members are blockable) instead of re-resolving an identity that no longer
exists.

V7-L10: the V6-M6 intended-member guard derived intent only from the
queue-time audit row, which the purge-audit-logs CLI deletes after 90
days — after which unknown intent serves. The row survives the purge.

SQLite-safe add-column; downgrade drops it (no-op if absent).

Revises: m3rg3v5v6fixall
"""

from alembic import op
import sqlalchemy as sa


revision = "v7m1l10admsintent"
down_revision = "m3rg3v5v6fixall"


def upgrade():
    from sqlalchemy import inspect

    conn = op.get_bind()
    inspector = inspect(conn)
    existing = {c["name"] for c in inspector.get_columns("rrr_adms_commands")}
    with op.batch_alter_table("rrr_adms_commands") as batch_op:
        if "intended_member_id" not in existing:
            batch_op.add_column(
                sa.Column("intended_member_id", sa.Integer(), nullable=True)
            )


def downgrade():
    from sqlalchemy import inspect

    conn = op.get_bind()
    inspector = inspect(conn)
    existing = {c["name"] for c in inspector.get_columns("rrr_adms_commands")}
    with op.batch_alter_table("rrr_adms_commands") as batch_op:
        if "intended_member_id" in existing:
            batch_op.drop_column("intended_member_id")
