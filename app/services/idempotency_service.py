"""Helpers for replay-safe mobile API mutations."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from flask import jsonify

from app.extensions import db
from app.mobile_api.errors import error_response
from app.models.mobile_idempotency import MobileIdempotencyKey
from app.models.mixins import utcnow
from app.utils.token_encryption import decrypt_token, encrypt_token

logger = logging.getLogger(__name__)

# V7-L4 — replay rows live at most this long. 24h covers every realistic
# client retry (including a phone offline overnight) while bounding both
# table growth and how long a stored response can be replayed.
IDEMPOTENCY_TTL = timedelta(hours=24)

# V7-M3 — response-body keys whose values are live credentials. They are
# encrypted at rest (Fernet, key derived from SECRET_KEY — see
# app/utils/token_encryption.py) so a DB read / leaked backup never yields
# a usable staff password. Encrypted values carry the "enc1:" prefix.
# NOTE: "invite_whatsapp_url" is credential-bearing too — the invite text
# embeds the temp password in clear (URL-encoded), so encrypting only
# "temp_password"/"new_password" still left the password recoverable
# from the stored row. The whole URL value is encrypted; replay
# decrypts it back verbatim.
_SENSITIVE_KEYS = frozenset(
    {"temp_password", "new_password", "invite_whatsapp_url"}
)
_ENCRYPTED_PREFIX = "enc1:"
# Returned in place of a password that can no longer be decrypted (key
# rotated without re-encryption). Never the ciphertext, never a crash.
_UNDECRYPTABLE_MARKER = "[unavailable — re-issue the password]"


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def is_expired(record: MobileIdempotencyKey) -> bool:
    """True when a replay row is past its TTL.

    ``expires_at`` NULL = written before the column existed: expiry is
    ``created_at`` + TTL. A missing ``created_at`` is treated as expired
    (fail-closed — an undated row must not replay forever).
    """
    now = utcnow()
    expires_at = _as_utc(record.expires_at)
    if expires_at is not None:
        return expires_at <= now
    created_at = _as_utc(record.created_at)
    if created_at is None:
        return True
    return created_at + IDEMPOTENCY_TTL <= now


def prune_expired_idempotency_keys() -> int:
    """Delete expired replay rows. Returns the number deleted.

    Called lazily from :func:`begin_idempotency` (best-effort) and from
    the daily scheduler job. Raises nothing — callers that cannot afford
    a failure wrap it; the lazy call sites already do.
    """
    now = utcnow()
    deleted = (
        MobileIdempotencyKey.query.filter(
            db.or_(
                MobileIdempotencyKey.expires_at <= now,
                db.and_(
                    MobileIdempotencyKey.expires_at.is_(None),
                    MobileIdempotencyKey.created_at.is_not(None),
                    MobileIdempotencyKey.created_at
                    <= (now - IDEMPOTENCY_TTL),
                ),
                db.and_(
                    MobileIdempotencyKey.expires_at.is_(None),
                    MobileIdempotencyKey.created_at.is_(None),
                ),
            )
        )
        .delete(synchronize_session=False)
    )
    return deleted


def _prune_best_effort() -> None:
    try:
        if prune_expired_idempotency_keys():
            db.session.commit()
    except Exception:
        db.session.rollback()
        logger.warning("Idempotency prune failed (non-fatal)", exc_info=True)


def _encrypt_value(value: str) -> str:
    return _ENCRYPTED_PREFIX + encrypt_token(value)


def _encrypt_sensitive_fields(body: Any) -> Any:
    """Deep-copy ``body`` with credential values encrypted (V7-M3)."""
    if isinstance(body, dict):
        out: dict[str, Any] = {}
        for key, value in body.items():
            if (
                key in _SENSITIVE_KEYS
                and isinstance(value, str)
                and value
                and not value.startswith(_ENCRYPTED_PREFIX)
            ):
                out[key] = _encrypt_value(value)
            else:
                out[key] = _encrypt_sensitive_fields(value)
        return out
    if isinstance(body, list):
        return [_encrypt_sensitive_fields(item) for item in body]
    return body


def _decrypt_sensitive_fields(body: Any) -> tuple[Any, bool, bool]:
    """Deep-copy ``body`` with credential values decrypted.

    Returns ``(body, ok, had_plaintext)``:
    - ``ok`` is False when an ``enc1:`` value cannot be decrypted (key
      rotated without re-encryption). Callers treat that row as expired:
      the replay is discarded and the request executes fresh — never
      return ciphertext, never crash.
    - ``had_plaintext`` is True when a credential was stored unencrypted
      (a row written before V7-M3). The caller re-encrypts it in place so
      the row self-heals; the TTL prune bounds any row nobody replays.
    """
    if isinstance(body, dict):
        out: dict[str, Any] = {}
        ok = True
        had_plaintext = False
        for key, value in body.items():
            if key in _SENSITIVE_KEYS and isinstance(value, str) and value:
                if value.startswith(_ENCRYPTED_PREFIX):
                    try:
                        out[key] = decrypt_token(value[len(_ENCRYPTED_PREFIX):])
                    except Exception:
                        return body, False, False
                else:
                    had_plaintext = True
                    out[key] = value
            else:
                nested, nested_ok, nested_plain = _decrypt_sensitive_fields(value)
                if not nested_ok:
                    return body, False, False
                had_plaintext = had_plaintext or nested_plain
                out[key] = nested
        return out, ok, had_plaintext
    if isinstance(body, list):
        out_list: list[Any] = []
        had_plaintext = False
        for item in body:
            nested, nested_ok, nested_plain = _decrypt_sensitive_fields(item)
            if not nested_ok:
                return body, False, False
            had_plaintext = had_plaintext or nested_plain
            out_list.append(nested)
        return out_list, True, had_plaintext
    return body, True, False


def replay_response_body(record: MobileIdempotencyKey) -> tuple[dict[str, Any] | None, bool]:
    """Return the decrypted stored response for ``record``.

    ``(body, True)`` — replayable. ``(None, False)`` — the stored body
    holds an undecryptable credential: treat the row as expired (the
    caller deletes it and executes fresh). A legacy plaintext credential
    is returned decrypted-as-is AND re-encrypted in the stored row so
    the next read never sees plaintext again.
    """
    body, ok, had_plaintext = _decrypt_sensitive_fields(record.response_body)
    if not ok:
        return None, False
    if had_plaintext:
        try:
            record.response_body = _encrypt_sensitive_fields(record.response_body)
            db.session.flush()
        except Exception:
            db.session.rollback()
            logger.warning(
                "Idempotency plaintext re-encryption failed (non-fatal)",
                exc_info=True,
            )
    return body, True


def request_fingerprint(payload: dict[str, Any]) -> str:
    """Return a stable hash without persisting request values themselves."""

    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def file_upload_payload(
    endpoint: str, *, sha256_hex: str, size_bytes: int
) -> dict[str, Any]:
    """Fingerprint payload for a multipart file upload (V8-L29).

    ``request_fingerprint`` takes a JSON dict, so a file upload cannot be
    fingerprinted on the raw body. The fingerprint is (endpoint + SHA-256
    of the file bytes + byte size):

    - the content hash is the identity: the same bytes are the same
      upload, whatever the client called the file;
    - the filename is deliberately EXCLUDED — a retry that re-sends the
      same QR under a different filename is the same replace operation
      and must replay, not re-store (``save_gym_qr`` mints a fresh uuid
      filename on every store, so re-storing would orphan the first
      file and return a different signed URL for the same image);
    - size is redundant with the hash but cheap, and makes a hash
      collision structurally impossible to exploit silently.

    Callers must read the bytes, hash them, then ``seek(0)`` the stream
    before the storage call so the upload can be read again.
    """
    return {
        "endpoint": endpoint,
        "sha256": sha256_hex,
        "size_bytes": size_bytes,
    }


def _identity_filters(
    *, user_id: int | None, member_id: int | None
) -> dict[str, Any]:
    """Resolve exactly one identity for an idempotency row (V8-L29/L32).

    Owner/staff requests scope by ``user_id``; member-API requests scope
    by ``member_id`` (members are not ``User`` rows — see
    ``MobileIdempotencyKey``). Passing neither, or both, is a caller bug
    and fails loudly instead of writing a row no lookup could ever find.
    """
    if (user_id is None) == (member_id is None):
        raise ValueError(
            "Idempotency scope needs exactly one of user_id / member_id."
        )
    if member_id is not None:
        return {"user_id": None, "member_id": member_id}
    return {"user_id": user_id, "member_id": None}


def valid_key(value: str | None) -> str | None:
    """Normalize a client retry key, rejecting unbounded/unusable values."""

    key = (value or "").strip()
    if not key:
        return None
    if len(key) > 128:
        return ""
    return key


def find_replay(
    *,
    gym_id: int,
    user_id: int | None = None,
    member_id: int | None = None,
    scope: str,
    key: str,
    request_hash: str,
) -> tuple[MobileIdempotencyKey | None, bool]:
    """Return an existing record and whether its payload matches this request.

    An expired record is reported as no record at all (V7-L4): the caller
    executes fresh instead of replaying a stale response.

    V8-L29/L32: pass ``member_id`` (and no ``user_id``) for member-API
    rows; ``user_id`` for owner/staff rows. Exactly one is required.
    """

    identity = _identity_filters(user_id=user_id, member_id=member_id)
    record = MobileIdempotencyKey.query.filter_by(
        gym_id=gym_id,
        scope=scope,
        key=key,
        **identity,
    ).one_or_none()
    if record is None or is_expired(record):
        return None, True
    return record, hmac.compare_digest(record.request_hash, request_hash)


def begin_idempotency(
    *,
    gym_id: int,
    user_id: int | None = None,
    member_id: int | None = None,
    scope: str,
    headers,
    payload: dict[str, Any],
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

    V8-L29/L32: pass ``member_id`` (and no ``user_id``) for member-API
    rows; ``user_id`` for owner/staff rows. Exactly one is required.

    Expired rows are pruned lazily on entry (V7-L4) and an expired or
    undecryptable stored response is never replayed (V7-M3).
    """

    _prune_best_effort()
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
        member_id=member_id,
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
        body, ok = replay_response_body(existing)
        if not ok:
            # Undecryptable credential (key rotated): treat the row as
            # expired — drop it and execute fresh, never crash, never
            # leak ciphertext. The fresh execution re-issues the
            # credential (create hits the duplicate-email 409, which is
            # the honest outcome when the original password is gone).
            try:
                db.session.delete(existing)
                db.session.commit()
            except Exception:
                db.session.rollback()
            return key, request_hash, None
        return key, request_hash, (jsonify(body), existing.status_code)
    return key, request_hash, None


