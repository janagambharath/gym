from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from flask import Blueprint, flash, redirect, render_template, request, url_for, Response
from flask_login import current_user, login_required
from sqlalchemy import func, select
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models import BridgeInstallation, BridgeCommand, BridgeAttendance, Member, Gym
from app.models.bridge import generate_bridge_api_key, hash_bridge_api_key
from app.models.mixins import utcnow
from app.services.audit_service import audit
from app.services.bridge_service import (
    STALE_ENABLE_ERROR,
    STALE_ENABLE_MARKER,
    bridge_command_must_be_cancelled,
    bridge_enable_must_be_cancelled,
    cancel_bridge_command,
    queue_membership_command,
)
from app.utils.decorators import active_gym_required, roles_required


biometric_bp = Blueprint("biometric", __name__, url_prefix="/biometric")


def _get_bridge_context(gym_id: int):
    installation = BridgeInstallation.query.filter_by(gym_id=gym_id).first()
    is_online = False
    heartbeat_age_seconds = None
    if installation and installation.last_heartbeat_at:
        now = utcnow()
        hb = installation.last_heartbeat_at
        if hb.tzinfo is None:
            hb = hb.replace(tzinfo=timezone.utc)
        heartbeat_age_seconds = max(0, int((now - hb).total_seconds()))
        is_online = heartbeat_age_seconds <= 120 and installation.is_active

    return installation, is_online, heartbeat_age_seconds


@biometric_bp.route("/")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def index():
    gym_id = current_user.gym_id
    installation, is_online, heartbeat_age_seconds = _get_bridge_context(gym_id)

    pending_count = 0
    leased_count = 0
    acked_count = 0
    failed_count = 0
    recent_commands = []
    recent_attendance = []

    if installation:
        stats = dict(
            db.session.query(BridgeCommand.status, func.count(BridgeCommand.id))
            .filter(BridgeCommand.bridge_id == installation.id)
            .group_by(BridgeCommand.status)
            .all()
        )
        pending_count = stats.get("pending", 0)
        leased_count = stats.get("leased", 0)
        acked_count = stats.get("acked", 0)
        failed_count = stats.get("failed", 0)

        recent_commands = (
            BridgeCommand.query.filter_by(bridge_id=installation.id)
            .options(joinedload(BridgeCommand.member))
            .order_by(BridgeCommand.created_at.desc())
            .limit(10)
            .all()
        )

        recent_attendance = (
            BridgeAttendance.query.filter_by(bridge_id=installation.id)
            .options(joinedload(BridgeAttendance.member))
            .order_by(BridgeAttendance.event_time.desc())
            .limit(10)
            .all()
        )

    enrolled_members_count = (
        Member.query.filter_by(gym_id=gym_id)
        .filter(Member.deleted_at.is_(None), Member.device_enroll_number.isnot(None))
        .count()
    )

    return render_template(
        "biometric/index.html",
        installation=installation,
        is_online=is_online,
        heartbeat_age_seconds=heartbeat_age_seconds,
        pending_count=pending_count,
        leased_count=leased_count,
        acked_count=acked_count,
        failed_count=failed_count,
        recent_commands=recent_commands,
        recent_attendance=recent_attendance,
        enrolled_members_count=enrolled_members_count,
    )


@biometric_bp.route("/activity")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def activity():
    gym_id = current_user.gym_id
    installation, is_online, heartbeat_age_seconds = _get_bridge_context(gym_id)
    page = request.args.get("page", 1, type=int)

    pagination = None
    if installation:
        pagination = (
            BridgeAttendance.query.filter_by(bridge_id=installation.id)
            .options(joinedload(BridgeAttendance.member))
            .order_by(BridgeAttendance.event_time.desc())
            .paginate(page=page, per_page=25, error_out=False)
        )

    return render_template(
        "biometric/activity.html",
        installation=installation,
        is_online=is_online,
        pagination=pagination,
    )


@biometric_bp.route("/commands")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def commands():
    gym_id = current_user.gym_id
    installation, is_online, heartbeat_age_seconds = _get_bridge_context(gym_id)
    page = request.args.get("page", 1, type=int)
    status_filter = request.args.get("status", "").strip()

    pagination = None
    if installation:
        query = BridgeCommand.query.filter_by(bridge_id=installation.id)
        if status_filter:
            query = query.filter_by(status=status_filter)
        pagination = (
            query.options(joinedload(BridgeCommand.member))
            .order_by(BridgeCommand.created_at.desc())
            .paginate(page=page, per_page=25, error_out=False)
        )

    return render_template(
        "biometric/commands.html",
        installation=installation,
        is_online=is_online,
        pagination=pagination,
        status_filter=status_filter,
    )


