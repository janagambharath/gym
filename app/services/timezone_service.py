"""Timezone helpers for gym-local calendar business rules."""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timezone as tz
import zoneinfo


_logger = logging.getLogger(__name__)


def is_valid_timezone(value) -> bool:
    """True when *value* is a real IANA timezone name (V5-L19).

    The backend equivalent of the Android-side rejection: every
    write path that stores a gym timezone must validate with this
    before persisting, so a typo can never silently shift every
    tz-sensitive rule to the fallback.
    """
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        zoneinfo.ZoneInfo(value.strip())
    except Exception:
        return False
    return True


def _zone_for_gym(gym_timezone: str | None) -> zoneinfo.ZoneInfo:
    """Resolve a configured IANA timezone, with a safe product default."""
    try:
        return zoneinfo.ZoneInfo(gym_timezone or "Asia/Kolkata")
    except Exception:
        # V5-L19: never swallow this silently. A typo'd gym.timezone
        # used to shift today_for_gym by hours with no trace, moving
        # scheduled-renewal activation, auto-expiry, and every Date
        # Repair comparison. Log loudly so the bad stored value gets
        # fixed instead of silently mis-driving the gym.
        _logger.error(
            "Invalid gym timezone %r — falling back to Asia/Kolkata. "
            "Fix the stored gym timezone; every gym-local date rule "
            "is currently running on the fallback.",
            gym_timezone,
        )
        return zoneinfo.ZoneInfo("Asia/Kolkata")


def today_for_gym(gym_timezone: str | None, *, now: datetime | None = None) -> date:
    """Return the current calendar date in the gym's configured timezone.

    ``now`` is primarily useful for deterministic jobs and tests. Naive values
    are treated as UTC because persisted application timestamps are written in
    UTC.
    """
    current = now or datetime.now(tz=tz.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=tz.utc)
    return current.astimezone(_zone_for_gym(gym_timezone)).date()


def utc_start_of_gym_day(
    gym_timezone: str | None,
    *,
    local_date: date | None = None,
    now: datetime | None = None,
) -> datetime:
    """Return midnight of a gym-local date as an aware UTC datetime.

    Timestamped reports must use this boundary rather than comparing UTC
    timestamps with a server-local ``date`` value.
    """
    zone = _zone_for_gym(gym_timezone)
    target_date = local_date or today_for_gym(gym_timezone, now=now)
    return datetime.combine(target_date, time.min, tzinfo=zone).astimezone(tz.utc)
