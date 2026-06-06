from __future__ import annotations

from datetime import date

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
