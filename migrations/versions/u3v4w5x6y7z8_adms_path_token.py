"""Add per-integration ADMS path token (serial-only auth hardening).

Revises: t7v8w9x0y1z2
"""
from alembic import op
import sqlalchemy as sa

revision = "u3v4w5x6y7z8"
down_revision = "t7v8w9x0y1z2"


def upgrade():
    op.add_column(
        "rrr_integrations",
        sa.Column("adms_path_token", sa.String(64), nullable=True, unique=True),
    )
    op.create_index(
        "ix_rrr_integrations_adms_path_token",
        "rrr_integrations",
        ["adms_path_token"],
        unique=True,
    )


def downgrade():
    op.drop_index("ix_rrr_integrations_adms_path_token", table_name="rrr_integrations")
    op.drop_column("rrr_integrations", "adms_path_token")
