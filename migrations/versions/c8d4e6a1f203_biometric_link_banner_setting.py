"""Add gym-level preference for biometric ID dashboard reminder."""

from alembic import op
import sqlalchemy as sa


revision = "c8d4e6a1f203"
down_revision = "f7a8b9c0d1e2"


def upgrade():
    op.add_column(
        "gyms",
        sa.Column(
            "show_biometric_link_banner",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade():
    op.drop_column("gyms", "show_biometric_link_banner")
