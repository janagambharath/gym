"""Token encryption utilities for storing sensitive per-gym credentials."""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet
from flask import current_app


def _get_fernet() -> Fernet:
    """Derive a Fernet key from the app's SECRET_KEY."""
    secret = current_app.config.get("WHATSAPP_TOKEN_ENCRYPTION_KEY") or current_app.config["SECRET_KEY"]
    # Fernet needs a 32-byte url-safe base64-encoded key
    raw = hashlib.sha256(secret.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(raw)
    return Fernet(key)


def encrypt_token(plaintext: str) -> str:
    """Encrypt a plaintext token string. Returns a base64-encoded ciphertext."""
    f = _get_fernet()
    return f.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a base64-encoded ciphertext back to plaintext."""
    f = _get_fernet()
    return f.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
