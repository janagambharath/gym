"""Add consumed_handshake_tokens for single-use handshake token replay protection.

Revises: v4w5x6y7z8a9
"""
from alembic import op
import sqlalchemy as sa


revision = "w5x6y7z8a9b0"
down_revision = "v4w5x6y7z8a9"


def upgrade():
    op.create_table(
        "consumed_handshake_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("purpose", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_consumed_handshake_tokens_token_hash",
        "consumed_handshake_tokens",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_consumed_handshake_tokens_user_id",
        "consumed_handshake_tokens",
        ["user_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        "ix_consumed_handshake_tokens_user_id", table_name="consumed_handshake_tokens"
    )
    op.drop_index(
        "ix_consumed_handshake_tokens_token_hash",
        table_name="consumed_handshake_tokens",
    )
    op.drop_table("consumed_handshake_tokens")
