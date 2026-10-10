from __future__ import annotations

import re
import secrets
import zoneinfo
from datetime import datetime, timedelta, timezone

from flask import current_app
from sqlalchemy import and_, or_, select

from app.extensions import db
from app.models import BridgeCommand, BridgeInstallation, Member
from app.models import RRRAdmsCommand, RRRIdentityMapping, RRRIntegration
from app.models.mixins import utcnow
from app.services.audit_service import audit


_ENROLL_NUMBER_RE = re.compile(r"^[0-9]{1,10}$")


def _as_utc(value: datetime) -> datetime:
    """Normalise DB timestamps from both PostgreSQL and SQLite."""

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def canonical_enroll_number(value: object) -> str:
    """Return a safe terminal Enroll Number, or raise ``ValueError``.

    The X990 access-control workflow uses a 32-bit numeric user ID for its
    time-zone APIs.  Keeping the online mapping numeric avoids a command that
    the local bridge could acknowledge but not enforce on the terminal.
    """

    text = str(value or "").strip()
    if not _ENROLL_NUMBER_RE.fullmatch(text):
        raise ValueError("Biometric Enroll Number must contain only digits.")
    number = int(text)
    if number < 1 or number > 2_147_483_647:
        raise ValueError("Biometric Enroll Number must be between 1 and 2147483647.")
    return str(number)


def desired_command_type(member: Member) -> str:
    """Translate the online membership state into a terminal access state."""

    gym_timezone = member.gym.timezone if member.gym else "Asia/Kolkata"
    try:
        local_today = datetime.now(zoneinfo.ZoneInfo(gym_timezone or "Asia/Kolkata")).date()
    except Exception:
        local_today = datetime.now(zoneinfo.ZoneInfo("Asia/Kolkata")).date()
    return (
        "enable_user"
        if member.status == "active" and not member.deleted_at and member.membership_end >= local_today
        else "disable_user"
    )


def _active_installation(gym_id: int) -> BridgeInstallation | None:
    return BridgeInstallation.query.filter_by(gym_id=gym_id, is_active=True).first()


# ─── Direct ADMS automatic block/unblock ─────────────────────────────────────

def adms_command_text(action: str, enroll_number: str | None) -> str:
    """Return the PUSH SDK wire text for a direct-ADMS terminal command.

    ``block``/``unblock`` are the automatic membership commands; the ``*_test``
    variants are the owner-driven commissioning commands.  Both spellings share
    the same wire format: Pri=1 is the vendor's inactive-user value and Pri=0
    is a normal user.  Deletion is never used: commands must preserve the user
    and its enrolled biometric template.
    """

    if action == "probe_info":
        return "INFO"
    if action in {"block", "block_test"}:
        priority = "1"
    elif action in {"unblock", "unblock_test"}:
        priority = "0"
    else:
        raise ValueError(f"Unknown ADMS command action: {action!r}")
    return f"DATA UPDATE USERINFO PIN={enroll_number}\tPri={priority}"


def resolve_adms_enroll_number(member: Member) -> str | None:
    """Return the terminal enroll number for a member on the direct-ADMS path.

    Prefers the confirmed RRR identity mapping (the biometric ID the terminal
    actually reported), then falls back to the member's device enroll number.
    Returns ``None`` when the member has no usable terminal identity.
    """

    mapping = (
        RRRIdentityMapping.query.filter_by(
            gym_id=member.gym_id, member_id=member.id, status="confirmed"
        )
        .order_by(RRRIdentityMapping.id.desc())
        .first()
    )
    candidate = (mapping.external_id if mapping else None) or member.device_enroll_number
    if not candidate:
        return None
    return canonical_enroll_number(candidate)


def _adms_integration(gym_id: int) -> RRRIntegration | None:
    return RRRIntegration.query.filter_by(gym_id=gym_id, connector_type="adms_direct").first()


