from __future__ import annotations

import uuid
from datetime import timedelta

from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.forms import PaymentVerificationForm
from app.models import Member, MobileIdempotencyKey, PaymentVerification
from app.repositories import TenantRepository
from app.services.audit_service import audit
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.idempotency_service import find_replay, request_fingerprint, valid_key
from app.services.payment_service import (
    canonical_payment_reference,
    delete_payment,
    is_duplicate_reference_error,
    reject_payment,
    verify_payment,
    verified_payment_with_reference,
)
from app.services.timezone_service import today_for_gym

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
    # V6-M1: one-time form token for this create — a double-submit
    # (double-click / browser retry) with the same token replays the
    # first save instead of writing two pending payments with the same
    # UTR. A POST without a token (legacy callers) still works, with
    # no replay protection.
    idempotency_token = (
        (request.form.get("idempotency_token") or "").strip()
        or uuid.uuid4().hex
    )
    form = _payment_form()
    member_id = request.args.get("member_id", type=int)
    if request.method == "GET":
        # V10-L4: gym-local today, not the server-local date.
        form.paid_on.data = today_for_gym(current_user.gym.timezone or "Asia/Kolkata")
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
            return render_template("payments/form.html", form=form, payment=None, idempotency_token=idempotency_token)
        # V6-M4: enforce the strict plan-days rule, mirroring mobile
        # create and bulk renew — off-plan days need the gym owner +
        # an override reason; staff and reason-less requests are
        # rejected outright. The web form used to accept any days.
        from app.mobile_api.date_rules import plan_days_error

        override_reason = (form.override_reason.data or "").strip() or None
        plan_err = plan_days_error(
            renewal_days,
            member.plan.duration_days if member.plan else None,
            override_reason=override_reason,
            is_owner=(current_user.role == "gym_owner"),
        )
        if plan_err is not None:
            flash(plan_err, "danger")
            return render_template("payments/form.html", form=form, payment=None, idempotency_token=idempotency_token)
        # V5-L2: mirror the mobile pre-check — a duplicate UTR via the
        # web form is a 409-style flash, not a 500.
        _reference = canonical_payment_reference(form.reference.data)
        if _reference is not None and verified_payment_with_reference(
            current_user.gym_id, _reference
        ) is not None:
            flash("A verified payment with this reference already exists for this gym.", "danger")
            return render_template("payments/form.html", form=form, payment=None, idempotency_token=idempotency_token)
        _payload = {
            "member_id": member.id,
            "amount": str(form.amount.data),
            "paid_on": str(form.paid_on.data),
            "method": form.method.data,
            "reference": _reference,
            "renewal_days": renewal_days,
            "notes": (form.notes.data or "").strip(),
            "override_reason": override_reason,
        }
        _key = valid_key(request.form.get("idempotency_token"))
        _hash = request_fingerprint(_payload)
        if _key:
            _existing, _matches = find_replay(
                gym_id=current_user.gym_id,
                user_id=current_user.id,
                scope="web_payment_create",
                key=_key,
                request_hash=_hash,
            )
            if _existing:
                if not _matches:
                    flash("This form was already submitted with different details.", "danger")
                else:
                    flash("This payment was already saved.", "info")
                return redirect(url_for("payments.index"))
        payment = PaymentVerification(
            gym_id=current_user.gym_id,
            member_id=member.id,
            amount=form.amount.data,
            paid_on=form.paid_on.data,
            method=form.method.data,
            # V4-M19: canonicalise the UTR at write time, like the
            # mobile create paths — "utr123" and "UTR 123" are one
            # reference.
            reference=_reference,
            status="pending",
            renewal_days=renewal_days,
            notes=form.notes.data,
            override_reason=override_reason,
        )
        db.session.add(payment)
        try:
            db.session.flush()
        except IntegrityError as exc:
            db.session.rollback()
            if is_duplicate_reference_error(exc):
                flash("A verified payment with this reference already exists for this gym.", "danger")
                return render_template("payments/form.html", form=form, payment=None, idempotency_token=idempotency_token)
            raise
        audit(action="create_payment", resource_type="payment_verification", resource_id=payment.id)
        invalidate_dashboard_cache(current_user.gym_id)
        if _key:
            db.session.add(
                MobileIdempotencyKey(
                    gym_id=current_user.gym_id,
                    user_id=current_user.id,
                    scope="web_payment_create",
                    key=_key,
                    request_hash=_hash,
                    status_code=302,
                    response_body={"redirect": url_for("payments.index"), "message": "Payment saved."},
                )
            )
        try:
            db.session.commit()
        except IntegrityError as exc:
            db.session.rollback()
            if _key:
                _existing, _matches = find_replay(
                    gym_id=current_user.gym_id,
                    user_id=current_user.id,
                    scope="web_payment_create",
                    key=_key,
                    request_hash=_hash,
                )
                if _existing and _matches:
                    flash("This payment was already saved.", "info")
                    return redirect(url_for("payments.index"))
            if is_duplicate_reference_error(exc):
                flash("A verified payment with this reference already exists for this gym.", "danger")
                return render_template("payments/form.html", form=form, payment=None, idempotency_token=idempotency_token)
            raise
        flash("Payment saved.", "success")
        return redirect(url_for("payments.index"))
    return render_template("payments/form.html", form=form, payment=None, idempotency_token=idempotency_token)


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
    # V6-L6: membership_end is nullable — the old line 500d (TypeError)
    # on a NULL-end member before verify_payment ever ran. Guard it,
    # and use the gym-local today, not the server-local date.
    _gym_tz = current_user.gym.timezone if current_user.gym and current_user.gym.timezone else "Asia/Kolkata"
    future_threshold = today_for_gym(_gym_tz) + timedelta(days=60)
    if payment.member.membership_end and payment.member.membership_end > future_threshold:
        flash(
            f"Warning: {payment.member.full_name}'s current membership ends on "
            f"{payment.member.membership_end.strftime('%d %b %Y')}; the new renewal "
            "period will be stacked after that date.",
            "warning",
        )
    try:
        verify_payment(payment, verified_by_id=current_user.id, renewal_days=renewal_days)
        audit(
            action="verify_payment",
            resource_type="payment_verification",
            resource_id=payment.id,
            metadata={
                "new_end": str(payment.member.membership_end),
                "renewal_days": renewal_days,
            },
        )
        db.session.commit()
        flash("Payment verified and membership extended.", "success")
    except IntegrityError as exc:
        # V5-L2: a verify-time index race is a duplicate reference,
        # not a 500 — but only when the constraint in the error IS the
        # UTR index.
        db.session.rollback()
        if is_duplicate_reference_error(exc):
            flash("A verified payment with this reference already exists for this gym.", "warning")
        else:
            flash("Could not verify payment: a database error occurred.", "danger")
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


@payments_bp.post("/<int:payment_id>/delete")
@login_required
@active_gym_required
# V6-L5: web delete was staff-allowed while mobile delete is
# owner-only — a staff member could hard-delete a member's pending
# UPI claim record. Owner-only on both surfaces now.
@roles_required("gym_owner")
def delete(payment_id: int):
    payment = TenantRepository(PaymentVerification, current_user.gym_id).get_or_404(payment_id)
    try:
        delete_payment(payment)
        audit(action="delete_payment", resource_type="payment_verification", resource_id=payment_id)
        db.session.commit()
        flash("Payment record deleted successfully.", "success")
    except Exception as exc:
        db.session.rollback()
        flash(f"Could not delete payment: {exc}", "danger")
    return redirect(url_for("payments.index"))

