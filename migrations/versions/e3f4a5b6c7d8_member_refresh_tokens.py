"""Add rotating refresh tokens for member app sessions.

Revises: d9e2a6c7f104
"""
from alembic import op
import sqlalchemy as sa


revision = "e3f4a5b6c7d8"
down_revision = "d9e2a6c7f104"


def upgrade():
    op.create_table(
        "member_refresh_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("member_id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("family_id", sa.String(length=64), nullable=False),
        sa.Column("is_used", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_member_refresh_tokens_member_id", "member_refresh_tokens", ["member_id"])
    op.create_index("ix_member_refresh_tokens_gym_id", "member_refresh_tokens", ["gym_id"])
    op.create_index("ix_member_refresh_tokens_token_hash", "member_refresh_tokens", ["token_hash"], unique=True)
    op.create_index("ix_member_refresh_tokens_family_id", "member_refresh_tokens", ["family_id"])


def downgrade():
    op.drop_index("ix_member_refresh_tokens_family_id", table_name="member_refresh_tokens")
    op.drop_index("ix_member_refresh_tokens_token_hash", table_name="member_refresh_tokens")
    op.drop_index("ix_member_refresh_tokens_gym_id", table_name="member_refresh_tokens")
    op.drop_index("ix_member_refresh_tokens_member_id", table_name="member_refresh_tokens")
    op.drop_table("member_refresh_tokens")
