"""M7 regression tests: unique ADMS serials + fail-closed duplicates.

Kept in its own file so the M7 migration batch can ride (or be held)
separately from the core remaining-findings batch.
"""
import pytest
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models import Gym
from app.models.rrr import RRRIntegration


def test_adms_serial_unique_index_rejects_duplicates(seed_gym):
    gym2 = Gym(name="Second Gym", slug="second-gym", email="s2@test.com",
               phone="+919876543211", status="active")
    db.session.add(gym2)
    db.session.commit()
    db.session.add(RRRIntegration(
        gym_id=seed_gym["gym"].id, connector_type="adms_direct", display_name="Dup",
        device_serial="DUP-SERIAL", status="connected", adms_path_token="tok-1",
    ))
    db.session.commit()
    db.session.add(RRRIntegration(
        gym_id=gym2.id, connector_type="adms_direct", display_name="Dup",
        device_serial="DUP-SERIAL", status="connected", adms_path_token="tok-2",
    ))
    with pytest.raises(IntegrityError):
        db.session.flush()
    db.session.rollback()


def test_device_fails_closed_on_duplicate_serials(client, seed_gym):
    # Simulate a pre-index database (migration held or not yet run) by
    # dropping the partial index in this test's throwaway schema, then
    # creating the duplicate rows the index would otherwise block.
    import sqlalchemy as sa

    db.session.execute(sa.text("DROP INDEX uq_rrr_integration_adms_serial"))
    db.session.commit()
    gym2 = Gym(name="Second Gym", slug="second-gym", email="s2@test.com",
               phone="+919876543211", status="active")
    db.session.add(gym2)
    db.session.commit()
    for gid in (seed_gym["gym"].id, gym2.id):
        db.session.add(RRRIntegration(
            gym_id=gid, connector_type="adms_direct", display_name="Dup",
            device_serial="DUP-SERIAL", status="connected",
            adms_path_token=f"tok-{gid}",
        ))
    db.session.commit()
    from app.adms.routes import _device

    with client.application.test_request_context("/?SN=DUP-SERIAL"):
        assert _device() is None  # fail closed, not .first() arbitrarily
