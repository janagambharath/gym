"""Strict membership-date rules (the Yodha lesson, in code).

Root cause this closes: owners renewed by hand-editing end dates, and
the Android Record Payment flow accepted any free-typed renewal-days
value (1-730), so stored ends drifted off the plan grid with no
renewal history to repair them from.

Two conventions already exist in the codebase for one plan period:

- renewal flow: ``new_end = new_start + renewal_days - 1``
  (a 30-day renewal spans 29 days between start and end);
- creation / date-repair proposal: ``end = start + duration``
  (a 30-day period spans 30 days between start and end).

Both are treated as on-grid here (tolerance of one day). Anything
outside that band is rejected, not warned — the old warning is what
let bad dates in.

Deliberate exceptions, kept narrow and audited:

- A renewal/payment with days != plan duration is rejected unless
  the caller is the gym owner AND supplies a non-empty override
  reason (a genuine exception, e.g. a freeze extension). The reason
  is stored in the audit metadata so it can be reviewed later.
- Old hand-pushed ends are NEVER auto-corrected by this module.
  Date Repair flags them review-only; an owner must explicitly
  confirm (see ``date_repair`` confirm endpoint) that no extra paid
  time exists before the expected end is written.
- A future start is not rejected at create time: it can be a
  legitimate pre-registration, and the date-repair scan already
  flags it review-only instead of guessing.
"""
from __future__ import annotations

from datetime import date as _date
from datetime import timedelta


def computed_end(start: _date, duration_days: int) -> _date:
    """End of one plan period under the renewal convention."""
    return start + timedelta(days=duration_days - 1)


def grid_error(start: _date | None, end: _date | None, duration_days: int | None) -> str | None:
    """Return an error string when a start/end pair is off-grid, else None.

    Only fires when all three inputs are known. End-before-start is
    always an error. An on-grid span is ``duration - 1`` or ``duration``
    days between start and end (the two existing conventions above).
    """
    if start is None or end is None or duration_days is None:
        return None
    if duration_days <= 0:
        return "Plan duration must be positive."
    if end < start:
        return "membership_end must be on or after membership_start."
    span = (end - start).days
    if span not in (duration_days - 1, duration_days):
        return (
            f"membership_end is off the plan grid: a {duration_days}-day "
            f"plan starting {start.isoformat()} must end on "
            f"{computed_end(start, duration_days).isoformat()} or "
            f"{(start + timedelta(days=duration_days)).isoformat()}, "
            f"not {end.isoformat()}."
        )
    return None


def plan_days_error(
    renewal_days: int | None,
    duration_days: int | None,
    *,
    override_reason: str | None,
    is_owner: bool,
) -> str | None:
    """Return an error string when renewal days break the plan, else None.

    ``renewal_days`` of None means "use the plan duration" and is
    always fine. A value equal to the plan duration is fine. Anything
    else needs an owner + a reason; staff and reason-less requests are
    rejected outright.
    """
    if renewal_days is None or duration_days is None:
        return None
    if renewal_days == duration_days:
        return None
    if not is_owner:
        return (
            f"renewal_days must equal the plan duration "
            f"({duration_days} days). Only the gym owner can override "
            "this, with a reason."
        )
    if not (override_reason or "").strip():
        return (
            f"renewal_days ({renewal_days}) differs from the plan "
            f"duration ({duration_days} days). Supply override_reason "
            "explaining the exception."
        )
    return None
