"""Helpers for replay-safe mobile API mutations."""
from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

from flask import jsonify

from app.extensions import db
from app.mobile_api.errors import error_response
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


def begin_idempotency(
    *, gym_id: int, user_id: int, scope: str, headers, payload: dict[str, Any]
) -> tuple[str | None, str, Any]:
    """Read the Idempotency-Key header and check for a prior execution.

    Same mechanism as the original create_payment / direct_renewal /
    deactivate_member handlers (same table, same fingerprint, same
    409 semantics), factored so every mutating endpoint can reuse it
    without copying the block.

    Returns ``(key, request_hash, replay)``:
    - ``replay`` is ``None`` when the caller should proceed; on the
      success path it must call :func:`record_idempotency` and commit
      the record atomically with the mutation.
    - otherwise ``replay`` is the Flask response the view must return
      immediately: the stored success response for an identical retry,
      the IDEMPOTENCY_KEY_REUSED 409 for a key reused with a different
      payload, or the 400 for an over-long key.

    A request without a key proceeds exactly as before (``key`` is
    ``None``). Only success responses are recorded — validation and
    conflict failures never store a key, so a corrected retry works.
    """

    key = valid_key(headers.get("Idempotency-Key"))
    if key == "":
        return None, "", error_response(
            "VALIDATION_ERROR", "Idempotency-Key is too long.", 400
        )
    request_hash = request_fingerprint(payload)
    if not key:
        return None, request_hash, None
    existing, matches_request = find_replay(
        gym_id=gym_id,
        user_id=user_id,
        scope=scope,
        key=key,
        request_hash=request_hash,
    )
    if existing:
        if not matches_request:
            return key, request_hash, error_response(
                "IDEMPOTENCY_KEY_REUSED",
                "This idempotency key was already used for a different request.",
                409,
            )
        return key, request_hash, (jsonify(existing.response_body), existing.status_code)
    return key, request_hash, None


def record_idempotency(
    *,
    gym_id: int,
    user_id: int,
    scope: str,
    key: str | None,
    request_hash: str,
    status_code: int,
    response_body: dict[str, Any],
) -> None:
    """Stage the replay record in the current session (no-op without a key).

    The caller commits it atomically with the mutation. A concurrent
    retry that wins the unique-key race rolls the loser back; the loser
    then replays the winner via :func:`replay_after_conflict` instead
    of executing twice.
    """

    if not key:
        return
    db.session.add(
        MobileIdempotencyKey(
            gym_id=gym_id,
            user_id=user_id,
            scope=scope,
            key=key,
            request_hash=request_hash,
            status_code=status_code,
            response_body=response_body,
        )
    )


def replay_after_conflict(
    *, gym_id: int, user_id: int, scope: str, key: str | None, request_hash: str
):
    """After a commit IntegrityError, return the winner's replay response
    if this key lost the unique-key race, else ``None`` (caller re-raises).
    """

    if not key:
        return None
    existing, matches_request = find_replay(
        gym_id=gym_id,
        user_id=user_id,
        scope=scope,
        key=key,
        request_hash=request_hash,
    )
    if existing is None:
        return None
    if not matches_request:
        return error_response(
            "IDEMPOTENCY_KEY_REUSED",
            "This idempotency key was already used for a different request.",
            409,
        )
    return jsonify(existing.response_body), existing.status_code
