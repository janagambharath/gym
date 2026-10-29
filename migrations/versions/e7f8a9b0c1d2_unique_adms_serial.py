"""Unique ADMS device serials (M7) — HELD, intentionally a no-op.

Revision ID: e7f8a9b0c1d2
Revises: c3d4e5f6a7b8

WHY THIS IS A NO-OP
-------------------
This migration is the DB-level enforcement of the one-machine-one-gym
rule (partial unique index on (connector_type, device_serial) for
adms_direct rows). Per ADMS_FIXES_REPORT.md §8.2 it is HELD until
Bharath decides the one-machine-one-gym rule AND a prod
duplicate-serial check passes.

It cannot simply be deleted from this directory: the deploy pipeline
(`github push-files` snapshot pushes) does not support deletions, so a
deleted file would linger on GitHub main and still be applied by
`alembic upgrade heads`. A no-op with the same revision id keeps the
migration graph valid, lets alembic stamp it as applied, and guarantees
it changes nothing on any database.

The real implementation is preserved at
`migrations/held/e7f8a9b0c1d2_unique_adms_serial.py`.

TO ENABLE LATER (after Bharath's explicit yes on one-machine-one-gym):
do NOT re-activate this revision id — it will already be stamped as
applied on every database. Instead create a NEW migration (new revision
id, down_revision = current head) containing the duplicate check +
partial unique index from the held file, and run the prod
duplicate-serial check first (the implementation aborts listing
duplicates, never deletes rows).
"""
from alembic import op
import sqlalchemy as sa

revision = "e7f8a9b0c1d2"
down_revision = "c3d4e5f6a7b8"


def upgrade():
    # HELD — see module docstring. Intentionally changes nothing.
    return


def downgrade():
    # Nothing was ever applied by the held upgrade.
    return
