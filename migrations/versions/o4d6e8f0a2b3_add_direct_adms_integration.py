"""Allow a direct terminal-to-cloud ADMS integration.

Revision ID: o4d6e8f0a2b3
Revises: n3c5d7e9f1a2
"""
from alembic import op
import sqlalchemy as sa


revision = "o4d6e8f0a2b3"
down_revision = "n3c5d7e9f1a2"
branch_labels = None
depends_on = None


def upgrade():
    # Older production revisions created this table before the model-level
    # check constraint was added, so the constraint may not exist at all.
    # Inspect first rather than failing the whole Railway pre-deploy step.
    checks = {
        item.get("name")
        for item in sa.inspect(op.get_bind()).get_check_constraints("rrr_integrations")
    }
    with op.batch_alter_table("rrr_integrations") as batch:
        if "ck_rrr_integration_type" in checks:
            batch.drop_constraint("ck_rrr_integration_type", type_="check")
        batch.create_check_constraint(
            "ck_rrr_integration_type",
            "connector_type IN ('ebioserver', 'direct_bridge', 'adms_direct', 'csv')",
        )


def downgrade():
    checks = {
        item.get("name")
        for item in sa.inspect(op.get_bind()).get_check_constraints("rrr_integrations")
    }
    with op.batch_alter_table("rrr_integrations") as batch:
        if "ck_rrr_integration_type" in checks:
            batch.drop_constraint("ck_rrr_integration_type", type_="check")
        batch.create_check_constraint(
            "ck_rrr_integration_type",
            "connector_type IN ('ebioserver', 'direct_bridge', 'csv')",
        )
