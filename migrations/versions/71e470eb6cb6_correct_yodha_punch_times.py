"""Correct Yodha punch times stored 5.5h ahead (pre-fix ADMS parse bug).

Yodha's gym timezone is invalid, so _parse_device_time fell back to treating
device-local (IST) wall-clock time as UTC until 8a67843 made the fallback
Asia/Kolkata. Every Yodha ADMS punch ingested before that fix is stored
+5h30m ahead of reality, which puts those rows in the future relative to
new (correct) punches — the Live Access feed sorts by punch time, so the
wrong rows sit on top and bury the new ones.

This migration shifts exactly those rows back by 5h30m:
  * rrr_attendance_events (gym 3, source adms_direct) where the stored
    punch_time is implausibly ahead of received_at (>= 4h — a correct punch
    is never hours ahead of its ingest time), and
  * the matching access_events projections (source_event_id
    "rrr-attendance-<id>"), whose event_timestamp copies punch_time.
It also recomputes dedupe_key (sha256 of device_serial|biometric_user_id|
punch_time.isoformat()) so a future re-send of the same punch still
deduplicates instead of creating a duplicate row.

Revises: e3f4a5b6c7d8
"""

import hashlib
from datetime import timedelta

from alembic import op
import sqlalchemy as sa

revision = "71e470eb6cb6"
down_revision = "e3f4a5b6c7d8"

GYM_ID = 3  # Yodha Fitness
SHIFT = timedelta(hours=5, minutes=30)
# 8a67843 (punch-time fix) went live ~2026-11-05 14:23 UTC. Rows received
# before this were parsed by the buggy code; rows after are correct.
CUTOFF = "2026-11-05 14:25:00+00:00"


def _dedupe_key(device_serial, biometric_user_id, punch_time):
    stable = "|".join(
        (device_serial or "", biometric_user_id, punch_time.isoformat())
    )
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


def _wrong_rows(conn):
    """Rows that are demonstrably wrong: ADMS punches whose stored time is
    hours ahead of when the server received them."""
    return conn.execute(
        sa.text(
            """
            SELECT id, device_serial, biometric_user_id, punch_time
            FROM rrr_attendance_events
            WHERE gym_id = :gym_id
              AND source = 'adms_direct'
              AND received_at < :cutoff
              AND punch_time >= received_at + INTERVAL '4 hours'
            ORDER BY id
            """
        ),
        {"gym_id": GYM_ID, "cutoff": CUTOFF},
    ).fetchall()


def upgrade():
    conn = op.get_bind()
    rows = _wrong_rows(conn)
    fixed_ids = []
    for row in rows:
        new_punch = row.punch_time - SHIFT
        new_key = _dedupe_key(row.device_serial, row.biometric_user_id, new_punch)
        conn.execute(
            sa.text(
                """
                UPDATE rrr_attendance_events
                SET punch_time = :punch_time, dedupe_key = :dedupe_key
                WHERE id = :id
                """
            ),
            {"punch_time": new_punch, "dedupe_key": new_key, "id": row.id},
        )
        fixed_ids.append(row.id)
    if fixed_ids:
        conn.execute(
            sa.text(
                """
                UPDATE access_events
                SET event_timestamp = event_timestamp - INTERVAL '5 hours 30 minutes'
                WHERE gym_id = :gym_id
                  AND source_event_id = ANY(:source_ids)
                """
            ),
            {
                "gym_id": GYM_ID,
                "source_ids": [f"rrr-attendance-{i}" for i in fixed_ids],
            },
        )
    print(f"[yodha-punch-fix] corrected {len(fixed_ids)} attendance rows")


def downgrade():
    conn = op.get_bind()
    # Reverse the shift for the same pre-fix window. All Yodha ADMS rows in
    # this window were wrong (the invalid timezone predates the window), so
    # the received_at cutoff alone identifies the same set.
    rows = conn.execute(
        sa.text(
            """
            SELECT id, device_serial, biometric_user_id, punch_time
            FROM rrr_attendance_events
            WHERE gym_id = :gym_id
              AND source = 'adms_direct'
              AND received_at < :cutoff
            ORDER BY id
            """
        ),
        {"gym_id": GYM_ID, "cutoff": CUTOFF},
    ).fetchall()
    fixed_ids = []
    for row in rows:
        new_punch = row.punch_time + SHIFT
        new_key = _dedupe_key(row.device_serial, row.biometric_user_id, new_punch)
        conn.execute(
            sa.text(
                """
                UPDATE rrr_attendance_events
                SET punch_time = :punch_time, dedupe_key = :dedupe_key
                WHERE id = :id
                """
            ),
            {"punch_time": new_punch, "dedupe_key": new_key, "id": row.id},
        )
        fixed_ids.append(row.id)
    if fixed_ids:
        conn.execute(
            sa.text(
                """
                UPDATE access_events
                SET event_timestamp = event_timestamp + INTERVAL '5 hours 30 minutes'
                WHERE gym_id = :gym_id
                  AND source_event_id = ANY(:source_ids)
                """
            ),
            {
                "gym_id": GYM_ID,
                "source_ids": [f"rrr-attendance-{i}" for i in fixed_ids],
            },
        )
    print(f"[yodha-punch-fix] reverted {len(fixed_ids)} attendance rows")
