"""Regression: Live Access must show the terminal ID for unmapped punches.

2026-11-06 (Arun): the Access feed showed only "Unknown Member" for
unmapped punches, so staff could not tell which terminal ID each row was.
The ADMS leg already sent biometric_user_id, but the AccessEvent leg only
sent device_enroll_number under that name — so clients keying on
biometric_user_id saw nothing for those rows.

Fix: _serialize_access_event now aliases device_enroll_number as
biometric_user_id, so both legs expose the ID under one key. The PWA
shows "Unknown · ID 103" and the Android feed shows
"Unknown Member · ID 103" for unmapped rows.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.extensions import db
from app.models.access_event import AccessEvent
from app.services.access_event_service import _serialize_access_event


def test_serialize_access_event_exposes_biometric_user_id(seed_gym):
    evt = AccessEvent(
        gym_id=seed_gym["gym"].id,
        member_id=None,
        member_name=None,
        event_type="ENTRY",
        direction="IN",
        event_timestamp=datetime.now(timezone.utc),
        device_enroll_number="103",
        source_event_id="rrr-attendance-1",
    )
    db.session.add(evt)
    db.session.commit()
    data = _serialize_access_event(evt)
    assert data["biometric_user_id"] == "103"
    assert data["device_enroll_number"] == "103"
    assert data["member_id"] is None
