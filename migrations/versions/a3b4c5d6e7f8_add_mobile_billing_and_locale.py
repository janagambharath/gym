"""Add mobile billing entitlement, locale, and WhatsApp setup state.

Revision ID: a3b4c5d6e7f8
Revises: 5d6e7f8a9b0c
Create Date: 2026-08-30 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "a3b4c5d6e7f8"
down_revision = "5d6e7f8a9b0c"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_columns = {col["name"] for col in inspector.get_columns("gyms")}
    existing_indexes = {idx["name"] for idx in inspector.get_indexes("gyms")}
    existing_tables = set(inspector.get_table_names())

    with op.batch_alter_table("gyms") as batch_op:
        if "country" not in existing_columns:
            batch_op.add_column(sa.Column("country", sa.String(length=64), nullable=False, server_default="IN"))
        if "currency" not in existing_columns:
            batch_op.add_column(sa.Column("currency", sa.String(length=16), nullable=False, server_default="INR"))
        if "billing_source" not in existing_columns:
            batch_op.add_column(sa.Column("billing_source", sa.String(length=32), nullable=False, server_default="MANUAL"))
        if "billing_plan_id" not in existing_columns:
            batch_op.add_column(sa.Column("billing_plan_id", sa.String(length=120), nullable=True))
        if "billing_plan_name" not in existing_columns:
            batch_op.add_column(sa.Column("billing_plan_name", sa.String(length=160), nullable=True))
        if "billing_started_at" not in existing_columns:
            batch_op.add_column(sa.Column("billing_started_at", sa.DateTime(timezone=True), nullable=True))
        if "billing_renews_at" not in existing_columns:
            batch_op.add_column(sa.Column("billing_renews_at", sa.DateTime(timezone=True), nullable=True))
        if "billing_expires_at" not in existing_columns:
            batch_op.add_column(sa.Column("billing_expires_at", sa.DateTime(timezone=True), nullable=True))
        if "billing_grace_period_end" not in existing_columns:
            batch_op.add_column(sa.Column("billing_grace_period_end", sa.DateTime(timezone=True), nullable=True))
        if "whatsapp_connection_status" not in existing_columns:
            batch_op.add_column(sa.Column("whatsapp_connection_status", sa.String(length=32), nullable=False, server_default="NOT_CONNECTED"))
        if "whatsapp_connection_error" not in existing_columns:
            batch_op.add_column(sa.Column("whatsapp_connection_error", sa.String(length=500), nullable=True))
        if "ix_gyms_billing_source" not in existing_indexes:
            batch_op.create_index("ix_gyms_billing_source", ["billing_source"], unique=False)
        if "ix_gyms_whatsapp_connection_status" not in existing_indexes:
            batch_op.create_index("ix_gyms_whatsapp_connection_status", ["whatsapp_connection_status"], unique=False)

    op.execute("""
        UPDATE gyms
        SET whatsapp_connection_status = CASE
            WHEN whatsapp_enabled = true AND phone_number_id IS NOT NULL THEN 'CONNECTED'
            ELSE 'NOT_CONNECTED'
        END
    """)

    if "google_play_subscriptions" not in existing_tables:
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
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())
    existing_columns = {col["name"] for col in inspector.get_columns("gyms")}
    existing_indexes = {idx["name"] for idx in inspector.get_indexes("gyms")}

    if "google_play_subscriptions" in existing_tables:
        op.drop_table("google_play_subscriptions")

    with op.batch_alter_table("gyms") as batch_op:
        if "ix_gyms_whatsapp_connection_status" in existing_indexes:
            batch_op.drop_index("ix_gyms_whatsapp_connection_status")
        if "ix_gyms_billing_source" in existing_indexes:
            batch_op.drop_index("ix_gyms_billing_source")
        if "whatsapp_connection_error" in existing_columns:
            batch_op.drop_column("whatsapp_connection_error")
        if "whatsapp_connection_status" in existing_columns:
            batch_op.drop_column("whatsapp_connection_status")
        if "billing_grace_period_end" in existing_columns:
            batch_op.drop_column("billing_grace_period_end")
        if "billing_expires_at" in existing_columns:
            batch_op.drop_column("billing_expires_at")
        if "billing_renews_at" in existing_columns:
            batch_op.drop_column("billing_renews_at")
        if "billing_started_at" in existing_columns:
            batch_op.drop_column("billing_started_at")
        if "billing_plan_name" in existing_columns:
            batch_op.drop_column("billing_plan_name")
        if "billing_plan_id" in existing_columns:
            batch_op.drop_column("billing_plan_id")
        if "billing_source" in existing_columns:
            batch_op.drop_column("billing_source")
