"""JWT access-token and opaque refresh-token service for the mobile API."""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta, timezone

from flask import current_app

from app.extensions import db
from app.models.mobile_token import MobileRefreshToken


# ── Access tokens (HMAC-signed JWT-like) ────────────────────────────────


def _token_secret() -> str:
    secret = current_app.config.get("MOBILE_API_TOKEN_SECRET", "")
    if not secret:
        secret = current_app.config["SECRET_KEY"]
    return secret


def _b64url_encode(data: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    import base64

    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def create_access_token(user_id: int, gym_id: int, role: str) -> str:
    """Create an HMAC-SHA256 signed access token."""
    ttl_minutes = current_app.config.get("MOBILE_API_ACCESS_TOKEN_MINUTES", 15)
    payload = {
        "sub": user_id,
        "gym_id": gym_id,
        "role": role,
        "iat": int(time.time()),
        "exp": int(time.time()) + ttl_minutes * 60,
    }
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64url_encode(json.dumps(payload).encode())
    signature = hmac.new(
        _token_secret().encode(), f"{header}.{body}".encode(), hashlib.sha256
    ).digest()
    sig_encoded = _b64url_encode(signature)
    return f"{header}.{body}.{sig_encoded}"


def decode_access_token(token: str) -> dict | None:
    """Decode and verify an access token. Returns payload dict or None."""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    header_b64, body_b64, sig_b64 = parts
    expected_sig = hmac.new(
        _token_secret().encode(), f"{header_b64}.{body_b64}".encode(), hashlib.sha256
    ).digest()
    try:
        actual_sig = _b64url_decode(sig_b64)
    except Exception:
        return None
    if not hmac.compare_digest(expected_sig, actual_sig):
        return None
    try:
        payload = json.loads(_b64url_decode(body_b64))
    except Exception:
        return None
    if payload.get("exp", 0) < int(time.time()):
        return None
    return payload


# ── Refresh tokens (opaque + server-stored hash) ────────────────────────


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_refresh_token(user_id: int, gym_id: int, family_id: str | None = None) -> str:
    """Create a new opaque refresh token and store its hash in the DB."""
    raw_token = secrets.token_urlsafe(64)
    token_hash = _hash_token(raw_token)
    if family_id is None:
        family_id = secrets.token_hex(16)

    ttl_days = current_app.config.get("MOBILE_API_REFRESH_TOKEN_DAYS", 30)
    expires_at = datetime.now(timezone.utc) + timedelta(days=ttl_days)

    record = MobileRefreshToken(
        user_id=user_id,
        gym_id=gym_id,
        token_hash=token_hash,
        family_id=family_id,
        is_used=False,
        expires_at=expires_at,
    )
    db.session.add(record)
    return raw_token


def rotate_refresh_token(raw_token: str) -> tuple[str, MobileRefreshToken] | None:
    """Consume a refresh token and issue a replacement. Returns (new_raw_token, old_record) or None.

    If the token was already used (replay), invalidate the entire family.
    """
    token_hash = _hash_token(raw_token)
    record = MobileRefreshToken.query.filter_by(token_hash=token_hash).first()
    if record is None:
        return None

    # Replay detection: if this token was already used, nuke the whole family.
    if record.is_used:
        MobileRefreshToken.query.filter_by(family_id=record.family_id).delete()
        db.session.flush()
        return None

    # Expired?
    now = datetime.now(timezone.utc)
    expires_at = record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if now > expires_at:
        db.session.delete(record)
        db.session.flush()
        return None

    # Mark as used and issue replacement in the same family.
    record.is_used = True
    new_raw = create_refresh_token(record.user_id, record.gym_id, family_id=record.family_id)
    return new_raw, record


def revoke_refresh_token(raw_token: str) -> bool:
    """Revoke a single refresh token."""
    token_hash = _hash_token(raw_token)
    deleted = MobileRefreshToken.query.filter_by(token_hash=token_hash).delete()
    return deleted > 0


def revoke_all_user_tokens(user_id: int) -> int:
    """Revoke all refresh tokens for a user (logout-all / password change)."""
    deleted = MobileRefreshToken.query.filter_by(user_id=user_id).delete()
    return deleted


def cleanup_expired_tokens() -> int:
    """Delete expired tokens. Run periodically."""
    now = datetime.now(timezone.utc)
    deleted = MobileRefreshToken.query.filter(MobileRefreshToken.expires_at < now).delete()
    return deleted
