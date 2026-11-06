"""Unit-style simulation for the fixed downgrade() of
71e470eb6cb6_correct_yodha_punch_times.py (V3-H6).

No live database: Postgres is not available in this VM, and the
migration SQL is Postgres-specific (INTERVAL / ANY). The selector
logic lives in the migration module as the pure function
``_is_revert_candidate`` — the exact mirror of the SQL predicate —
and these tests drive that function (plus ``_assert_yodha_gym`` via a
stub connection) over synthetic rows in post-upgrade state.

Rows are (punch_time, received_at) with received_at before CUTOFF
unless stated. All datetimes UTC.

WARNING (V4-M17) — NEVER run this migration's downgrade() on live
data. The bounded selector still admits every untouched correct row
ingested within 1.5h of its punch — the normal promptly-ingested case
— and shifts it +5.5h (plus its access_events projection). V3-H6
narrowed the blast radius; it did NOT make the downgrade safe. If an
exact reversal is ever required, restore from backup.
"""

from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path

import pytest

MIG = Path(__file__).resolve().parents[1] / (
    "migrations/versions/71e470eb6cb6_correct_yodha_punch_times.py"
)
_spec = importlib.util.spec_from_file_location("yodha_migration_71e470eb6cb6", MIG)
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)

UTC = timezone.utc
CUTOFF = datetime.fromisoformat(mig.CUTOFF)
SHIFT = mig.SHIFT  # 5h30m


def _row(punch, received):
    return {"punch_time": punch, "received_at": received}


def _candidate(row):
    return mig._is_revert_candidate(
        row["punch_time"], row["received_at"], CUTOFF
    )


def _apply_downgrade(rows):
    """Simulate downgrade()'s row loop using the real helpers: select
    candidates, shift them +SHIFT, recompute dedupe_key, return the
    reverted ids (the same ids downgrade() passes to the access_events
    reversal, so projections shift only for reverted rows)."""
    reverted_ids = []
    for row in rows:
        if _candidate(row):
            row["punch_time"] = row["punch_time"] + SHIFT
            row["dedupe_key"] = mig._dedupe_key(
                row.get("device_serial", ""),
                row["biometric_user_id"],
                row["punch_time"],
            )
            reverted_ids.append(row["id"])
    return reverted_ids


# --- the three required cases -------------------------------------------

def test_corrected_row_reverts_exactly_once():
    # True punch 09:50, received 10:00 (10 min lag). Pre-upgrade the
    # stored punch was 15:20 = received + 5h20m, so upgrade() corrected
    # it to 09:50. Downgrade must put back exactly 15:20.
    received = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
    row = {"id": 1, "device_serial": "CUB7262300144",
           "biometric_user_id": "42", **_row(
               datetime(2026, 11, 5, 9, 50, tzinfo=UTC), received)}
    assert _candidate(row) is True
    reverted = _apply_downgrade([row])
    assert reverted == [1]
    assert row["punch_time"] == datetime(2026, 11, 5, 15, 20, tzinfo=UTC)
    # Second run is a no-op: the reverted value fails the upper bound.
    assert _candidate(row) is False
    assert _apply_downgrade([row]) == []
    assert row["punch_time"] == datetime(2026, 11, 5, 15, 20, tzinfo=UTC)


def test_untouched_correct_row_is_not_shifted():
    # Correct row uploaded late (offline terminal): punched 07:00,
    # received 10:00 (3h lag). upgrade() never touched it (its stored
    # punch was never >= received + 4h). Downgrade must leave it alone.
    received = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
    row = {"id": 2, "device_serial": "CUB7262300144",
           "biometric_user_id": "43", **_row(
               datetime(2026, 11, 5, 7, 0, tzinfo=UTC), received)}
    assert _candidate(row) is False
    assert _apply_downgrade([row]) == []
    assert row["punch_time"] == datetime(2026, 11, 5, 7, 0, tzinfo=UTC)


def test_downgrade_twice_is_noop_second_time():
    received = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
    rows = [
        {"id": 1, "device_serial": "S", "biometric_user_id": "42", **_row(
            datetime(2026, 11, 5, 9, 50, tzinfo=UTC), received)},
        {"id": 2, "device_serial": "S", "biometric_user_id": "43", **_row(
            datetime(2026, 11, 5, 7, 0, tzinfo=UTC), received)},
    ]
    assert _apply_downgrade(rows) == [1]
    assert _apply_downgrade(rows) == []
    assert rows[0]["punch_time"] == datetime(2026, 11, 5, 15, 20, tzinfo=UTC)
    assert rows[1]["punch_time"] == datetime(2026, 11, 5, 7, 0, tzinfo=UTC)