def record_idempotency(
    *,
    gym_id: int,
    user_id: int | None = None,
    member_id: int | None = None,
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

    Credential values in the body are encrypted before storage (V7-M3)
    and the row carries a 24h expiry (V7-L4).

    V8-L29/L32: pass ``member_id`` (and no ``user_id``) for member-API
    rows; ``user_id`` for owner/staff rows. Exactly one is required.
    """

    if not key:
        return
    identity = _identity_filters(user_id=user_id, member_id=member_id)
    db.session.add(
        MobileIdempotencyKey(
            gym_id=gym_id,
            scope=scope,
            key=key,
            request_hash=request_hash,
            status_code=status_code,
            response_body=_encrypt_sensitive_fields(response_body),
            expires_at=utcnow() + IDEMPOTENCY_TTL,
            **identity,
        )
    )


def legacy_replay(existing: MobileIdempotencyKey, matches_request: bool):
    """Decrypting replay for the pre-``begin_idempotency`` call sites.

    V8-L5: the legacy ``find_replay`` + ``jsonify(existing.response_body)``
    sites replayed the stored body verbatim, so a credential stored as
    ``enc1:`` ciphertext would have been returned as ciphertext (and a
    future sensitive key would leak that way). This routes them through
    :func:`replay_response_body` like ``begin_idempotency`` does.

    Returns the Flask response the caller must return immediately, or
    ``None`` when the caller should execute fresh: the stored body held
    an undecryptable credential, so the row is deleted (fail-closed,
    never return ciphertext) and the request runs normally.
    """
    if not matches_request:
        return error_response(
            "IDEMPOTENCY_KEY_REUSED",
            "This idempotency key was already used for a different request.",
            409,
        )
    body, ok = replay_response_body(existing)
    if not ok:
        try:
            db.session.delete(existing)
            db.session.commit()
        except Exception:
            db.session.rollback()
            logger.warning(
                "Idempotency undecryptable-row delete failed (non-fatal)",
                exc_info=True,
            )
        return None
    return jsonify(body), existing.status_code


def replay_after_conflict(
    *,
    gym_id: int,
    user_id: int | None = None,
    member_id: int | None = None,
    scope: str,
    key: str | None,
    request_hash: str,
):
    """After a commit IntegrityError, return the winner's replay response
    if this key lost the unique-key race, else ``None`` (caller re-raises).

    V8-L29/L32: pass ``member_id`` (and no ``user_id``) for member-API
    rows; ``user_id`` for owner/staff rows.
    """

    if not key:
        return None
    existing, matches_request = find_replay(
        gym_id=gym_id,
        user_id=user_id,
        member_id=member_id,
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
    body, ok = replay_response_body(existing)
    if not ok:
        return None
    return jsonify(body), existing.status_code
