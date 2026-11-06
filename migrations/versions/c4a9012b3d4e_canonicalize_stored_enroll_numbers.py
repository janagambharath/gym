"""Canonicalize stored zero-padded enroll numbers (V3-H3 / V3-L10 / V3-L13).

Members enrolled before ingest canonicalization (H7) can hold
``device_enroll_number`` values like ``"042"`` while every lookup,
mapping and punch carries the canonical ``"42"``. Exact-match checks
then miss the stored row: a second member can be linked to the same
canonical ID, punches attribute to the wrong member, and fingerprint
templates stored under the raw PIN are never found by the canonical
restore lookup.

This backfill strips leading zeros in place:

* ``members.device_enroll_number`` — the H3 root cause;
* ``rrr_biometric_templates.enroll_number`` — V3-L10 (restore lookup);
* ``rrr_identity_mappings.external_id`` — V3-L13 (snapshot/mapping
  agreement; mappings are created canonical today, but pre-fix rows
  can still carry leading zeros).

Only values that are all digits with a leading zero AND a non-zero
digit are touched (``^0+[1-9][0-9]*$``), so ``"0"`` / ``"00"`` /
non-numeric IDs are left alone. A row whose canonical form is already
held by another row under the same unique key is skipped rather than
updated — the unique constraint would reject the write, and the
canonical-compare code paths still resolve those rows correctly.

Postgres-only (like the Yodha punch-time migration): uses the ``~``
regex operator and ``ltrim``.

Revises: 71e470eb6cb6
"""
from alembic import op

revision = "c4a9012b3d4e"
down_revision = "71e470eb6cb6"


def upgrade():
    # members.device_enroll_number ("042" -> "42").
    op.execute(
        """
        UPDATE members m
        SET device_enroll_number = ltrim(m.device_enroll_number, '0')
        WHERE m.device_enroll_number ~ '^0+[1-9][0-9]*$'
          AND NOT EXISTS (
            SELECT 1 FROM members o
            WHERE o.gym_id = m.gym_id
              AND o.id <> m.id
              AND o.device_enroll_number = ltrim(m.device_enroll_number, '0')
          )
        """
    )
    # rrr_biometric_templates.enroll_number (V3-L10): templates stored
    # under a zero-padded PIN are invisible to the canonical restore
    # lookup. Guarded against uq_biometric_template
    # (gym_id, integration_id, enroll_number, finger_id).
    op.execute(
        """
        UPDATE rrr_biometric_templates t
        SET enroll_number = ltrim(t.enroll_number, '0')
        WHERE t.enroll_number ~ '^0+[1-9][0-9]*$'
          AND NOT EXISTS (
            SELECT 1 FROM rrr_biometric_templates o
            WHERE o.gym_id = t.gym_id
              AND o.integration_id = t.integration_id
              AND o.finger_id = t.finger_id
              AND o.id <> t.id
              AND o.enroll_number = ltrim(t.enroll_number, '0')
          )
        """
    )
    # rrr_identity_mappings.external_id (V3-L13): guarded against
    # uq_rrr_mapping_external (gym_id, external_id).
    op.execute(
        """
        UPDATE rrr_identity_mappings m
        SET external_id = ltrim(m.external_id, '0')
        WHERE m.external_id ~ '^0+[1-9][0-9]*$'
          AND NOT EXISTS (
            SELECT 1 FROM rrr_identity_mappings o
            WHERE o.gym_id = m.gym_id
              AND o.id <> m.id
              AND o.external_id = ltrim(m.external_id, '0')
          )
        """
    )


def downgrade():
    # No-op by design: stripping leading zeros is lossy — the original
    # padding cannot be reconstructed — and the canonical form is the
    # correct stored form going forward. Nothing depends on the padded
    # spelling after the code-side canonical-compare fixes.
    pass
