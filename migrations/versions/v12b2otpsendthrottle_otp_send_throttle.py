"""Add otp_send_throttles table (V12-B2).

Member OTP sends had no per-phone throttle — only the 5/min/IP
limiter — so any phone could be flooded with OTP WhatsApps at
5/min indefinitely, each a paid template send. The new table
backs a per-phone cooldown (120s between sends) plus a daily
per-phone cap, mirroring the DB-backed OtpAttempt pattern from
the verify side (never in-memory state, so it survives
multi-worker deploys). It also stores the last issued challenge
so a repeat request inside the cooldown gets the SAME challenge
back with its remaining TTL instead of a fresh OTP + fresh send.

SQLite-safe create-table; downgrade drops it.

Revises: g1g5biotmplmember
"""

from alembic import op
import sqlalchemy as sa


revision = "v12b2otpsendthrottle"
down_revision = "g1g5biotmplmember"


def upgrade():
    op.create_table(
        "otp_send_throttles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("phone_hash", sa.String(length=128), nullable=False),
        sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_challenge", sa.Text(), nullable=True),
        sa.Column("challenge_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sends_today", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("day", sa.Date(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("phone_hash", name="uq_otp_send_throttles_phone_hash"),
    )
    op.create_index(
        "ix_otp_send_throttles_phone_hash", "otp_send_throttles", ["phone_hash"], unique=True
    )
    op.create_index("ix_otp_send_throttles_day", "otp_send_throttles", ["day"], unique=False)


def downgrade():
    op.drop_index("ix_otp_send_throttles_day", table_name="otp_send_throttles")
    op.drop_index("ix_otp_send_throttles_phone_hash", table_name="otp_send_throttles")
    op.drop_table("otp_send_throttles")
