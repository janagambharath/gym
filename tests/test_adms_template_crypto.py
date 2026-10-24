"""H2 regression tests: fingerprint templates encrypted at rest.

Kept in its own file so the H2 batch can ride (or be held) separately
from the core remaining-findings batch.
"""
from datetime import datetime, timezone

import pytest

from app.extensions import db
from app.models.rrr import RRRAdmsCommand, RRRBiometricTemplate, RRRIntegration
from app.services.template_crypto import (
    decrypt_template,
    encrypt_template,
    is_encrypted,
)

SERIAL = "REST-X2008-01"
TOKEN = "rest-test-token"


def _integration(seed_gym):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="Rest ADMS",
        device_serial=SERIAL,
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        adms_path_token=TOKEN,
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    return row


def test_template_crypto_roundtrip_and_legacy_passthrough(app):
    ciphertext = encrypt_template("QUJDREVGRw==")
    assert is_encrypted(ciphertext)
    assert ciphertext != "QUJDREVGRw=="
    assert decrypt_template(ciphertext) == "QUJDREVGRw=="
    assert decrypt_template("legacy-plaintext") == "legacy-plaintext"


def test_template_crypto_wrong_key_raises(app):
    ciphertext = encrypt_template("QUJDREVGRw==")
    app.config["TEMPLATE_ENCRYPTION_KEY"] = "a-different-key"
    try:
        with pytest.raises(ValueError):
            decrypt_template(ciphertext)
    finally:
        app.config["TEMPLATE_ENCRYPTION_KEY"] = ""


def test_userinfo_capture_encrypts_and_restore_decrypts(client, seed_gym, seed_member):
    from app.services.bridge_service import _queue_template_restore_commands

    integration = _integration(seed_gym)
    seed_member.device_enroll_number = "7"
    db.session.commit()
    cmd = RRRAdmsCommand(
        integration_id=integration.id, gym_id=seed_gym["gym"].id,
        action="sync_users", command_text="DATA QUERY USERINFO PIN=ALL",
    )
    db.session.add(cmd)
    db.session.commit()

    body = "USER PIN=7\tName=John Doe\tPri=0\tPasswd=\tCard=0\tGrp=1\tTMP=QUJDREVGRw==\n"
    res = client.post(
        f"/iclock/{TOKEN}/cdata?SN={SERIAL}&table=USERINFO",
        data=body, content_type="text/plain",
    )
    assert res.status_code == 200
    row = RRRBiometricTemplate.query.filter_by(
        gym_id=seed_gym["gym"].id, enroll_number="7", finger_id=0).one()
    assert is_encrypted(row.template_data)
    assert row.template_data != "QUJDREVGRw=="

    # Restore path decrypts: the terminal receives plaintext TMP.
    _queue_template_restore_commands(seed_member, integration, "7")
    db.session.commit()
    restore = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, action="restore_template").one()
    assert "TMP=QUJDREVGRw==" in restore.command_text
    assert "Size=7" in restore.command_text  # base64 of 7-byte "ABCDEFG"
