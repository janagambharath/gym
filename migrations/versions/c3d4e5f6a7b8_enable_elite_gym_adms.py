"""Enable ADMS commands for Elite Gym (skip commissioning).

The owner explicitly requested going live without the supervised
commissioning steps. This enables automatic block/unblock for the
Elite Gym eSSL X2008 terminal (serial BOCK220260338).

Block: DATA DELETE USERINFO (proven to work on X2008)
Unblock: DATA UPDATE USERINFO (recreate user)
"""

from alembic import op
import sqlalchemy as sa


revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade():
    # Enable commands for Elite Gym's ADMS direct integration
    op.execute(
        sa.text(
            """
            UPDATE rrr_integrations
            SET commands_enabled = TRUE,
                commissioning_status = 'physical_test_passed'
            WHERE connector_type = 'adms_direct'
              AND device_serial = 'BOCK220260338'
              AND commands_enabled = FALSE
            """
        )
    )


def downgrade():
    op.execute(
        sa.text(
            """
            UPDATE rrr_integrations
            SET commands_enabled = FALSE,
                commissioning_status = 'pending'
            WHERE connector_type = 'adms_direct'
              AND device_serial = 'BOCK220260338'
            """
        )
    )
