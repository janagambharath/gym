"""Recompute Yodha migrated punch dedupe keys into the new format (V5-L9).

The Yodha punch-time migration (71e470eb6cb6) recomputed ``dedupe_key``
from the STORED ``biometric_user_id`` verbatim, so a migrated row whose
pin was zero-padded (``"042"``) got an old-format key built on ``"042"``.
The live probe (``_legacy_dedupe_keys`` in ``app/services/rrr_service.py``)
only tries the CANONICAL id (``"42"``), so a re-send of that punch
misses and inserts a duplicate.

This migration recomputes ``dedupe_key`` for the rows the Yodha
migration touched (gym "Yodha Fitness", ``source='adms_direct'``,
``received_at`` before the 71e470eb6cb6 cutoff) into the current
new-format key — canonical serial (upper), canonical pin (leading
zeros stripped), punch time, direction — the exact key
``_dedupe_key`` computes at ingest. A re-send then hits the exact-key
check instead of relying on the legacy probe.

Scope notes:
* The gym is resolved BY NAME, not by hardcoded id, so the migration
  is a no-op (0 rows, printed) on any database where no gym is named
  "Yodha Fitness" — it never rewrites another gym's punches.
* Rows are selected in Python (received_at < cutoff) and keys are
  recomputed in Python, so the migration is dialect-safe (no
  Postgres-only INTERVAL/ANY/regex — the 71e470eb6cb6 file itself is
  not, see V6-M18). Safe to run on SQLite dev/test copies.
* Entry+exit punches in the same second keep DISTINCT keys because
  the direction is part of the new-format key. If two rows would
  collide on the recomputed key (true duplicates created pre-fix
  under different raw spellings), the second is SKIPPED and counted
  — never overwritten, never violating the unique constraint.
* Idempotent: a second run recomputes the same keys and reports
  0 updated.
* Downgrade is a deliberate no-op: the old keys mixed raw serial/pin
  spellings that cannot be reconstructed reliably, and the recompute
  is a pure dedupe-key normalization (punch times and attribution
  are untouched).

Revises: m3rg3v4fixall
"""

import hashlib
import logging
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "v5l9a1b2c3d4e"
down_revision = "m3rg3v4fixall"

log = logging.getLogger(__name__)

GYM_NAME = "Yodha Fitness"
# 8a67843 (punch-time fix) went live ~2026-11-05 14:23 UTC; the Yodha
# migration only touched rows received before this cutoff.
CUTOFF = datetime(2026, 11, 5, 14, 25, tzinfo=timezone.utc)


def _canonical_pin(value) -> str:
    """Canonical enroll number: digits -> leading zeros stripped."""
    text = str(value or "").strip()
    if text.isdigit():
        stripped = text.lstrip("0")
        return stripped if stripped else "0"
    return text


def _as_utc(value):
    """Coerce a stored timestamp to an aware UTC datetime.

    Postgres returns aware datetimes; SQLite returns naive ones (or
    ISO strings). Ingest always computed keys from aware UTC times,
    so a naive value is UTC.
    """
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _new_dedupe_key(device_serial, biometric_user_id, punch_time, direction) -> str:
    """Mirror of ``app.services.rrr_service._dedupe_key``."""
    stable = "|".join((
        (device_serial or "").strip().upper(),
        _canonical_pin(biometric_user_id),
        _as_utc(punch_time).isoformat(),
        str(direction or ""),
    ))
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


def _recompute(conn) -> dict:
    """Recompute dedupe keys for Yodha-migration rows. Returns counts."""
    counts = {"examined": 0, "updated": 0, "already_correct": 0, "skipped_collision": 0}
    gym = conn.execute(
        sa.text("SELECT id FROM gyms WHERE name = :name"),
        {"name": GYM_NAME},
    ).fetchone()
    if gym is None:
        print(f"[v5-l9] no gym named {GYM_NAME!r}; nothing to recompute")
        return counts
    gym_id = gym.id
    rows = conn.execute(
        sa.text(
            """
            SELECT id, device_serial, biometric_user_id, punch_time,
                   direction, received_at, dedupe_key
            FROM rrr_attendance_events
            WHERE gym_id = :gym_id AND source = 'adms_direct'
            ORDER BY id
            """
        ),
        {"gym_id": gym_id},
    ).fetchall()
    # Keys currently claimed by any row in scope (including rows past
    # the cutoff, whose keys are already new-format and must not be
    # clobbered by a recomputed collision).
    claimed: dict[str, int] = {}
    for row in rows:
        claimed.setdefault(row.dedupe_key, row.id)
    for row in rows:
        received_at = _as_utc(row.received_at)
        if received_at is None or received_at >= CUTOFF:
            continue
        counts["examined"] += 1
        target = _new_dedupe_key(
            row.device_serial, row.biometric_user_id, row.punch_time, row.direction
        )
        if target == row.dedupe_key:
            counts["already_correct"] += 1
            continue
        holder = claimed.get(target)
        if holder is not None and holder != row.id:
            counts["skipped_collision"] += 1
            log.warning(
                "[v5-l9] skipping rrr_attendance_events id=%s: recomputed "
                "dedupe_key already held by id=%s",
                row.id, holder,
            )
            continue
        conn.execute(
            sa.text(
                "UPDATE rrr_attendance_events SET dedupe_key = :key WHERE id = :id"
            ),
            {"key": target, "id": row.id},
        )
        claimed.pop(row.dedupe_key, None)
        claimed[target] = row.id
        counts["updated"] += 1
    print(
        "[v5-l9] recomputed Yodha dedupe keys: "
        f"examined={counts['examined']} updated={counts['updated']} "
        f"already_correct={counts['already_correct']} "
        f"skipped_collision={counts['skipped_collision']}"
    )
    return counts


def upgrade():
    conn = op.get_bind()
    _recompute(conn)


def downgrade():
    # Deliberate no-op (see module docstring): old keys mixed raw
    # serial/pin spellings and cannot be reconstructed reliably.
    print("[v5-l9] downgrade is a no-op (dedupe-key recompute is not reversed)")
