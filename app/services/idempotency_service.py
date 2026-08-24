"""Helpers for replay-safe mobile API mutations."""
from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

from app.models.mobile_idempotency import MobileIdempotencyKey


def request_fingerprint(payload: dict[str, Any]) -> str:
    """Return a stable hash without persisting request values themselves."""

    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def valid_key(value: str | None) -> str | None:
    """Normalize a client retry key, rejecting unbounded/unusable values."""

    key = (value or "").strip()
    if not key:
        return None
    if len(key) > 128:
        return ""
    return key


def find_replay(
    *, gym_id: int, user_id: int, scope: str, key: str, request_hash: str
) -> tuple[MobileIdempotencyKey | None, bool]:
    """Return an existing record and whether its payload matches this request."""

    record = MobileIdempotencyKey.query.filter_by(
        gym_id=gym_id,
        user_id=user_id,
        scope=scope,
        key=key,
    ).one_or_none()
    if record is None:
        return None, True
    return record, hmac.compare_digest(record.request_hash, request_hash)
