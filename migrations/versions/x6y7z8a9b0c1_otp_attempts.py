"""Add otp_attempts for server-side OTP brute-force protection.

Revises: w5x6y7z8a9b0
"""
from alembic import op
import sqlalchemy as sa


revision = "x6y7z8a9b0c1"
down_revision = "w5x6y7z8a9b0"


def upgrade():
    op.create_table(
        "otp_attempts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("challenge_hash", sa.String(length=128), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_otp_attempts_challenge_hash",
        "otp_attempts",
        ["challenge_hash"],
        unique=True,
    )


def downgrade():
    op.drop_index("ix_otp_attempts_challenge_hash", table_name="otp_attempts")
    op.drop_table("otp_attempts")