@biometric_bp.route("/commands/<string:command_id>/retry", methods=["POST"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def retry_command(command_id: str):
    gym_id = current_user.gym_id
    installation, _, _ = _get_bridge_context(gym_id)
    if not installation:
        flash("Biometric bridge is not provisioned.", "danger")
        return redirect(url_for("biometric.commands"))

    command = BridgeCommand.query.filter_by(id=command_id, bridge_id=installation.id).first()
    if not command:
        flash("Command not found.", "warning")
        return redirect(url_for("biometric.commands"))

    if command.status == "failed" and (
        bridge_command_must_be_cancelled(command)
        or bridge_enable_must_be_cancelled(command)
    ):
        # Fail-safe: a disable is retried only for a proven-blockable member
        # (paused, or expired with a past end date), and an enable only for
        # a proven-enableable member (active, end today or later).  Stamp
        # the cancellation.
        if bridge_enable_must_be_cancelled(command):
            cancel_bridge_command(
                command, marker=STALE_ENABLE_MARKER, error=STALE_ENABLE_ERROR
            )
            message = (
                "Command was not retried: the member is not proven enableable "
                "(only a currently active member may be enabled)."
            )
        else:
            cancel_bridge_command(command)
            message = (
                "Command was not retried: the member is not proven blockable "
                "(active members are never blocked)."
            )
        db.session.commit()
        flash(message, "warning")
        return redirect(url_for("biometric.commands"))

    command.status = "pending"
    command.lease_token = None
    command.lease_expires_at = None
    command.retry_attempt += 1
    command.not_before = utcnow()
    db.session.commit()

    audit(
        action="retry_bridge_command",
        resource_type="bridge_command",
        resource_id=command.id,
        gym_id=gym_id,
        metadata={"member_id": command.member_id, "command_type": command.command_type},
    )
    flash("Command queued for immediate retry by the bridge.", "success")
    return redirect(url_for("biometric.commands"))


@biometric_bp.route("/devices")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def devices():
    gym_id = current_user.gym_id
    installation, is_online, heartbeat_age_seconds = _get_bridge_context(gym_id)
    return render_template(
        "biometric/devices.html",
        installation=installation,
        is_online=is_online,
        heartbeat_age_seconds=heartbeat_age_seconds,
    )


@biometric_bp.route("/settings", methods=["GET", "POST"])
@login_required
@active_gym_required
@roles_required("gym_owner")
def settings():
    gym_id = current_user.gym_id
    installation, is_online, heartbeat_age_seconds = _get_bridge_context(gym_id)
    new_api_key = None

    if request.method == "POST":
        action = request.form.get("action", "")
        if action == "provision":
            display_name = request.form.get("display_name", "Gym Biometric Bridge")
            device_serial = request.form.get("device_serial", "X990-DEFAULT")
            if not installation:
                installation, new_api_key = BridgeInstallation.create_for_gym(
                    gym_id=gym_id,
                    display_name=display_name,
                    device_serial=device_serial,
                )
                db.session.add(installation)
                db.session.commit()
                audit(action="provision_bridge", resource_type="bridge_installation", resource_id=installation.id)
                flash("Bridge credentials generated! Save your API key safely.", "success")
            else:
                flash("Bridge is already provisioned for this gym.", "info")
        elif action == "rotate_key" and installation:
            new_api_key = installation.rotate_key()
            db.session.commit()
            audit(action="rotate_bridge_key", resource_type="bridge_installation", resource_id=installation.id)
            flash("Bridge API key rotated! Update appsettings.json on your gym laptop.", "warning")

    return render_template(
        "biometric/settings.html",
        installation=installation,
        is_online=is_online,
        heartbeat_age_seconds=heartbeat_age_seconds,
        new_api_key=new_api_key,
    )


@biometric_bp.route("/sync-member/<int:member_id>", methods=["POST"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def sync_member(member_id: int):
    member = Member.query.filter_by(id=member_id, gym_id=current_user.gym_id, deleted_at=None).first()
    if not member:
        flash("Member not found.", "danger")
        return redirect(url_for("members.index"))

    if not member.device_enroll_number:
        flash(f"{member.full_name} does not have a Biometric Enroll Number assigned yet.", "warning")
        return redirect(url_for("members.detail", member_id=member.id))

    queue_membership_command(member)
    db.session.commit()
    audit(action="manual_biometric_sync", resource_type="member", resource_id=member.id)
    flash(f"Biometric access command queued for {member.full_name}.", "success")
    return redirect(url_for("members.detail", member_id=member.id))


@biometric_bp.route("/support-package")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def download_support_package():
    gym_id = current_user.gym_id
    installation, is_online, heartbeat_age_seconds = _get_bridge_context(gym_id)

    recent_errors = []
    if installation:
        err_cmds = (
            BridgeCommand.query.filter_by(bridge_id=installation.id)
            .filter(BridgeCommand.last_error.isnot(None))
            .order_by(BridgeCommand.created_at.desc())
            .limit(20)
            .all()
        )
        recent_errors = [
            {
                "id": cmd.id,
                "command_type": cmd.command_type,
                "enroll_number": cmd.enroll_number,
                "status": cmd.status,
                "attempts": cmd.delivery_attempts,
                "created_at": cmd.created_at.isoformat() if cmd.created_at else None,
                "error": cmd.last_error,
            }
            for cmd in err_cmds
        ]

    package = {
        "export_time": utcnow().isoformat(),
        "gym_id": gym_id,
        "gym_name": current_user.gym.name,
        "timezone": current_user.gym.timezone,
        "bridge": {
            "provisioned": installation is not None,
            "public_id": installation.public_id if installation else None,
            "device_serial": installation.device_serial if installation else None,
            "is_active": installation.is_active if installation else None,
            "last_status": installation.last_status if installation else None,
            "last_heartbeat_at": installation.last_heartbeat_at.isoformat() if installation and installation.last_heartbeat_at else None,
            "is_online": is_online,
            "heartbeat_age_seconds": heartbeat_age_seconds,
        },
        "recent_errors": recent_errors,
    }

    return Response(
        json.dumps(package, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": f"attachment;filename=biometric_support_{gym_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"},
    )


# ── Smart enroll matching (web UI) ──────────────────────────────────────
# PC-less friendly: works with ADMS snapshots and bridge snapshots alike.


@biometric_bp.route("/enroll-match", methods=["GET"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def enroll_match():
    """Smart matching page: scan terminal users, confirm one-tap matches."""
    from app.services import enroll_match_service

    gym_id = current_user.gym_id
    result = enroll_match_service.suggest_matches(gym_id)
    return render_template(
        "biometric/enroll_match.html",
        suggestions=result["suggestions"],
        unmatched=result["unmatched_terminal"],
        snapshot=result["snapshot"],
        no_snapshot=result.get("error") == "no_snapshot",
    )


@biometric_bp.route("/enroll-match/scan", methods=["POST"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def enroll_match_scan():
    """Queue a sync_users command (ADMS preferred, bridge fallback)."""
    from app.models.rrr import RRRAdmsCommand, RRRIntegration
    from app.services.bridge_service import adms_command_text

    gym_id = current_user.gym_id
    integration = RRRIntegration.query.filter_by(
        gym_id=gym_id, connector_type="adms_direct"
    ).first()
    if integration is not None and (not integration.commands_enabled or integration.status != "connected"):
        # M12: same commissioning gate as the mobile enroll-scan path —
        # do not queue a scan against an uncommissioned terminal.
        flash("Complete supervised commissioning before scanning terminal users.", "danger")
        return redirect(url_for("biometric.enroll_match"))
    if integration is not None:
        cmd = RRRAdmsCommand(
            integration_id=integration.id,
            gym_id=gym_id,
            action="sync_users",
            command_text=adms_command_text("sync_users", None),
            requested_by_id=current_user.id,
        )
        db.session.add(cmd)
        db.session.commit()
        flash("Scan queued — the terminal will upload its user list on its next poll. Refresh in ~15 seconds.", "success")
    else:
        installation, _, _ = _get_bridge_context(gym_id)
        if not installation or not installation.is_active:
            flash("No ADMS integration or paired bridge found. Provision ADMS or pair the PC connector first.", "danger")
        else:
            cmd = BridgeCommand(
                bridge_id=installation.id,
                gym_id=gym_id,
                command_type="sync_users",
                enroll_number="SYSTEM",
            )
            db.session.add(cmd)
            db.session.commit()
            flash("Scan queued — the connector will read the terminal's user list. Refresh in ~15 seconds.", "success")
    return redirect(url_for("biometric.enroll_match"))


@biometric_bp.route("/enroll-match/confirm", methods=["POST"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def enroll_match_confirm():
    """One-tap confirm: link a member to a terminal enroll number."""
    from app.services import enroll_match_service

    gym_id = current_user.gym_id
    try:
        member_id = int(request.form.get("member_id") or 0)
    except (TypeError, ValueError):
        member_id = 0
    enroll_number = (request.form.get("enroll_number") or "").strip()
    if not member_id or not enroll_number:
        flash("Missing member or enroll number.", "danger")
        return redirect(url_for("biometric.enroll_match"))
    try:
        member = enroll_match_service.confirm_match(gym_id, member_id, enroll_number, current_user.id)
        flash(f"{member.full_name} linked to terminal #{member.device_enroll_number}.", "success")
    except ValueError as exc:
        flash(str(exc), "danger")
    return redirect(url_for("biometric.enroll_match"))