# --- guardrails ----------------------------------------------------------

def test_old_over_broad_selector_is_gone():
    # The old downgrade selected every pre-cutoff row (cutoff only).
    # A row far outside the window must not be a candidate even though
    # it is pre-cutoff: punched 2026-11-04 08:00, received 10:00.
    received = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
    row = _row(datetime(2026, 11, 4, 8, 0, tzinfo=UTC), received)
    assert _candidate(row) is False


def test_post_cutoff_rows_never_reverted():
    received = datetime(2026, 11, 5, 15, 0, tzinfo=UTC)  # after CUTOFF
    row = _row(datetime(2026, 11, 5, 14, 50, tzinfo=UTC), received)
    assert _candidate(row) is False


def test_downgrade_on_never_upgraded_db_is_noop():
    # Rows still in their wrong pre-upgrade state (punch = received +
    # 5h30m) fail the upper bound — downgrade only reverts rows
    # upgrade() already corrected, it never (re-)shifts wrong rows.
    received = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
    row = _row(datetime(2026, 11, 5, 15, 30, tzinfo=UTC), received)
    assert _candidate(row) is False


def test_access_events_follow_only_reverted_ids():
    # The access_events reversal takes fixed_ids from the same
    # selection, so projections of untouched rows must not move.
    received = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
    events = {1: datetime(2026, 11, 5, 9, 50, tzinfo=UTC),
              2: datetime(2026, 11, 5, 7, 0, tzinfo=UTC)}
    rows = [
        {"id": 1, "device_serial": "S", "biometric_user_id": "42", **_row(
            datetime(2026, 11, 5, 9, 50, tzinfo=UTC), received)},
        {"id": 2, "device_serial": "S", "biometric_user_id": "43", **_row(
            datetime(2026, 11, 5, 7, 0, tzinfo=UTC), received)},
    ]
    reverted = _apply_downgrade(rows)
    for eid, ts in events.items():
        if eid in reverted:
            events[eid] = ts + SHIFT
    assert events[1] == datetime(2026, 11, 5, 15, 20, tzinfo=UTC)
    assert events[2] == datetime(2026, 11, 5, 7, 0, tzinfo=UTC)


def test_downgrade_sql_has_bounded_mirror_predicate():
    import inspect

    src = inspect.getsource(mig.downgrade)
    assert "punch_time + INTERVAL '5 hours 30 minutes'" in src
    assert "received_at + INTERVAL '4 hours'" in src
    assert "received_at + INTERVAL '6 hours'" in src
    assert "_assert_yodha_gym(conn)" in src


# --- gym guard ------------------------------------------------------------

class _StubConn:
    def __init__(self, name):
        self._name = name

    def execute(self, *args, **kwargs):
        class _Row:
            name = self._name

        class _Result:
            def fetchone(self_inner):
                return _Row() if self._name is not None else None

        return _Result()


def test_gym_guard_accepts_yodha_fitness():
    mig._assert_yodha_gym(_StubConn("Yodha Fitness"))  # must not raise


def test_gym_guard_refuses_wrong_gym():
    with pytest.raises(RuntimeError, match="not 'Yodha Fitness'"):
        mig._assert_yodha_gym(_StubConn("Arun Fitness"))


def test_gym_guard_refuses_missing_gym():
    with pytest.raises(RuntimeError, match="no gym with id 3"):
        mig._assert_yodha_gym(_StubConn(None))


# --- documented residual limitation --------------------------------------

def test_residual_small_lag_untouched_row_is_indistinguishable():
    """DOCUMENTED RESIDUAL, not a bug in the selector: upgrade() left
    no per-row marker, so an untouched correct row punched < 1.5h
    before ingest sits at exactly the same (punch_time, received_at)
    as a corrected row and this predicate selects it. The window is
    now bounded (was: every pre-cutoff row); exact reversal needs a
    backup restore, not a wider predicate.

    V4-M17: this is the normal promptly-ingested case, not an edge
    case — NEVER run downgrade() on live data.
    """
    received = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
    untouched_small_lag = _row(
        datetime(2026, 11, 5, 9, 50, tzinfo=UTC), received)
    assert _candidate(untouched_small_lag) is True
