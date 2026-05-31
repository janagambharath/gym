"""Add per-gym WhatsApp settings and member opt-in

Revision ID: c4e7a1b2d903
Revises: 9d2b4f7e8a13
Create Date: 2026-05-31 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "c4e7a1b2d903"
down_revision = "9d2b4f7e8a13"
branch_labels = None
depends_on = None


DEFAULT_WELCOME_TEMPLATE = (
    "Hi {{ member_name }}, welcome to {{ gym_name }}. "
    "You are now opted in for WhatsApp membership updates."
)
DEFAULT_RENEWAL_TEMPLATE = (
    "Hi {{ member_name }}, your {{ gym_name }} membership expires on "
    "{{ expiry_date }}. You have {{ days_left }} day(s) left. "
    "Please complete payment using the attached QR image."
)


def upgrade():
    with op.batch_alter_table("gyms") as batch_op:
        batch_op.add_column(sa.Column("phone_number_id", sa.String(length=255), nullable=True))
        batch_op.add_column(
            sa.Column("business_phone_number", sa.String(length=40), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "whatsapp_enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(
            sa.Column(
                "welcome_message_template",
                sa.Text(),
                nullable=False,
                server_default=DEFAULT_WELCOME_TEMPLATE,
            )
        )
        batch_op.add_column(
            sa.Column(
                "renewal_reminder_template",
                sa.Text(),
                nullable=False,
                server_default=DEFAULT_RENEWAL_TEMPLATE,
            )
        )
        batch_op.create_index("ix_gyms_phone_number_id", ["phone_number_id"], unique=True)
        batch_op.create_index(
            "ix_gyms_business_phone_number",
            ["business_phone_number"],
            unique=True,
        )

    bind = op.get_bind()
    gym_rows = bind.execute(sa.text("SELECT id FROM gyms")).fetchall()
    for gym_row in gym_rows:
        template_row = bind.execute(
            sa.text(
                """
                SELECT message_body
                FROM notification_templates
                WHERE gym_id = :gym_id
                  AND trigger = 'expiry_reminder'
                  AND channel = 'whatsapp'
                  AND is_active = true
                ORDER BY days_before ASC, id DESC
                LIMIT 1
                """
            ),
            {"gym_id": gym_row.id},
        ).first()
        if template_row:
            bind.execute(
                sa.text(
                    """
                    UPDATE gyms
                    SET renewal_reminder_template = :message_body
                    WHERE id = :gym_id
                    """
                ),
                {"gym_id": gym_row.id, "message_body": template_row.message_body},
            )

    with op.batch_alter_table("members") as batch_op:
        batch_op.add_column(
            sa.Column(
                "whatsapp_opted_in",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(
            sa.Column("whatsapp_opted_in_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.create_index(
            "ix_members_gym_whatsapp_opted_in",
            ["gym_id", "whatsapp_opted_in"],
            unique=False,
        )


def downgrade():
    with op.batch_alter_table("members") as batch_op:
        batch_op.drop_index("ix_members_gym_whatsapp_opted_in")
        batch_op.drop_column("whatsapp_opted_in_at")
        batch_op.drop_column("whatsapp_opted_in")

    with op.batch_alter_table("gyms") as batch_op:
        batch_op.drop_index("ix_gyms_business_phone_number")
        batch_op.drop_index("ix_gyms_phone_number_id")
        batch_op.drop_column("renewal_reminder_template")
        batch_op.drop_column("welcome_message_template")
        batch_op.drop_column("whatsapp_enabled")
        batch_op.drop_column("business_phone_number")
        batch_op.drop_column("phone_number_id")
