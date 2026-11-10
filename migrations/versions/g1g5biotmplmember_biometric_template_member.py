"""Add member_id to rrr_biometric_templates (gaps G1–G5, G4).

G4 fingerprint restore needs a same-member anchor: the V6-L9 hazard is
restoring a previous holder's fingerprint onto a recycled enroll number,
and the enroll number alone cannot prove the template still belongs to
the member who now holds it. The capture path stamps the resolved
member id here; the restore path requires it to match the member the
enroll resolves to at queue time AND at serve time. Rows captured
before this column existed keep NULL and are never restored
(fail-closed).

SQLite-safe add-column; downgrade drops it (no-op if absent).

Revises: v11backendfixall
"""

from alembic import op
import sqlalchemy as sa


revision = "g1g5biotmplmember"
down_revision = "v11backendfixall"


def upgrade():
    from sqlalchemy import inspect

    conn = op.get_bind()
    inspector = inspect(conn)
    existing = {c["name"] for c in inspector.get_columns("rrr_biometric_templates")}
    with op.batch_alter_table("rrr_biometric_templates") as batch_op:
        if "member_id" not in existing:
            batch_op.add_column(
                sa.Column("member_id", sa.Integer(), nullable=True)
            )
            batch_op.create_index(
                "ix_rrr_biometric_templates_member_id",
                ["member_id"],
            )


def downgrade():
    from sqlalchemy import inspect

    conn = op.get_bind()
    inspector = inspect(conn)
    existing = {c["name"] for c in inspector.get_columns("rrr_biometric_templates")}
    with op.batch_alter_table("rrr_biometric_templates") as batch_op:
        if "member_id" in existing:
            batch_op.drop_index("ix_rrr_biometric_templates_member_id")
            batch_op.drop_column("member_id")
