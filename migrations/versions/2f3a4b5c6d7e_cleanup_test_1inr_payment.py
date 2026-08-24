"""Safely cleanup test 1 INR payment without affecting other records.

Revision ID: 2f3a4b5c6d7e
Revises: 1e5f6a7b8c9d
Create Date: 2026-08-24 18:45:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "2f3a4b5c6d7e"
down_revision = "1e5f6a7b8c9d"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    
    # 1. Find all 1 INR payments and rollback their renewal history if any
    try:
        results = bind.execute(
            sa.text("""
            SELECT p.id as payment_id, p.member_id, r.id as renewal_id, r.previous_end, r.new_end
            FROM payment_verifications p
            LEFT JOIN renewal_history r ON r.payment_verification_id = p.id
            WHERE p.amount = 1.00
            """)
        ).fetchall()

        for row in results:
            payment_id = row[0]
            member_id = row[1]
            renewal_id = row[2]
            prev_end = row[3]
            new_end = row[4]

            if renewal_id and prev_end:
                bind.execute(
                    sa.text("UPDATE members SET membership_end = :prev_end WHERE id = :member_id AND membership_end = :new_end"),
                    {"prev_end": prev_end, "member_id": member_id, "new_end": new_end}
                )
                bind.execute(
                    sa.text("DELETE FROM renewal_history WHERE id = :renewal_id"),
                    {"renewal_id": renewal_id}
                )

            bind.execute(
                sa.text("DELETE FROM payment_verifications WHERE id = :payment_id"),
                {"payment_id": payment_id}
            )
    except Exception:
        pass


def downgrade():
    pass
