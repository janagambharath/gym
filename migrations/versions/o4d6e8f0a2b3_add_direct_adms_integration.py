"""Allow a direct terminal-to-cloud ADMS integration.

Revision ID: o4d6e8f0a2b3
Revises: n3c5d7e9f1a2
"""
from alembic import op


revision = "o4d6e8f0a2b3"
down_revision = "n3c5d7e9f1a2"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("rrr_integrations") as batch:
        batch.drop_constraint("ck_rrr_integration_type", type_="check")
        batch.create_check_constraint(
            "ck_rrr_integration_type",
            "connector_type IN ('ebioserver', 'direct_bridge', 'adms_direct', 'csv')",
        )


def downgrade():
    with op.batch_alter_table("rrr_integrations") as batch:
        batch.drop_constraint("ck_rrr_integration_type", type_="check")
        batch.create_check_constraint(
            "ck_rrr_integration_type",
            "connector_type IN ('ebioserver', 'direct_bridge', 'csv')",
        )
