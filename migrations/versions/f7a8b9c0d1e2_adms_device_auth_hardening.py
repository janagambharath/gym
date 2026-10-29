"""ADMS device-auth hardening (batch #3): hash-only tokens, rotation, serial gate, salted secrets.

Revises: c3d4e5f6a7b8 (head of the ADMS chain at the time of writing).
NOTE on the repo's multi-head migration graph: this migration extends
only the ADMS chain. Before applying to production, the coordinator must
confirm the production database's actual head(s); do NOT rebase this
revision onto a different head without checking the ADMS chain first.

Upgrade (all nullable / backfilled — no flag day):
- rrr_integrations.adms_token_hash (+ unique index): SHA-256 of the
  existing plaintext adms_path_token, so already-commissioned devices
  keep authenticating via the token path after deploy.
- rrr_integrations.adms_path_token is then CLEARED: from this point
  tokens are stored as hashes only. The plaintext cannot be recovered
  from a downgrade — after a downgrade, re-provision/rotate to get a
  new token. Devices themselves are unaffected: they keep sending the
  same token, which now matches by hash.
- rrr_integrations.allow_serial_fallback: backfilled TRUE for existing
  adms_direct rows (legacy grace: Elite/Yodha-era terminals keep
  working on serial until re-commissioned) and FALSE for every other
  row. New rows default to FALSE at the model layer.
- rrr_integrations.adms_token_hash_prev / grace_until / version,
  rrr_integrations.pairing_code_salt, rrr_attendance_events.auth_method,
  bridge_installations.api_key_salt, gym_deployments.pairing_code_salt:
  new nullable columns; existing paired bridges and pairing codes keep
  working (NULL salt = legacy unsalted hash, still verified).
"""

import hashlib

from alembic import op
import sqlalchemy as sa

revision = "f7a8b9c0d1e2"
down_revision = "16912c2a3121"  # rebased at merge: batch 2 collapsed heads to 16912c2a3121


def upgrade():
    op.add_column("rrr_integrations", sa.Column("adms_token_hash", sa.String(64), nullable=True))
    op.add_column("rrr_integrations", sa.Column("adms_token_hash_prev", sa.String(64), nullable=True))
    op.add_column("rrr_integrations", sa.Column("adms_token_grace_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("rrr_integrations", sa.Column("adms_token_version", sa.Integer(), nullable=True))
    op.add_column("rrr_integrations", sa.Column("allow_serial_fallback", sa.Boolean(), nullable=True))
    op.add_column("rrr_integrations", sa.Column("pairing_code_salt", sa.String(32), nullable=True))
    op.add_column("rrr_attendance_events", sa.Column("auth_method", sa.String(16), nullable=True))
    op.add_column("bridge_installations", sa.Column("api_key_salt", sa.String(32), nullable=True))
    op.add_column("gym_deployments", sa.Column("pairing_code_salt", sa.String(32), nullable=True))
    op.create_index(
        "ix_rrr_integrations_adms_token_hash",
        "rrr_integrations",
        ["adms_token_hash"],
        unique=True,
    )

    conn = op.get_bind()
    # Backfill token hashes from plaintext tokens, then clear plaintext.
    rows = conn.execute(
        sa.text(
            "SELECT id, adms_path_token FROM rrr_integrations "
            "WHERE adms_path_token IS NOT NULL"
        )
    ).fetchall()
    for row_id, token in rows:
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        conn.execute(
            sa.text(
                "UPDATE rrr_integrations SET adms_token_hash = :d, "
                "adms_token_version = 1 WHERE id = :i"
            ),
            {"d": digest, "i": row_id},
        )
    conn.execute(sa.text("UPDATE rrr_integrations SET adms_path_token = NULL"))
    # Legacy grace: existing ADMS integrations keep serial fallback;
    # everything else (and all future rows, via the model default) is off.
    conn.execute(
        sa.text(
            "UPDATE rrr_integrations SET allow_serial_fallback = TRUE "
            "WHERE connector_type = 'adms_direct'"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE rrr_integrations SET allow_serial_fallback = FALSE "
            "WHERE allow_serial_fallback IS NULL"
        )
    )


def downgrade():
    op.drop_index("ix_rrr_integrations_adms_token_hash", table_name="rrr_integrations")
    op.drop_column("gym_deployments", "pairing_code_salt")
    op.drop_column("bridge_installations", "api_key_salt")
    op.drop_column("rrr_attendance_events", "auth_method")
    op.drop_column("rrr_integrations", "pairing_code_salt")
    op.drop_column("rrr_integrations", "allow_serial_fallback")
    op.drop_column("rrr_integrations", "adms_token_version")
    op.drop_column("rrr_integrations", "adms_token_grace_until")
    op.drop_column("rrr_integrations", "adms_token_hash_prev")
    op.drop_column("rrr_integrations", "adms_token_hash")
    # NOTE: adms_path_token plaintext was cleared by upgrade() and cannot
    # be recovered here. After a downgrade, owners must re-provision
    # ADMS integrations to obtain a new token.
