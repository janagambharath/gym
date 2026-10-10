"""Hash bridge v2 pairing codes at rest, shorten window to 10 minutes.

Revises: r7f9g0a1b2c3d
- Widens gym_deployments.pairing_code to hold a SHA-256 hex digest.
- One-way hashes any existing plaintext codes so in-flight pairings keep working.
- New codes are issued with a 10-minute expiry (see app/admin/routes.py).
"""
from alembic import op
import sqlalchemy as sa

revision = "s1t2u3v4w5x6"
down_revision = "r7f9g0a1b2c3d"


def upgrade():
    op.alter_column(
        "gym_deployments",
        "pairing_code",
        existing_type=sa.String(16),
        type_=sa.String(64),
        existing_nullable=True,
    )
    # Hash any existing plaintext codes in place (SHA-256 hex of the code).
    import hashlib

    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, pairing_code FROM gym_deployments "
            "WHERE pairing_code IS NOT NULL AND length(pairing_code) <= 16"
        )
    ).fetchall()
    for row_id, code in rows:
        digest = hashlib.sha256(code.encode("utf-8")).hexdigest()
        conn.execute(
            sa.text("UPDATE gym_deployments SET pairing_code = :d WHERE id = :i"),
            {"d": digest, "i": row_id},
        )


def downgrade():
    # Cannot recover plaintext codes; clear them.
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE gym_deployments SET pairing_code = NULL"))
    op.alter_column(
        "gym_deployments",
        "pairing_code",
        existing_type=sa.String(64),
        type_=sa.String(16),
        existing_nullable=True,
    )
