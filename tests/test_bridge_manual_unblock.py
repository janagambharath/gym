"""Bridge (TCP) manual block/unblock — the individual unblock option.

Covers: owner queues an unblock for a bridge gym (e.g. Yodha's old TCP .exe),
the enableable pre-check that fails closed when stored dates say expired,
block for a blockable member, DEVICE_NOT_READY without a device, the
door_blocked member-API field, and pending-command replacement.
"""
from datetime import date, timedelta

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import AuditLog, BridgeCommand, BridgeInstallation, Member


def _owner_headers(seed_gym):
    owner = seed_gym["owner"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, 'gym_owner')}"}


def _bridge(seed_gym):
    installation, api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "Test bridge", "TEST-TERMINAL-SERIAL-01"
    )
    db.session.add(installation)
    db.session.commit()
    return installation, api_key


def _access_url(member_id):
    return f"/api/mobile/v1/rrr/members/{member_id}/access"


def test_bridge_manual_unblock_queues_enable_user(client, seed_gym, seed_member):
    installation, _ = _bridge(seed_gym)
    seed_member.device_enroll_number = "101"
    db.session.commit()
    res = client.post(_access_url(seed_member.id), headers=_owner_headers(seed_gym), json={"action": "unblock"})
    assert res.status_code == 201
    data = res.json["data"]
    assert data["connector"] == "bridge"
    cmd = db.session.get(BridgeCommand, data["command"]["id"])
    assert cmd is not None
    assert cmd.command_type == "enable_user"
    assert cmd.status == "pending"
    assert cmd.enroll_number == "101"
    audit_row = AuditLog.query.filter_by(action="bridge_manual_unblock_queued").one()
    assert audit_row.metadata_json["member_id"] == seed_member.id


def test_bridge_manual_unblock_rejected_when_dates_say_expired(client, seed_gym, seed_member):
    _bridge(seed_gym)
    seed_member.device_enroll_number = "101"
    seed_member.membership_end = date.today() - timedelta(days=1)
    db.session.commit()
    res = client.post(_access_url(seed_member.id), headers=_owner_headers(seed_gym), json={"action": "unblock"})
    assert res.status_code == 409
    assert res.json["error"]["code"] == "ENABLE_NOT_ALLOWED"
    assert "Date Repair" in res.json["error"]["message"]
    assert BridgeCommand.query.count() == 0


def test_bridge_manual_block_queues_disable_for_blockable_member(client, seed_gym, seed_member):
    _bridge(seed_gym)
    seed_member.device_enroll_number = "101"
    seed_member.status = "paused"
    db.session.commit()
    res = client.post(_access_url(seed_member.id), headers=_owner_headers(seed_gym), json={"action": "block"})
    assert res.status_code == 201
    cmd = db.session.get(BridgeCommand, res.json["data"]["command"]["id"])
    assert cmd.command_type == "disable_user"
    assert "warning" in res.json["data"]


def test_manual_access_device_not_ready_without_bridge_or_adms(client, seed_gym, seed_member):
    res = client.post(_access_url(seed_member.id), headers=_owner_headers(seed_gym), json={"action": "unblock"})
    assert res.status_code == 409
    assert res.json["error"]["code"] == "DEVICE_NOT_READY"


def test_manual_unblock_replaces_pending_disable(client, seed_gym, seed_member):
    installation, _ = _bridge(seed_gym)
    seed_member.device_enroll_number = "101"
    db.session.commit()
    first = client.post(_access_url(seed_member.id), headers=_owner_headers(seed_gym), json={"action": "block"})
    assert first.status_code == 201
    cmd_id = first.json["data"]["command"]["id"]
    # The member is active, so the block was queued but would be cancelled at
    # serve time; the owner now explicitly chooses unblock instead.
    res = client.post(_access_url(seed_member.id), headers=_owner_headers(seed_gym), json={"action": "unblock"})
    assert res.status_code == 201
    assert res.json["data"]["command"]["id"] == cmd_id
    assert db.session.get(BridgeCommand, cmd_id).command_type == "enable_user"
    assert BridgeCommand.query.filter_by(member_id=seed_member.id).count() == 1


def _acked_bridge_command(installation, member, command_type):
    cmd = BridgeCommand(
        bridge_id=installation.id, gym_id=member.gym_id, member_id=member.id,
        command_type=command_type, enroll_number="101", member_name=member.full_name,
        status="acked",
    )
    db.session.add(cmd)
    db.session.commit()
    return cmd


def test_door_blocked_reflects_last_acked_bridge_command(client, seed_gym, seed_member):
    installation, _ = _bridge(seed_gym)
    seed_member.device_enroll_number = "101"
    db.session.commit()
    url = f"/api/mobile/v1/members/{seed_member.id}"
    res = client.get(url, headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    assert res.json["data"]["door_blocked"] is False
    _acked_bridge_command(installation, seed_member, "disable_user")
    res = client.get(url, headers=_owner_headers(seed_gym))
    assert res.json["data"]["door_blocked"] is True
    _acked_bridge_command(installation, seed_member, "enable_user")
    res = client.get(url, headers=_owner_headers(seed_gym))
    assert res.json["data"]["door_blocked"] is False
