"""Production audit fixes

Revision ID: 9d2b4f7e8a13
Revises: 6a9206cd7b66
Create Date: 2026-05-27 18:10:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "9d2b4f7e8a13"
down_revision = "6a9206cd7b66"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("gyms") as batch_op:
        batch_op.add_column(sa.Column("trial_ends_at", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("max_members", sa.Integer(), nullable=True))

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            UPDATE gyms
            SET trial_ends_at = DATE(created_at) + INTERVAL '14 days'
            WHERE subscription_status = 'trial' AND trial_ends_at IS NULL
            """
        )
    else:
        op.execute(
            """
            UPDATE gyms
            SET trial_ends_at = DATE(created_at, '+14 days')
            WHERE subscription_status = 'trial' AND trial_ends_at IS NULL
            """
        )

    with op.batch_alter_table("reminder_logs") as batch_op:
        batch_op.create_index(
            "ix_reminders_member_cycle", ["member_id", "cycle_end_date"], unique=False
        )
        batch_op.create_index(
            "ix_reminders_provider_message", ["provider_message_id"], unique=False
        )

    with op.batch_alter_table("members") as batch_op:
        batch_op.create_check_constraint(
            "ck_members_status",
            "status IN ('active', 'expired', 'paused', 'deleted')",
        )

    with op.batch_alter_table("payment_verifications") as batch_op:
        batch_op.create_check_constraint(
            "ck_payments_status",
            "status IN ('pending', 'verified', 'rejected')",
        )
        batch_op.create_check_constraint(
            "ck_payments_renewal_days",
            "renewal_days BETWEEN 1 AND 730",
        )

    with op.batch_alter_table("reminder_logs") as batch_op:
        batch_op.create_check_constraint(
            "ck_reminders_status",
            "status IN ('pending', 'sent', 'failed', 'skipped')",
        )

    with op.batch_alter_table("gyms") as batch_op:
        batch_op.create_check_constraint(
            "ck_gyms_status",
            "status IN ('active', 'suspended')",
        )

    with op.batch_alter_table("renewal_history") as batch_op:
        batch_op.create_check_constraint(
            "ck_renewal_dates",
            "new_end >= new_start",
        )


def downgrade():
    with op.batch_alter_table("renewal_history") as batch_op:
        batch_op.drop_constraint("ck_renewal_dates", type_="check")

    with op.batch_alter_table("gyms") as batch_op:
        batch_op.drop_constraint("ck_gyms_status", type_="check")

    with op.batch_alter_table("reminder_logs") as batch_op:
        batch_op.drop_constraint("ck_reminders_status", type_="check")

    with op.batch_alter_table("payment_verifications") as batch_op:
        batch_op.drop_constraint("ck_payments_renewal_days", type_="check")
        batch_op.drop_constraint("ck_payments_status", type_="check")

    with op.batch_alter_table("members") as batch_op:
        batch_op.drop_constraint("ck_members_status", type_="check")

    with op.batch_alter_table("reminder_logs") as batch_op:
        batch_op.drop_index("ix_reminders_provider_message")
        batch_op.drop_index("ix_reminders_member_cycle")

    with op.batch_alter_table("gyms") as batch_op:
        batch_op.drop_column("max_members")
        batch_op.drop_column("trial_ends_at")
