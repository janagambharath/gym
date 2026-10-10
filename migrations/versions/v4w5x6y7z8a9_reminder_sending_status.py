"""Allow 'sending' reminder status for outbox-lite send guard.

Revises: u3v4w5x6y7z8
"""
from alembic import op

revision = "v4w5x6y7z8a9"
down_revision = "u3v4w5x6y7z8"


def upgrade():
    with op.batch_alter_table("reminder_logs") as batch_op:
        batch_op.drop_constraint("ck_reminders_status", type_="check")
        batch_op.create_check_constraint(
            "ck_reminders_status",
            "status IN ('pending', 'sending', 'sent', 'failed', 'skipped')",
        )


def downgrade():
    with op.batch_alter_table("reminder_logs") as batch_op:
        batch_op.drop_constraint("ck_reminders_status", type_="check")
        batch_op.create_check_constraint(
            "ck_reminders_status",
            "status IN ('pending', 'sent', 'failed', 'skipped')",
        )
