from __future__ import annotations

from datetime import date

from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.forms import PaymentVerificationForm
from app.models import Member, PaymentVerification
from app.repositories import TenantRepository
from app.services.audit_service import audit
from app.services.payment_service import reject_payment, verify_payment
from app.utils.decorators import active_gym_required, roles_required


payments_bp = Blueprint("payments", __name__, url_prefix="/payments")


def _payment_form(payment: PaymentVerification | None = None) -> PaymentVerificationForm:
    form = PaymentVerificationForm(obj=payment)
    members = (
        Member.query.filter_by(gym_id=current_user.gym_id)
        .filter(Member.deleted_at.is_(None))
        .order_by(Member.full_name.asc())
        .all()
    )
    form.member_id.choices = [(member.id, member.full_name) for member in members]
    if payment and payment.member:
        form.member_id.data = payment.member_id
        form.renewal_days.data = payment.member.plan.duration_days if payment.member.plan else 30
    return form


@payments_bp.route("/")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def index():
    status = request.args.get("status", "")
    page = request.args.get("page", 1, type=int)
    query = PaymentVerification.query.filter_by(gym_id=current_user.gym_id)
    if status:
        query = query.filter_by(status=status)
    pagination = (
        query.options(joinedload(PaymentVerification.member))
        .order_by(PaymentVerification.created_at.desc())
        .paginate(page=page, per_page=20, error_out=False)
    )
    return render_template("payments/index.html", pagination=pagination, status=status)


@payments_bp.route("/new", methods=["GET", "POST"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def create():
    form = _payment_form()
    member_id = request.args.get("member_id", type=int)
    if request.method == "GET":
        form.paid_on.data = date.today()
        form.status.data = "pending"
        if member_id:
            member = (
                Member.query.filter_by(id=member_id, gym_id=current_user.gym_id)
                .filter(Member.deleted_at.is_(None))
                .first()
            )
            if member:
                form.member_id.data = member.id
                form.amount.data = member.plan.price if member.plan else 0
                form.renewal_days.data = member.plan.duration_days if member.plan else 30
    if form.validate_on_submit():
        member = (
            Member.query.filter_by(id=form.member_id.data, gym_id=current_user.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first_or_404()
        )
        renewal_days = int(form.renewal_days.data)
        if not 1 <= renewal_days <= 730:
            flash("Renewal days must be between 1 and 730.", "danger")
            return render_template("payments/form.html", form=form, payment=None)
        payment = PaymentVerification(
            gym_id=current_user.gym_id,
            member_id=member.id,
            amount=form.amount.data,
            paid_on=form.paid_on.data,
            method=form.method.data,
            reference=form.reference.data,
            status="pending",
            renewal_days=renewal_days,
            notes=form.notes.data,
        )
        db.session.add(payment)
        db.session.flush()
        audit(action="create_payment", resource_type="payment_verification", resource_id=payment.id)
        db.session.commit()
        flash("Payment saved.", "success")
        return redirect(url_for("payments.index"))
    return render_template("payments/form.html", form=form, payment=None)


@payments_bp.post("/<int:payment_id>/verify")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def verify(payment_id: int):
    payment = TenantRepository(PaymentVerification, current_user.gym_id).get_or_404(payment_id)
    member_id = payment.member_id
    if payment.status == "verified":
        flash("Payment is already verified.", "info")
        return redirect(url_for("payments.index"))
    renewal_days = payment.renewal_days or (payment.member.plan.duration_days if payment.member.plan else 30)
    try:
        verify_payment(payment, verified_by_id=current_user.id, renewal_days=renewal_days)
        audit(action="verify_payment", resource_type="payment_verification", resource_id=payment.id)
        db.session.commit()
        flash("Payment verified and membership extended.", "success")
    except ValueError as exc:
        db.session.rollback()
        flash(str(exc), "warning")
    return redirect(url_for("members.detail", member_id=member_id))


@payments_bp.post("/<int:payment_id>/reject")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def reject(payment_id: int):
    payment = TenantRepository(PaymentVerification, current_user.gym_id).get_or_404(payment_id)
    try:
        reject_payment(payment, verified_by_id=current_user.id)
        audit(action="reject_payment", resource_type="payment_verification", resource_id=payment.id)
        db.session.commit()
        flash("Payment rejected.", "warning")
    except ValueError as exc:
        db.session.rollback()
        flash(str(exc), "warning")
    return redirect(url_for("payments.index"))
