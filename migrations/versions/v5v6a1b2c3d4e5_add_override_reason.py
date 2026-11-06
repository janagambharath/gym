"""Add override_reason to renewal_history and payment_verifications (V5-L16/V5-L17).

Owner-approved extra-days overrides are currently indistinguishable
from oversized errors: the override reason lives only in audit
metadata, so Date Repair flags the row ``oversized_renewal`` and
Apply can strip days the owner deliberately granted. Storing the
reason on the row lets the scan/corrector skip owner-approved rows.

The payment-side column carries the reason from create time through
verify time, so ``verify_payment`` can re-validate the plan-days rule
(V5-L17) while still honouring an override the owner already granted
at creation.

Revises: m3rg3v4fixall
"""

from alembic import op
import sqlalchemy as sa


revision = "v5v6a1b2c3d4e5"
down_revision = "m3rg3v4fixall"


def upgrade():
    from sqlalchemy import inspect

    conn = op.get_bind()
    inspector = inspect(conn)
    existing_renewals = {
        c["name"] for c in inspector.get_columns("renewal_history")
    }
    with op.batch_alter_table("renewal_history") as batch_op:
        if "override_reason" not in existing_renewals:
            batch_op.add_column(
                sa.Column("override_reason", sa.String(500), nullable=True)
            )
    existing_payments = {
        c["name"] for c in inspector.get_columns("payment_verifications")
    }
    with op.batch_alter_table("payment_verifications") as batch_op:
        if "override_reason" not in existing_payments:
            batch_op.add_column(
                sa.Column("override_reason", sa.String(500), nullable=True)
            )


def downgrade():
    from sqlalchemy import inspect

    conn = op.get_bind()
    inspector = inspect(conn)
    existing_renewals = {
        c["name"] for c in inspector.get_columns("renewal_history")
    }
    with op.batch_alter_table("renewal_history") as batch_op:
        if "override_reason" in existing_renewals:
            batch_op.drop_column("override_reason")
    existing_payments = {
        c["name"] for c in inspector.get_columns("payment_verifications")
    }
    with op.batch_alter_table("payment_verifications") as batch_op:
        if "override_reason" in existing_payments:
            batch_op.drop_column("override_reason")
