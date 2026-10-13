"""ADMS command prober for eSSL X2008 (ZAM180_TFT firmware).

Systematically tests ADMS PUSH commands against the terminal and records
which ones are accepted (Return=0) vs rejected. This is the "crack" —
mapping the actual command set the firmware supports.

Usage: POST /mobile/rrr/adms-probe with {"commands": ["..."]}
Each command is queued and the Return code is captured from /iclock/devicecmd.
"""

from __future__ import annotations

from flask import g, jsonify, request

from app.extensions import db
from app.mobile_api.middleware import roles_required, token_required
from app.models.rrr import RRRAdmsCommand, RRRIntegration


# Candidate commands to probe — organized by category.
# These are the unknowns we want to resolve on the X2008.
# Keys must be <= 18 chars (action field is String(24), prefix "probe_" is 6).
PROBE_COMMANDS = {
    # Template deletion (the critical unknown for non-destructive block)
    "del_tmp_bare": "DATA DELETE FINGERTMP PIN={pin}",
    "del_tmp_fid0": "DATA DELETE FINGERTMP PIN={pin}\tFID=0",
    "del_tmp_fid1": "DATA DELETE FINGERTMP PIN={pin}\tFID=1",
    "del_bio_bare": "DATA DELETE biodata Pin={pin}",
    "del_bio_type1": "DATA DELETE biodata Pin={pin}\tType=1",
    # User disable (alternative to delete)
    "upd_pri0": "DATA UPDATE USERINFO PIN={pin}\tPri=0",
    "upd_verify": "DATA UPDATE USERINFO PIN={pin}\tVerify=1",
    # Template query (to see what's stored)
    "qry_tmp": "DATA QUERY FINGERTMP PIN={pin}",
    "qry_bio": "DATA QUERY biodata Pin={pin}",
    # User authorize (door access, probably no-op for attendance)
    "del_auth": "DATA DELETE userauthorize Pin={pin}",
}


def register_adms_probe_routes(bp):
    @bp.route("/rrr/adms-probe", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def adms_probe():
        """Queue probe commands for the terminal. Returns command IDs."""
        data = request.get_json(silent=True) or {}
        pin = str(data.get("pin", "99")).strip()
        command_keys = data.get("commands") or list(PROBE_COMMANDS.keys())

        integration = RRRIntegration.query.filter_by(
            gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if not integration:
            return jsonify({"success": False, "error": "No ADMS terminal connected"}), 404

        queued = []
        for key in command_keys:
            template = PROBE_COMMANDS.get(key)
            if not template:
                continue
            cmd_text = template.format(pin=pin)
            cmd = RRRAdmsCommand(
                gym_id=g.gym_id,
                integration_id=integration.id,
                action=f"probe_{key}",
                test_enroll_number=pin,
                command_text=cmd_text,
                requested_by_id=g.current_user.id,
            )
            db.session.add(cmd)
            db.session.flush()
            queued.append({"key": key, "command_id": cmd.id, "command": cmd_text})

        db.session.commit()
        return jsonify({
            "success": True,
            "data": {
                "queued": queued,
                "note": "Commands will be delivered on next terminal poll. "
                        "Check /iclock/devicecmd results for Return codes: "
                        "0=success, -1=not supported, -1004=table not supported.",
            },
        })

    @bp.route("/rrr/adms-probe/commands", methods=["GET"])
    @token_required
    @roles_required("gym_owner")
    def adms_probe_commands():
        """List available probe commands."""
        return jsonify({
            "success": True,
            "data": {
                "commands": [
                    {"key": k, "template": v}
                    for k, v in PROBE_COMMANDS.items()
                ],
            },
        })
