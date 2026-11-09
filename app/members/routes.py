from __future__ import annotations

import logging
import uuid
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from flask import Blueprint, Response, abort, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.forms import MemberForm
from app.models import (
    BridgeAttendance,
    BridgeCommand,
    BridgeInstallation,
    Gym,
    Member,
    MembershipPlan,
    MobileIdempotencyKey,
    PaymentVerification,
    RenewalHistory,
)
from app.models.member import SYNTHETIC_TEST_MEMBER_PHONE
from app.repositories import TenantRepository
from app.services.audit_service import audit
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.idempotency_service import find_replay, request_fingerprint, valid_key
from app.services.payment_service import active_scheduled_renewals
from app.services.reminder_service import auto_expire_members_for_gym, today_for_gym
from app.services.bridge_service import queue_membership_command
from app.utils.decorators import active_gym_required, roles_required
from app.utils.helpers import normalize_phone_e164

_logger = logging.getLogger(__name__)


members_bp = Blueprint("members", __name__, url_prefix="/members")


def _sync_expired_members() -> None:
    """No-op: membership expiry is owned by the scheduler + run-reminders CLI.

    Running the mutating, lock-holding auto-expire inside read endpoints
    caused long page loads and blocked concurrent renewals. Kept as a
    no-op so existing call sites need no changes.
    """


def _member_form(member: Member | None = None) -> MemberForm:
    form = MemberForm(obj=member)
    plans = (
        MembershipPlan.query.filter_by(gym_id=current_user.gym_id, is_active=True)
        .order_by(MembershipPlan.name.asc())
        .all()
    )
    form.plan_id.choices = [(0, "No plan")] + [(plan.id, plan.name) for plan in plans]
    if member and member.plan_id and request.method == "GET":
        form.plan_id.data = member.plan_id
    return form


@members_bp.route("/")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def index():
    _sync_expired_members()
    page = request.args.get("page", 1, type=int)
    status = request.args.get("status", "")
    search = request.args.get("q", "").strip()
    query = Member.query.filter_by(gym_id=current_user.gym_id).filter(Member.deleted_at.is_(None))
    if status:
        query = query.filter(Member.status == status)
    if search:
        like = f"%{search}%"
        query = query.filter(or_(Member.full_name.ilike(like), Member.phone.ilike(like)))
    pagination = (
        query.options(joinedload(Member.plan))
        .order_by(Member.membership_end.asc())
        .paginate(page=page, per_page=20, error_out=False)
    )
    return render_template("members/index.html", pagination=pagination, status=status, search=search)


