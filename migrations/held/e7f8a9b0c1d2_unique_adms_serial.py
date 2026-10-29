"""Unique ADMS device serials (M7).

Revision ID: e7f8a9b0c1d2
Revises: c3d4e5f6a7b8 (the ADMS-line tip; the graph already has six heads,
so the coordinator must confirm production's actual head before this
migration is deployed — see ADMS_REST_FIXES notes. Deploy last.)

Adds a partial unique index on (connector_type, device_serial) for
adms_direct rows with a non-null serial, matching the model index
``uq_rrr_integration_adms_serial``. Other connector types sharing
rrr_integrations are unaffected.

Duplicate handling — report, never silently delete: upgrade() first
queries for duplicate adms_direct serials and ABORTS (raising with the
offending serials listed) if any exist. A human must resolve duplicates
(reassign or retire the wrong integration) before re-running; no row is
deleted or merged by this migration.
"""
from alembic import op
import sqlalchemy as sa

revision = "e7f8a9b0c1d2"
down_revision = "c3d4e5f6a7b8"

_INDEX = "uq_rrr_integration_adms_serial"
_WHERE = "connector_type = 'adms_direct' AND device_serial IS NOT NULL"


def upgrade():
    conn = op.get_bind()
    duplicates = conn.execute(
        sa.text(
            "SELECT device_serial, COUNT(*) AS n FROM rrr_integrations "
            "WHERE connector_type = 'adms_direct' AND device_serial IS NOT NULL "
            "GROUP BY device_serial HAVING COUNT(*) > 1"
        )
    ).fetchall()
    if duplicates:
        serials = ", ".join(f"{row[0]} (x{row[1]})" for row in duplicates)
        raise RuntimeError(
            "Refusing to create unique ADMS serial index: duplicate "
            f"adms_direct serials exist: {serials}. Resolve the duplicates "
            "(reassign/retire the wrong integration) and re-run; this "
            "migration never deletes rows."
        )
    op.create_index(
        _INDEX,
        "rrr_integrations",
        ["connector_type", "device_serial"],
        unique=True,
        postgresql_where=sa.text(_WHERE),
        sqlite_where=sa.text(_WHERE),
    )


def downgrade():
    op.drop_index(_INDEX, table_name="rrr_integrations")