def queue_adms_membership_command(member: Member, *, force: bool = False) -> RRRAdmsCommand | None:
    """Queue an automatic block/unblock for the direct-ADMS terminal.

    This is the direct-path twin of :func:`queue_membership_command`.  It is
    deliberately gated on ``commands_enabled``: the owner must finish the
    supervised commissioning (mapped real attendance + acknowledged test
    command + physical door test) before any automatic command is queued.

    Delivery is pull-based (the terminal polls ``/iclock/getrequest`` and
    re-sends ``delivered`` commands until acknowledged), so queueing while the
    terminal is temporarily offline is safe.  Commands are never queued for a
    terminal that has never connected.

    Like the bridge twin, this function does not commit.
    """

    integration = _adms_integration(member.gym_id)
    if integration is None or not integration.commands_enabled:
        return None
    if integration.last_success_at is None:
        # The terminal never checked in; do not pile commands into the void.
        return None

    try:
        enroll_number = resolve_adms_enroll_number(member)
    except ValueError:
        return None
    if not enroll_number:
        return None

    action = "block" if desired_command_type(member) == "disable_user" else "unblock"
    command_text = adms_command_text(action, enroll_number)

    # Lock the latest command for this terminal identity so a concurrent
    # renewal/expiry cannot reorder or duplicate the terminal's final state.
    latest = db.session.execute(
        select(RRRAdmsCommand)
        .where(
            RRRAdmsCommand.integration_id == integration.id,
            RRRAdmsCommand.test_enroll_number == enroll_number,
        )
        .order_by(RRRAdmsCommand.id.desc())
        .limit(1)
        .with_for_update()
    ).scalar_one_or_none()

    if latest is not None:
        if latest.status == "queued":
            if latest.action == action:
                return latest
            # A not-yet-delivered command can be replaced by the newest state.
            latest.action = action
            latest.test_enroll_number = enroll_number
            latest.command_text = command_text
            latest.result_code = None
            latest.result_message = None
            latest.requested_by_id = None
            audit(
                action=f"adms_membership_{action}_queued",
                resource_type="rrr_adms_command",
                resource_id=latest.id,
                gym_id=member.gym_id,
                metadata={"member_id": member.id, "enroll_number": enroll_number, "replaced": True},
            )
            return latest
        if latest.status == "delivered":
            if latest.action == action:
                # The terminal holds it and getrequest re-sends until acked.
                return latest
            # A different-state command is already in flight; queue the
            # follow-up.  getrequest serves older IDs first, so the terminal
            # converges on the newest state.
        elif latest.status == "acked" and latest.action == action and not force:
            return latest
        # "failed" (or a forced repair) always queues a fresh command below.

    command = RRRAdmsCommand(
        gym_id=member.gym_id,
        integration_id=integration.id,
        action=action,
        test_enroll_number=enroll_number,
        command_text=command_text,
        requested_by_id=None,
    )
    db.session.add(command)
    db.session.flush()
    audit(
        action=f"adms_membership_{action}_queued",
        resource_type="rrr_adms_command",
        resource_id=command.id,
        gym_id=member.gym_id,
        metadata={"member_id": member.id, "enroll_number": enroll_number},
    )
    return command


def queue_membership_command(member: Member, *, force: bool = False) -> BridgeCommand | None:
    """Queue the latest required terminal state, without duplicating work.

    This function deliberately does not commit.  Call it in the same database
    transaction as the membership change, so a renewal/expiry can never be
    saved without its corresponding device command.

    Every membership change fans out to both connector paths: the legacy
    Windows-bridge installation (when present) and the direct-ADMS terminal
    (when commissioned).  The direct-ADMS leg is a no-op unless the gym's
    direct integration has ``commands_enabled`` set by supervised
    commissioning.
    """

    bridge_command = _queue_bridge_membership_command(member, force=force)
    queue_adms_membership_command(member, force=force)
    return bridge_command


def _queue_bridge_membership_command(member: Member, *, force: bool = False) -> BridgeCommand | None:
    if not member.device_enroll_number:
        return None

    installation = _active_installation(member.gym_id)
    if installation is None:
        return None

    enroll_number = canonical_enroll_number(member.device_enroll_number)
    command_type = desired_command_type(member)
    # This lock is essential: a dashboard renewal must never mutate a command
    # that the polling request has already leased and handed to the laptop.
    latest = db.session.execute(
        select(BridgeCommand)
        .where(BridgeCommand.bridge_id == installation.id, BridgeCommand.member_id == member.id)
        .order_by(BridgeCommand.created_at.desc(), BridgeCommand.id.desc())
        .limit(1)
        .with_for_update()
    ).scalar_one_or_none()

    if latest is not None:
        if (
            latest.status in {"pending", "leased"}
            and latest.command_type == command_type
            and latest.enroll_number == enroll_number
        ):
            if force and latest.status == "pending":
                latest.not_before = None
            return latest
        if latest.status == "pending":
            # A not-yet-delivered command can safely be replaced by the most
            # recent membership state.  A leased command is left immutable;
            # its follow-up command preserves correct final ordering.
            latest.command_type = command_type
            latest.enroll_number = enroll_number
            latest.member_name = member.full_name
            latest.delay_seconds = None
            latest.last_error = None
            latest.retry_attempt = 0
            latest.not_before = None
            return latest
        if (
            latest.status == "acked"
            and latest.command_type == command_type
            and latest.enroll_number == enroll_number
        ):
            # A normal membership edit has nothing new to deliver once the
            # terminal acknowledged the required state.  A reconciliation is
            # different: it deliberately re-sends the present state so a
            # terminal that was manually changed can be repaired.
            if not force:
                return latest

    command = BridgeCommand(
        bridge_id=installation.id,
        gym_id=member.gym_id,
        member_id=member.id,
        command_type=command_type,
        enroll_number=enroll_number,
        member_name=member.full_name,
    )
    db.session.add(command)
    return command


