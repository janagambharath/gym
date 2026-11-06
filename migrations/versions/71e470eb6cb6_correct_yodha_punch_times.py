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


def _assert_yodha_gym(conn):
    """Refuse to touch any rows unless gym ``GYM_ID`` is Yodha Fitness.

    ``GYM_ID`` is a hardcoded id; if the id mapping is ever wrong this
    guard — not the id — is what stops the migration rewriting another
    gym's punches. Raises before any UPDATE runs.
    """
    row = conn.execute(
        sa.text("SELECT name FROM gyms WHERE id = :gym_id"),
        {"gym_id": GYM_ID},
    ).fetchone()
    if row is None:
        raise RuntimeError(
            f"[yodha-punch-fix] refusing downgrade: no gym with id {GYM_ID}"
        )
    if row.name != "Yodha Fitness":
        raise RuntimeError(
            "[yodha-punch-fix] refusing downgrade: gym "
            f"{GYM_ID} is {row.name!r}, not 'Yodha Fitness'"
        )


# Tolerance for terminal/server clock skew when bounding the reverted
# value (see _is_revert_candidate). A genuinely wrong punch is the true
# punch time + SHIFT, and the true punch can never be after ingest, so
# the reverted value can never exceed received_at + SHIFT; 30 minutes
# of skew allowance covers a fast terminal clock.
_REVERT_UPPER_SLACK = timedelta(minutes=30)


def _is_revert_candidate(punch_time, received_at, cutoff):
    """Pure-Python mirror of the downgrade() selector below (same
    arithmetic, same constants) so the selector can be unit-tested
    without a live Postgres database.

    A row is a revert candidate only if adding SHIFT back would
    reproduce a value ``upgrade()`` could have corrected: the reverted
    value must satisfy upgrade's own predicate (>= received_at + 4h)
    AND must lie inside the physically possible range for this bug
    (<= received_at + SHIFT + 30m skew — the true punch predates
    ingest, so the wrong value cannot exceed received_at + SHIFT).

    NOTE on the review's suggested predicate: the review text wrote
    ``punch_time - SHIFT >= received_at + 4h``. That is a sign error:
    post-upgrade rows hold ``punch_time = original - SHIFT``, so the
    original value is ``punch_time + SHIFT``. The minus form would
    require ``original >= received_at + 15h`` and select nothing — a
    silent no-op downgrade. The plus form below is the correct mirror.

    RESIDUAL LIMITATION (honest): upgrade() left no per-row marker, so
    no predicate can perfectly separate a corrected row from an
    untouched row whose punch was ingested < 1.5h after the punch
    (both sit at punch_time ~= received_at after upgrade). This
    selector narrows the blast radius from "every pre-cutoff row" to
    "rows whose current punch_time is within 1.5h before received_at
    (and not after received_at + 30m)" and is idempotent (a reverted
    row fails the upper bound on a second run), but an untouched
    small-lag row inside that window would still be shifted. If an
    exact reversal is ever required, restore from backup — do not
    widen this predicate.
    """
    if received_at >= cutoff:
        return False
    reverted = punch_time + SHIFT
    return (
        reverted >= received_at + timedelta(hours=4)
        and reverted <= received_at + SHIFT + _REVERT_UPPER_SLACK
    )


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
    # Guard first: never touch rows for the wrong gym.
    _assert_yodha_gym(conn)
    # Reverse ONLY rows upgrade() could have corrected. upgrade()
    # selected punch_time >= received_at + 4h and subtracted SHIFT, so
    # a corrected row now holds punch_time = original - SHIFT and the
    # original is punch_time + SHIFT. Select rows whose reverted value
    # satisfies upgrade's predicate, bounded above by the physically
    # possible wrong range (original <= received_at + SHIFT + 30m
    # skew). The upper bound is what makes this idempotent: after a
    # revert the row's punch_time IS the original (>= received_at +
    # 4h), so punch_time + SHIFT is >= received_at + 9h30m and the row
    # is never selected again. Rows upgrade() never touched AND rows
    # outside the window (e.g. a punch uploaded > 1.5h late, or any
    # row on a DB where upgrade() never ran) are left alone.
    # The old downgrade dropped the predicate entirely and shifted
    # EVERY pre-cutoff row (and shifted twice if run twice) — never
    # run that version.
    rows = conn.execute(
        sa.text(
            """
            SELECT id, device_serial, biometric_user_id, punch_time
            FROM rrr_attendance_events
            WHERE gym_id = :gym_id
              AND source = 'adms_direct'
              AND received_at < :cutoff
              AND punch_time + INTERVAL '5 hours 30 minutes'
                    >= received_at + INTERVAL '4 hours'
              AND punch_time + INTERVAL '5 hours 30 minutes'
                    <= received_at + INTERVAL '6 hours'
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
        # Same narrowed set as above (fixed_ids only): projections of
        # rows that were NOT reverted are left untouched, unlike the
        # old downgrade which shifted every pre-cutoff projection.
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
