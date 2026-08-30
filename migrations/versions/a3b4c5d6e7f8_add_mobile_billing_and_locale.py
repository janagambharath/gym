"""Add mobile billing entitlement, locale, and WhatsApp setup state.

Revision ID: a3b4c5d6e7f8
Revises: f2a1b3c4d5e7
Create Date: 2026-08-30 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "a3b4c5d6e7f8"
down_revision = "f2a1b3c4d5e7"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("gyms") as batch_op:
        batch_op.add_column(sa.Column("country", sa.String(length=2), nullable=False, server_default="IN"))
        batch_op.add_column(sa.Column("currency", sa.String(length=3), nullable=False, server_default="INR"))
        batch_op.add_column(sa.Column("billing_source", sa.String(length=32), nullable=False, server_default="MANUAL"))
        batch_op.add_column(sa.Column("billing_plan_id", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("billing_plan_name", sa.String(length=160), nullable=True))
        batch_op.add_column(sa.Column("billing_started_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("billing_renews_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("billing_expires_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("billing_grace_period_end", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("whatsapp_connection_status", sa.String(length=32), nullable=False, server_default="NOT_CONNECTED"))
        batch_op.add_column(sa.Column("whatsapp_connection_error", sa.String(length=500), nullable=True))
        batch_op.create_index("ix_gyms_billing_source", ["billing_source"], unique=False)
        batch_op.create_index("ix_gyms_whatsapp_connection_status", ["whatsapp_connection_status"], unique=False)

    op.execute("""
        UPDATE gyms
        SET whatsapp_connection_status = CASE
            WHEN whatsapp_enabled = true AND phone_number_id IS NOT NULL THEN 'CONNECTED'
            ELSE 'NOT_CONNECTED'
        END
    """)

    op.create_table(
        "google_play_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gym_id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=True),
        sa.Column("product_id", sa.String(length=160), nullable=False),
        sa.Column("purchase_token_hash", sa.String(length=64), nullable=False),
        sa.Column("purchase_token_encrypted", sa.Text(), nullable=True),
        sa.Column("order_id", sa.String(length=160), nullable=True),
        sa.Column("state", sa.String(length=32), nullable=False, server_default="PENDING"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("renews_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("grace_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("external_account_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gym_id"], ["gyms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("purchase_token_hash"),
        sa.UniqueConstraint("order_id"),
    )
    op.create_index("ix_google_play_subscriptions_gym_id", "google_play_subscriptions", ["gym_id"], unique=False)
    op.create_index("ix_google_play_subscriptions_owner_id", "google_play_subscriptions", ["owner_id"], unique=False)
    op.create_index("ix_google_play_subscriptions_product_id", "google_play_subscriptions", ["product_id"], unique=False)
    op.create_index("ix_google_play_subscriptions_state", "google_play_subscriptions", ["state"], unique=False)
    op.create_index("ix_google_play_subscriptions_external_account_id", "google_play_subscriptions", ["external_account_id"], unique=False)


def downgrade():
    op.drop_index("ix_google_play_subscriptions_external_account_id", table_name="google_play_subscriptions")
    op.drop_index("ix_google_play_subscriptions_state", table_name="google_play_subscriptions")
    op.drop_index("ix_google_play_subscriptions_product_id", table_name="google_play_subscriptions")
    op.drop_index("ix_google_play_subscriptions_owner_id", table_name="google_play_subscriptions")
    op.drop_index("ix_google_play_subscriptions_gym_id", table_name="google_play_subscriptions")
    op.drop_table("google_play_subscriptions")
    with op.batch_alter_table("gyms") as batch_op:
        batch_op.drop_index("ix_gyms_whatsapp_connection_status")
        batch_op.drop_index("ix_gyms_billing_source")
        batch_op.drop_column("whatsapp_connection_error")
        batch_op.drop_column("whatsapp_connection_status")
        batch_op.drop_column("billing_grace_period_end")
        batch_op.drop_column("billing_expires_at")
        batch_op.drop_column("billing_renews_at")
        batch_op.drop_column("billing_started_at")
        batch_op.drop_column("billing_plan_name")
        batch_op.drop_column("billing_plan_id")
        batch_op.drop_column("billing_source")
        batch_op.drop_column("currency")
        batch_op.drop_column("country")