def queue_gym_reconciliation(gym_id: int) -> int:
    """Queue access state for every enrolled member of one installed gym."""

    if _active_installation(gym_id) is None:
        return 0
    members = (
        Member.query.filter(
            Member.gym_id == gym_id,
            Member.device_enroll_number.is_not(None),
        )
        .order_by(Member.id.asc())
        .all()
    )
    queued = 0
    for member in members:
        if queue_membership_command(member, force=True) is not None:
            queued += 1
    return queued


def lease_pending_commands(installation: BridgeInstallation) -> list[BridgeCommand]:
    """Lease due commands for one short polling interval.

    Commands are never removed by a GET.  If the laptop loses power or an ACK
    fails, the expired lease is delivered again with a new token.
    """

    now = utcnow()
    lease_seconds = max(30, int(current_app.config["BRIDGE_COMMAND_LEASE_SECONDS"]))
    ready = (
        BridgeCommand.query.filter(
            BridgeCommand.bridge_id == installation.id,
            or_(
                BridgeCommand.status == "pending",
                and_(
                    BridgeCommand.status == "leased",
                    BridgeCommand.lease_expires_at.is_not(None),
                    BridgeCommand.lease_expires_at <= now,
                ),
            ),
            or_(BridgeCommand.not_before.is_(None), BridgeCommand.not_before <= now),
        )
        .order_by(BridgeCommand.created_at.asc(), BridgeCommand.id.asc())
        .limit(max(1, int(current_app.config["BRIDGE_COMMAND_BATCH_SIZE"])))
        .with_for_update()
        .all()
    )
    for command in ready:
        command.lease(secrets.token_urlsafe(32), now + timedelta(seconds=lease_seconds))
    return ready


def schedule_retry_after_failed_command(command: BridgeCommand) -> BridgeCommand | None:
    """Schedule a bounded new-ID retry after a physical device failure.

    The laptop persists command outcomes by command ID, so the same failed ID
    must never be re-executed.  A retry is therefore a delayed command with a
    new ID.  This avoids a tight loop while still recovering from transient
    Wi-Fi, terminal, or power failures.
    """

    max_attempts = max(1, int(current_app.config["BRIDGE_COMMAND_MAX_EXECUTION_ATTEMPTS"]))
    if command.retry_attempt + 1 >= max_attempts or command.member_id is None:
        return None
    member = db.session.get(Member, command.member_id)
    if member is None or not member.device_enroll_number:
        return None
    if (
        desired_command_type(member) != command.command_type
        or canonical_enroll_number(member.device_enroll_number) != command.enroll_number
    ):
        # A later membership transaction will queue the correct current state.
        return None

    base_delay = max(30, int(current_app.config["BRIDGE_COMMAND_RETRY_SECONDS"]))
    delay_seconds = min(3600, base_delay * (2 ** command.retry_attempt))
    retry = BridgeCommand(
        bridge_id=command.bridge_id,
        gym_id=command.gym_id,
        member_id=command.member_id,
        command_type=command.command_type,
        enroll_number=command.enroll_number,
        member_name=command.member_name,
        retry_attempt=command.retry_attempt + 1,
        not_before=utcnow() + timedelta(seconds=delay_seconds),
    )
    db.session.add(retry)
    return retry


def acknowledge_command(
    command: BridgeCommand,
    *,
    status: str,
    lease_token: str,
    error_message: str | None,
) -> tuple[bool, str | None]:
    """Apply a bridge ACK.  Returns ``(accepted, error_code)``."""

    if status not in {"acked", "failed"}:
        return False, "invalid_status"

    if command.status in {"acked", "failed"}:
        # Retrying an already received ACK is safe only when it agrees with
        # the durable result.  It must never mutate a completed command.
        return (command.status == status, None if command.status == status else "already_final")

    if command.status != "leased":
        return False, "not_leased"
    if not lease_token or not secrets.compare_digest(command.lease_token or "", lease_token):
        return False, "lease_mismatch"
    if command.lease_expires_at is None or _as_utc(command.lease_expires_at) < utcnow():
        return False, "lease_expired"

    command.acknowledge(status, error_message)
    return True, None

