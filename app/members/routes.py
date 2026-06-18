from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required
from sqlalchemy import func, or_, select
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.forms import MemberForm
from app.models import Gym, Member, MembershipPlan, PaymentVerification, RenewalHistory
from app.repositories import TenantRepository
from app.services.audit_service import audit
from app.services.analytics_service import invalidate_dashboard_cache
from app.utils.decorators import active_gym_required, roles_required


members_bp = Blueprint("members", __name__, url_prefix="/members")


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
            flash("Amount must be zero or more.", "danger")
            return redirect(url_for("members.bulk_renew"))

        members = (
            db.session.execute(
                select(Member)
                .where(
                    Member.gym_id == current_user.gym_id,
                    Member.deleted_at.is_(None),
                    Member.id.in_(member_ids),
                )
                .order_by(Member.full_name.asc())
                .with_for_update()
            )
            .scalars()
            .all()
        )
        if not members:
            flash("No matching members found.", "warning")
            return redirect(url_for("members.bulk_renew"))

        today = date.today()
        renewed_ids = []
        for member in members:
            previous_end = member.membership_end
            new_start = max(today, previous_end + timedelta(days=1))
            new_end = new_start + timedelta(days=renewal_days - 1)
            member.membership_start = new_start
            member.membership_end = new_end
            member.status = "active"
            renewed_ids.append(member.id)
            db.session.add(
                RenewalHistory(
                    gym_id=member.gym_id,
                    member_id=member.id,
                    plan_id=member.plan_id,
                    renewed_by_id=current_user.id,
                    previous_end=previous_end,
                    new_start=new_start,
                    new_end=new_end,
                    amount=amount,
                    notes=notes or f"Bulk renewed for {renewal_days} days.",
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
        db.session.commit()
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
        form.membership_start.data = date.today()
        form.membership_end.data = date.today()
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
        _apply_member_form(member, form)
        db.session.add(member)
        db.session.flush()
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
    return render_template("members/detail.html", member=member, renewals=renewals, payments=payments)


@members_bp.route("/<int:member_id>/edit", methods=["GET", "POST"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def edit(member_id: int):
    member = TenantRepository(Member, current_user.gym_id).get_or_404(member_id)
    form = _member_form(member)
    if form.validate_on_submit():
        _apply_member_form(member, form)
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
    member.deleted_at = utcnow()
    member.status = "deleted"
    audit(action="soft_delete_member", resource_type="member", resource_id=member.id)
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

    member_name = member.full_name
    audit(
        action="hard_delete_member",
        resource_type="member",
        resource_id=member.id,
        metadata={"full_name": member_name, "phone": member.phone},
    )
    db.session.delete(member)
    invalidate_dashboard_cache(current_user.gym_id)
    db.session.commit()
    flash(f"{member_name} has been permanently deleted.", "success")
    return redirect(url_for("members.index"))


def _apply_member_form(member: Member, form: MemberForm) -> None:
    member.full_name = form.full_name.data.strip()
    member.phone = form.phone.data.strip()
    member.email = form.email.data.strip() if form.email.data else None
    member.gender = form.gender.data or None
    member.plan_id = form.plan_id.data or None
    member.membership_start = form.membership_start.data
    member.membership_end = form.membership_end.data
    member.status = form.status.data
    member.notes = form.notes.data


def _selected_member_ids() -> list[int]:
    member_ids: list[int] = []
    for raw_id in request.form.getlist("member_ids"):
        try:
            member_ids.append(int(raw_id))
        except (TypeError, ValueError):
            continue
    return member_ids


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
    if amount < 0:
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
