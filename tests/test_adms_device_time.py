"""Regression: device punch times must never be read as UTC.

Production incident 2026-11-05 (Yodha, gym with an invalid timezone
string): the terminal clock was correct (19:46 IST) but the app showed
punches at 01:04 / 01:09 AM the next day — exactly +5:30. Cause:
_parse_device_time fell back to treating the device's local wall-clock
time as UTC whenever ZoneInfo(gym_timezone) raised, so every punch was
stored 5.5h ahead and the feed added another 5:30 on display.

Fix: an invalid gym timezone falls back to Asia/Kolkata, never UTC.
The device is an Indian gym terminal; its local time is IST.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.adms.routes import _parse_device_time


def test_device_time_with_valid_timezone():
    parsed = _parse_device_time("2026-11-05 19:34:00", "Asia/Kolkata")
    assert parsed == datetime(2026, 11, 5, 14, 4, 0, tzinfo=timezone.utc)


def test_device_time_with_slash_format():
    parsed = _parse_device_time("2026/11/05 19:34:00", "Asia/Kolkata")
    assert parsed == datetime(2026, 11, 5, 14, 4, 0, tzinfo=timezone.utc)


def test_device_time_with_invalid_timezone_falls_back_to_ist():
    # "IST" is not a valid IANA name — ZoneInfo raises. The old code then
    # treated 19:34 local as 19:34 UTC; the feed displayed 01:04 next day.
    parsed = _parse_device_time("2026-11-05 19:34:00", "IST")
    assert parsed == datetime(2026, 11, 5, 14, 4, 0, tzinfo=timezone.utc)


def test_device_time_with_empty_timezone_falls_back_to_ist():
    parsed = _parse_device_time("2026-11-05 19:34:00", "")
    assert parsed == datetime(2026, 11, 5, 14, 4, 0, tzinfo=timezone.utc)


def test_device_time_garbage_returns_none():
    assert _parse_device_time("not-a-time", "Asia/Kolkata") is None
    assert _parse_device_time("", "Asia/Kolkata") is None