@members_bp.route("/bulk-renew", methods=["GET", "POST"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def bulk_renew():
    _sync_expired_members()
    if request.method == "POST":
        member_ids = _selected_member_ids()
        renewal_days = _parse_renewal_days(request.form.get("renewal_days", "30"))
        amount = _parse_amount(request.form.get("amount", "0"))
        notes = (request.form.get("notes") or "").strip()

        if not member_ids:
            flash("Select at least one member.", "warning")
            return redirect(url_for("members.bulk_renew"))
        if renewal_days is None:
            flash("Renewal days must be between 1 and 730.", "danger")
            return redirect(url_for("members.bulk_renew"))
        if amount is None:
            flash("Amount must be zero or more, with up to two decimal places.", "danger")
            return redirect(url_for("members.bulk_renew"))

        members = (
            db.session.execute(
                select(Member)
                .where(
                    Member.gym_id == current_user.gym_id,
                    Member.deleted_at.is_(None),
                    Member.id.in_(member_ids),
                )
                .order_by(Member.id.asc())
                .with_for_update()
            )
            .scalars()
            .all()
        )
        if not members:
            flash("No matching members found.", "warning")
            return redirect(url_for("members.bulk_renew"))

        today = today_for_gym(current_user.gym.timezone)
        # H3: same date rules as the mobile API — renewal days must equal
        # the member's plan duration unless the owner supplies an
        # override reason. Validated for ALL members before any mutation
        # so a rejected bulk renewal leaves nothing behind.
        override_reason = (request.form.get("override_reason") or "").strip() or None
        from app.mobile_api.date_rules import plan_days_error

        is_owner = current_user.role == "gym_owner"
        for member in members:
            plan_err = plan_days_error(
                renewal_days,
                member.plan.duration_days if member.plan else None,
                override_reason=override_reason,
                is_owner=is_owner,
            )
            if plan_err is not None:
                flash(
                    f"Cannot renew {member.full_name}: {plan_err}",
                    "danger",
                )
                return redirect(url_for("members.bulk_renew"))
        # V3-L15: an optional start date, per member
        # (start_date_<id>) or one shared date for the whole batch
        # (start_date). Blank = previous_end + 1 (continuity), for
        # expired members too — no longer forced to today, so a
        # renewal paid days ago keeps its paid days. Invalid or
        # period-shortening starts reject the whole batch before
        # any mutation.
        requested_starts = {}
        for member in members:
            raw_start = (
                request.form.get(f"start_date_{member.id}")
                or request.form.get("start_date")
                or ""
            ).strip()
            if not raw_start:
                requested_starts[member.id] = None
                continue
            parsed = _parse_start_date(raw_start)
            if parsed is None:
                flash(
                    f"Cannot renew {member.full_name}: start date "
                    f"'{raw_start}' is not a valid YYYY-MM-DD date.",
                    "danger",
                )
                return redirect(url_for("members.bulk_renew"))
            requested_starts[member.id] = parsed
        for member in members:
            requested = requested_starts[member.id]
            if requested is None:
                continue
            if requested > today:
                flash(
                    f"Cannot renew {member.full_name}: start date "
                    f"{requested.isoformat()} is in the future — bulk "
                    "renew writes the current period, it cannot "
                    "schedule a future one.",
                    "danger",
                )
                return redirect(url_for("members.bulk_renew"))
            # V7-M4: floor the start at previous_end + 1 whenever a
            # previous period exists — for an EXPIRED member too.
            # The old guard only fired while previous_end >= today,
            # so an expired member could backdate a bulk renewal
            # inside (or before) the previous paid period.
            earliest = (
                member.membership_end + timedelta(days=1)
                if member.membership_end
                else None
            )
            if earliest is not None and requested < earliest:
                flash(
                    f"Cannot renew {member.full_name}: start date "
                    f"{requested.isoformat()} is before "
                    f"{earliest.isoformat()} and would overlap the "
                    "previous paid period.",
                    "danger",
                )
                return redirect(url_for("members.bulk_renew"))
        # V3-M17: refuse members with a live pending scheduled future
        # renewal — a bulk renew would move their end, the scheduled
        # row could then never activate, and it would block all
        # future direct renewals with a 409. Stale scheduled rows
        # (previous_end no longer matching) do not block: they are
        # already dead and the checks ignore them.
        for member in members:
            if active_scheduled_renewals(member, today):
                flash(
                    f"Cannot renew {member.full_name}: this member "
                    "already has a future renewal scheduled. Cancel "
                    "or let that renewal run before bulk-renewing.",
                    "danger",
                )
                return redirect(url_for("members.bulk_renew"))
        # V6-M1: one-time form token for this batch. A double-submit
        # (double-click / browser retry) with the same token replays
        # the first renewal instead of renewing every member a second
        # time and double-counting revenue. The check runs AFTER all
        # validation above, so a rejected batch never consumes its
        # token, and the key row is written in the SAME transaction as
        # the renewals below — a concurrent duplicate POST blocks on
        # the key's unique constraint and replays at commit time. A
        # POST without a token (legacy callers) still works, with no
        # replay protection.
        _bulk_payload = {
            "member_ids": sorted(member_ids),
            "renewal_days": renewal_days,
            "amount": str(amount),
            "notes": notes,
            "override_reason": override_reason,
            "requested_starts": {
                str(mid): (requested_starts[mid].isoformat() if requested_starts[mid] else None)
                for mid in sorted(requested_starts)
            },
        }
        _bulk_key = valid_key(request.form.get("bulk_renew_token"))
        _bulk_hash = request_fingerprint(_bulk_payload)
        if _bulk_key:
            _existing, _matches = find_replay(
                gym_id=current_user.gym_id,
                user_id=current_user.id,
                scope="web_bulk_renew",
                key=_bulk_key,
                request_hash=_bulk_hash,
            )
            if _existing:
                if not _matches:
                    flash("This form was already submitted with different details.", "danger")
                else:
                    flash("This bulk renewal was already submitted — members were not renewed twice.", "info")
                return redirect(url_for("members.bulk_renew", status="expired"))
        renewed_ids = []
        for member in members:
            # H4-legacy: capture previous_start BEFORE any mutation —
            # the else branch below rewrites membership_start.
            previous_start = member.membership_start
            previous_end = member.membership_end
            # V3-M18: snapshot plan/price before mutation.
            previous_plan_id = member.plan_id
            previous_price = member.price
            requested = requested_starts[member.id]
            if requested is not None:
                new_start = requested
            elif previous_end:
                # V3-L15: continuity for expired members too
                # (previous_end + 1), not forced to today.
                new_start = previous_end + timedelta(days=1)
            else:
                new_start = today
            # V3-H4: ONE convention for membership_start — it is the
            # current period's start. The active branch used to leave
            # it untouched while the payment/renewal flows overwrite
            # it on every renewal; now bulk renew writes it too.
            member.membership_start = new_start
            new_end = new_start + timedelta(days=renewal_days - 1)
            member.membership_end = new_end
            # M3 family: a paused member stays paused through a renewal
            # — only the explicit unfreeze flow clears paused.
            # V3-L15: a backdated start can end before today, so the
            # status follows the new end, not the act of renewing.
            if member.status != "paused":
                member.status = "active" if new_end >= today else "expired"
            # Pin the expected renewal value for revenue-at-risk reporting.
            member.price = amount
            queue_membership_command(member)
            renewed_ids.append(member.id)
            db.session.add(
                RenewalHistory(
                    gym_id=member.gym_id,
                    member_id=member.id,
                    plan_id=member.plan_id,
                    renewed_by_id=current_user.id,
                    previous_start=previous_start,
                    previous_end=previous_end,
                    previous_plan_id=previous_plan_id,
                    previous_price=previous_price,
                    # V4-M13: snapshot the plan duration in force NOW.
                    duration_days=(
                        member.plan.duration_days
                        if member.plan is not None
                        else renewal_days
                    ),
                    new_start=new_start,
                    new_end=new_end,
                    amount=amount,
                    notes=notes or f"Bulk renewed for {renewal_days} days.",
                    # V5-L16: carry the owner-approved override onto
                    # the row so Date Repair skips it.
                    override_reason=override_reason,
                )
            )

        audit(
            action="bulk_renew_members",
            resource_type="member",
            metadata={
                "member_ids": renewed_ids,
                "count": len(renewed_ids),
                "renewal_days": renewal_days,
            },
        )
        invalidate_dashboard_cache(current_user.gym_id)
        if _bulk_key:
            db.session.add(
                MobileIdempotencyKey(
                    gym_id=current_user.gym_id,
                    user_id=current_user.id,
                    scope="web_bulk_renew",
                    key=_bulk_key,
                    request_hash=_bulk_hash,
                    status_code=302,
                    response_body={"redirect": url_for("members.bulk_renew", status="expired"), "message": f"Renewed {len(renewed_ids)} members."},
                )
            )
        try:
            db.session.commit()
        except IntegrityError:
            # A concurrent duplicate POST with the same token won the
            # key race — replay it instead of a second renewal.
            db.session.rollback()
            if _bulk_key:
                _existing, _matches = find_replay(
                    gym_id=current_user.gym_id,
                    user_id=current_user.id,
                    scope="web_bulk_renew",
                    key=_bulk_key,
                    request_hash=_bulk_hash,
                )
                if _existing and _matches:
                    flash("This bulk renewal was already submitted — members were not renewed twice.", "info")
                    return redirect(url_for("members.bulk_renew", status="expired"))
            flash("Could not complete the bulk renewal — please try again.", "danger")
            return redirect(url_for("members.bulk_renew"))
        flash(f"Renewed {len(renewed_ids)} members.", "success")
        return redirect(url_for("members.bulk_renew", status="expired"))

    status = request.args.get("status", "expired")
    search = request.args.get("q", "").strip()
    query = Member.query.filter_by(gym_id=current_user.gym_id).filter(Member.deleted_at.is_(None))
    if status and status != "all":
        query = query.filter(Member.status == status)
    if search:
        like = f"%{search}%"
        query = query.filter(or_(Member.full_name.ilike(like), Member.phone.ilike(like)))
    members = (
        query.options(joinedload(Member.plan))
        .order_by(Member.membership_end.asc(), Member.full_name.asc())
        .limit(300)
        .all()
    )
    return render_template(
        "members/bulk_renew.html",
        members=members,
        status=status,
        search=search,
        default_renewal_days=30,
        default_amount=0,
        # V6-M1: fresh one-time token for the POST form below.
        bulk_renew_token=uuid.uuid4().hex,
    )


@members_bp.route("/new", methods=["GET", "POST"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def create():
    gym = current_user.gym
    form = _member_form()
    if request.method == "GET":
        if _gym_at_member_limit(gym):
            flash(
                f"You have reached the {gym.max_members}-member limit on your current plan. "
                "Upgrade to add more members.",
                "warning",
            )
            return redirect(url_for("members.index"))
        form.membership_start.data = today_for_gym(gym.timezone or "Asia/Kolkata")
        form.membership_end.data = today_for_gym(gym.timezone or "Asia/Kolkata")
        form.status.data = "active"
    if form.validate_on_submit():
        locked_gym = _locked_gym(gym.id)
        if _gym_at_member_limit(locked_gym):
            flash(
                f"You have reached the {locked_gym.max_members}-member limit on your "
                "current plan. Upgrade to add more members.",
                "warning",
            )
            return redirect(url_for("members.index"))
        member = Member(gym_id=current_user.gym_id)
        try:
            _apply_member_form(member, form)
        except ValueError as exc:
            db.session.rollback()
            flash(str(exc), "danger")
            return render_template("members/form.html", form=form, member=None)
        db.session.add(member)
        db.session.flush()
        queue_membership_command(member)
        audit(action="create_member", resource_type="member", resource_id=member.id)
        invalidate_dashboard_cache(current_user.gym_id)
        db.session.commit()
        flash("Member added.", "success")
        return redirect(url_for("members.detail", member_id=member.id))
    return render_template("members/form.html", form=form, member=None)


@members_bp.route("/<int:member_id>")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def detail(member_id: int):
    _sync_expired_members()
    member = TenantRepository(Member, current_user.gym_id).get_or_404(member_id)
    renewals = (
        RenewalHistory.query.filter_by(gym_id=current_user.gym_id, member_id=member.id)
        .order_by(RenewalHistory.created_at.desc())
        .all()
    )
    payments = (
        PaymentVerification.query.filter_by(gym_id=current_user.gym_id, member_id=member.id)
        .order_by(PaymentVerification.created_at.desc())
        .all()
    )
    commands = (
        BridgeCommand.query.filter_by(gym_id=current_user.gym_id, member_id=member.id)
        .order_by(BridgeCommand.created_at.desc())
        .limit(8)
        .all()
    )
    attendance = (
        BridgeAttendance.query.filter_by(gym_id=current_user.gym_id, member_id=member.id)
        .order_by(BridgeAttendance.event_time.desc())
        .limit(8)
        .all()
    )
    installation = BridgeInstallation.query.filter_by(gym_id=current_user.gym_id).first()

    return render_template(
        "members/detail.html",
        member=member,
        renewals=renewals,
        payments=payments,
        commands=commands,
        attendance=attendance,
        installation=installation,
    )


@members_bp.route("/<int:member_id>/edit", methods=["GET", "POST"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def edit(member_id: int):
    _sync_expired_members()
    member = TenantRepository(Member, current_user.gym_id).get_or_404(member_id)
    form = _member_form(member)
    if form.validate_on_submit():
        # V9-M12: staff may not change dates/plan/status on an existing
        # member — the mobile API 403s the same edit. A staff date
        # rewrite, plan change (re-pinning member.price) or "pause"
        # (no freeze marker, audit or end extension) is rejected
        # before anything is applied.
        if current_user.role != "gym_owner" and (
            (form.plan_id.data or None) != member.plan_id
            or form.membership_start.data != member.membership_start
            or form.membership_end.data != member.membership_end
            or form.status.data != member.status
        ):
            abort(403)
        try:
            _apply_member_form(member, form)
        except ValueError as exc:
            db.session.rollback()
            flash(str(exc), "danger")
            return render_template("members/form.html", form=form, member=member)
        queue_membership_command(member)
        audit(action="update_member", resource_type="member", resource_id=member.id)
        invalidate_dashboard_cache(current_user.gym_id)
        db.session.commit()
        flash("Member updated.", "success")
        return redirect(url_for("members.detail", member_id=member.id))
    return render_template("members/form.html", form=form, member=member)


@members_bp.post("/<int:member_id>/delete")
@login_required
@active_gym_required
@roles_required("gym_owner")
def delete(member_id: int):
    from app.models.mixins import utcnow

    member = TenantRepository(Member, current_user.gym_id).get_or_404(member_id)
    # V4-M18: record the pre-delete status — restore must bring a
    # frozen (paused) member back as paused, not active with the door
    # opened. The mobile deactivate path already records this; the web
    # delete, import-undo, and admin undo paths must too.
    prev_status = member.status
    member.deleted_at = utcnow()
    member.status = "deleted"
    # H9: free the terminal ID (mapping rows deleted; see the mobile
    # deactivate endpoint for why device_enroll_number is kept).
    from app.services.rrr_service import delete_identity_mappings

    # V5-M6: queue the delete-time block BEFORE the mappings are deleted
    # — a mapping-only member (confirmed mapping, no
    # device_enroll_number) has no other terminal identity, so deleting
    # the mappings first leaves nothing to address the block to and it
    # silently never queues.
    queue_membership_command(member)
    delete_identity_mappings(current_user.gym_id, member.id)
    audit(action="soft_delete_member", resource_type="member", resource_id=member.id,
          metadata={"previous_status": prev_status})
    invalidate_dashboard_cache(current_user.gym_id)
    db.session.commit()
    flash("Member removed.", "success")
    return redirect(url_for("members.index"))


@members_bp.post("/<int:member_id>/hard-delete")
@login_required
@active_gym_required
@roles_required("gym_owner")
def hard_delete(member_id: int):
    """Permanently remove a member and all related records."""
    member = TenantRepository(Member, current_user.gym_id).get_or_404(member_id)

    if request.form.get("confirm", "").strip() != member.full_name:
        flash("Type the member's full name exactly to confirm permanent deletion.", "danger")
        return redirect(url_for("members.detail", member_id=member.id))

    if member.device_enroll_number:
        # The X990 retains fingerprint templates when a user is disabled.  If
        # this row were deleted, its Enroll Number could be reused and the old
        # person's fingerprint could unexpectedly be granted the new person's
        # access.  Keep a soft-deleted tombstone until an explicit, audited
        # terminal deletion/re-enrolment workflow exists.
        flash(
            "This member has biometric Enroll Number " + member.device_enroll_number +
            ". Keep the soft-deleted record so that terminal identity cannot be reused.",
            "danger",
        )
        return redirect(url_for("members.detail", member_id=member.id))

    member_name = member.full_name
    member_id = member.id
    # 2026-11-09 (owner photo slice, spec §4.3 open item): the hard
    # delete is the only permanent-removal path — no bulk hard-delete
    # endpoint exists — and it never deleted the profile photo file,
    # leaving an orphaned file with no DB row. Capture the path before
    # the row is gone and delete it best-effort after commit (same
    # pattern as the member/owner photo DELETE endpoints).
    photo_path = member.profile_photo_path
    audit(
        action="hard_delete_member",
        resource_type="member",
        resource_id=member.id,
        metadata={"full_name": member_name, "phone": member.phone},
    )
    db.session.delete(member)
    invalidate_dashboard_cache(current_user.gym_id)
    db.session.commit()
    if photo_path:
        try:
            from app.services.storage_service import delete_member_profile_photo

            delete_member_profile_photo(photo_path)
        except Exception:
            _logger.exception(
                "Could not delete profile photo for hard-deleted member %s", member_id
            )
    flash(f"{member_name} has been permanently deleted.", "success")
    return redirect(url_for("members.index"))


def _apply_member_form(member: Member, form: MemberForm) -> None:
    """Apply a legacy web member form. Raises ValueError on a grid
    violation (H3) — callers flash the message and re-render the form
    without committing."""
    from app.mobile_api.date_rules import grid_error

    _old_end = member.membership_end
    member.full_name = form.full_name.data.strip()
    member.phone = normalize_phone_e164(form.phone.data.strip())
    if member.phone == SYNTHETIC_TEST_MEMBER_PHONE:
        # V7-L3: reserved for the admin test-payment synthetic member.
        raise ValueError("This phone number is reserved for internal testing.")
    member.email = form.email.data.strip() if form.email.data else None

    member.gender = form.gender.data or None
    # V9-M12: date/plan/pause fields are owner-only — the mobile API
    # 403s staff date edits, but this form applied them for staff too.
    # On an existing member a staff submission leaves those fields
    # exactly as stored (the edit route 403s a staff change above;
    # this is the defence in depth if the form is applied from
    # anywhere else). On create the signup dates/plan are the creation
    # itself, but a staff "paused" is still downgraded — pausing goes
    # through the guarded freeze endpoint only, never this form.
    _is_owner = getattr(current_user, "role", None) == "gym_owner"
    if member.id is not None and not _is_owner:
        form.plan_id.data = member.plan_id or 0
        form.membership_start.data = member.membership_start
        form.membership_end.data = member.membership_end
        form.status.data = member.status
    elif not _is_owner and form.status.data == "paused":
        form.status.data = "active"
    new_plan_id = form.plan_id.data or None
    if new_plan_id != member.plan_id:
        member.plan_id = new_plan_id
        # Pin the plan price as the expected renewal value for reporting.
        plan = (
            MembershipPlan.query.filter_by(id=new_plan_id, gym_id=current_user.gym_id).first()
            if new_plan_id
            else None
        )
        if plan is not None:
            member.price = plan.price
    member.membership_start = form.membership_start.data
    member.membership_end = form.membership_end.data
    # H3: free-typed ends must sit on the plan grid, like the mobile
    # API. The same-day start == end record is the quick-add case
    # (mirrors mobile create_member's no-date exemption) and is left
    # alone — the renewal flow fixes its dates.
    if member.membership_start != member.membership_end:
        plan = (
            MembershipPlan.query.filter_by(id=member.plan_id, gym_id=current_user.gym_id).first()
            if member.plan_id
            else None
        )
        err = grid_error(
            member.membership_start,
            member.membership_end,
            plan.duration_days if plan else None,
        )
        if err is not None:
            raise ValueError(err)
    member.status = form.status.data
    if member.status == "active" and member.membership_end < today_for_gym(current_user.gym.timezone):
        member.status = "expired"
    # V5-M9: a legitimate manual date edit moves the end a live
    # scheduled renewal was chained to — re-chain it at the new end
    # so the paid future period can still activate.
    if _old_end is not None and member.membership_end != _old_end:
        from app.services.payment_service import rechain_scheduled_renewals

        rechain_scheduled_renewals(
            member,
            old_end=_old_end,
            today=today_for_gym(current_user.gym.timezone),
            actor_id=current_user.id,
        )
    member.notes = form.notes.data


def _selected_member_ids() -> list[int]:
    member_ids: list[int] = []
    for raw_id in request.form.getlist("member_ids"):
        try:
            member_ids.append(int(raw_id))
        except (TypeError, ValueError):
            continue
    return member_ids


def _parse_start_date(raw_value: str | None) -> date | None:
    """Parse a YYYY-MM-DD start date; None when blank or invalid."""
    raw = (raw_value or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _parse_renewal_days(raw_value: str | None) -> int | None:
    try:
        renewal_days = int(raw_value or "0")
    except (TypeError, ValueError):
        return None
    if not 1 <= renewal_days <= 730:
        return None
    return renewal_days


def _parse_amount(raw_value: str | None) -> Decimal | None:
    try:
        amount = Decimal((raw_value or "0").strip() or "0")
    except (AttributeError, InvalidOperation):
        return None
    # Match the mobile paths: max 2 decimal places so Postgres/SQLite agree.
    # V10-L2: finite FIRST — "NaN" < 0 raises InvalidOperation before
    # is_finite() is reached (the try above wraps only the Decimal parse).
    if not amount.is_finite() or amount < 0 or amount.as_tuple().exponent < -2:
        return None
    return amount


def _locked_gym(gym_id: int) -> Gym:
    return db.session.execute(select(Gym).where(Gym.id == gym_id).with_for_update()).scalar_one()


def _gym_at_member_limit(gym: Gym) -> bool:
    if gym.max_members is None:
        return False
    current_count = (
        db.session.query(func.count(Member.id))
        .filter(
            Member.gym_id == gym.id,
            Member.deleted_at.is_(None),
        )
        .scalar()
        or 0
    )
    return gym.members_at_limit(current_count)


@members_bp.get("/export")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def export():
    """Download all non-deleted members as a CSV file."""
    import csv
    import io

    members = (
        Member.query.filter_by(gym_id=current_user.gym_id)
        .filter(Member.deleted_at.is_(None))
        .options(joinedload(Member.plan))
        .order_by(Member.full_name.asc())
        .all()
    )
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "full_name", "phone", "email", "gender", "plan",
        "membership_start", "membership_end", "status", "device_enroll_number", "joined_on", "notes",
    ])
    for m in members:
        writer.writerow([
            m.full_name, m.phone, m.email or "", m.gender or "",
            m.plan.name if m.plan else "", m.membership_start, m.membership_end,
            m.status, m.device_enroll_number or "", m.joined_on, m.notes or "",
        ])
    audit(action="export_members", resource_type="member", metadata={"count": len(members)})
    db.session.commit()
    gym_slug = current_user.gym.slug if current_user.gym else "members"
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={gym_slug}-members.csv"},
    )
