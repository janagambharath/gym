"""Application-level encryption for stored fingerprint templates (H2).

``RRRBiometricTemplate.template_data`` is biometric material that must not
sit in plaintext in the database. Values are encrypted with Fernet (the
same derivation pattern as ``app.utils.token_encryption``) at capture time
and decrypted only on the restore path, so no device-side change is needed:
the terminal still receives the plaintext ``TMP=`` value it requires in
the restore command text — wire plaintext is inherent to the classic ADMS
protocol and is out of scope for this at-rest fix.

Key: ``TEMPLATE_ENCRYPTION_KEY`` config (env) when set, else the app
``SECRET_KEY``. Encrypted values carry the ``enc1:`` prefix; rows written
before this change (bare plaintext) still decrypt through
:func:`decrypt_template` so restores keep working, and are re-encrypted
automatically the next time the terminal's templates are captured.

Key rotation (documented, not automatic): rotating the key orphans
``enc1:`` rows encrypted under the old key — decrypt then raises
``ValueError`` and the restore path skips that finger rather than
shipping corrupt data. Before rotating, re-encrypt every row: decrypt
with the old key, encrypt with the new key, and only then switch the
config value. Rotating ``SECRET_KEY`` has the same effect when no
dedicated ``TEMPLATE_ENCRYPTION_KEY`` is set, which is why a dedicated
key is recommended in production.
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from flask import current_app

ENCRYPTED_PREFIX = "enc1:"


def _fernet() -> Fernet:
    secret = current_app.config.get("TEMPLATE_ENCRYPTION_KEY") or current_app.config["SECRET_KEY"]
    raw = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(raw))


def encrypt_template(plaintext: str) -> str:
    """Encrypt one template value; returns the prefixed ciphertext."""
    return ENCRYPTED_PREFIX + _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def is_encrypted(stored: str | None) -> bool:
    return bool(stored) and stored.startswith(ENCRYPTED_PREFIX)


def decrypt_template(stored: str) -> str:
    """Decrypt a stored template value.

    Bare (legacy, pre-encryption) values pass through unchanged so old
    rows remain restorable. A prefixed value that fails to decrypt raises
    ``ValueError`` (e.g. after a key rotation without re-encryption) —
    callers must skip that template, never ship the ciphertext to a
    terminal as if it were a template.
    """
    if not stored.startswith(ENCRYPTED_PREFIX):
        return stored
    try:
        return _fernet().decrypt(stored[len(ENCRYPTED_PREFIX):].encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise ValueError(
            "Stored fingerprint template cannot be decrypted with the "
            "current key (was the encryption key rotated without "
            "re-encrypting stored templates?)."
        ) from exc
