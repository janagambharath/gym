from __future__ import annotations

from datetime import date, timedelta

from flask import Blueprint, current_app, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.forms import (
    MembershipPlanForm,
    NotificationTemplateForm,
    QRSettingsForm,
    WhatsAppSettingsForm,
)
from app.models import Gym, Member, MembershipPlan, NotificationTemplate, PaymentVerification, QRSettings
from app.repositories import TenantRepository
from app.services.analytics_service import gym_dashboard_stats
from app.services.audit_service import audit
from app.services.storage_service import (
    delete_local_upload,
    invalidate_whatsapp_media_cache,
    save_gym_qr,
)
from app.services.whatsapp_service import WhatsAppService
from app.utils.decorators import active_gym_required, roles_required
from app.utils.helpers import normalize_public_media_url


gym_bp = Blueprint("gym", __name__, url_prefix="/app")


@gym_bp.route("/dashboard")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def dashboard():
    gym_id = current_user.gym_id
    stats = gym_dashboard_stats(gym_id)
    expiring_members = (
        Member.query.filter(
            Member.gym_id == gym_id,
            Member.status == "active",
            Member.deleted_at.is_(None),
            Member.membership_end >= date.today(),
            Member.membership_end <= date.today() + timedelta(days=14),
        )
        .options(joinedload(Member.plan))
        .order_by(Member.membership_end.asc())
        .limit(10)
        .all()
    )
    recent_payments = (
        PaymentVerification.query.filter_by(gym_id=gym_id)
        .options(joinedload(PaymentVerification.member))
        .order_by(PaymentVerification.created_at.desc())
        .limit(8)
        .all()
    )
    return render_template(
        "dashboard/index.html",
        stats=stats,
        expiring_members=expiring_members,
        recent_payments=recent_payments,
    )


@gym_bp.route("/settings", methods=["GET", "POST"])
@login_required
@active_gym_required
@roles_required("gym_owner")
def settings():
    gym_id = current_user.gym_id
    qr_settings = QRSettings.query.filter_by(gym_id=gym_id).first()
    if not qr_settings:
        qr_settings = QRSettings(gym_id=gym_id, payment_label=current_user.gym.name)
        db.session.add(qr_settings)
        db.session.flush()

    form = QRSettingsForm(obj=qr_settings)
    if form.validate_on_submit():
        old_media_url = _whatsapp_media_cache_url(qr_settings)
        qr_settings.payment_label = form.payment_label.data
        qr_settings.upi_id = form.upi_id.data
        qr_settings.qr_public_url = form.qr_public_url.data
        qr_settings.instructions = form.instructions.data
        qr_settings.is_active = form.is_active.data
        if form.qr_image.data:
            try:
                qr_settings.qr_image_path = save_gym_qr(form.qr_image.data, gym_id)
            except ValueError as exc:
                flash(str(exc), "danger")
                return redirect(url_for("gym.settings"))
        invalidate_whatsapp_media_cache(current_user.gym.phone_number_id, old_media_url)
        audit(action="update_qr_settings", resource_type="qr_settings", resource_id=qr_settings.id)
        db.session.commit()
        flash("Payment QR settings saved.", "success")
        return redirect(url_for("gym.settings"))

    current_qr_url = None
    if qr_settings.qr_public_url:
        current_qr_url = normalize_public_media_url(qr_settings.qr_public_url)
    elif qr_settings.qr_image_path and qr_settings.qr_image_path.startswith("http"):
        current_qr_url = normalize_public_media_url(qr_settings.qr_image_path)
    elif qr_settings.qr_image_path:
        current_qr_url = url_for("uploaded_file", filename=qr_settings.qr_image_path)
    return render_template(
        "gym/settings.html",
        form=form,
        qr_settings=qr_settings,
        current_qr_url=current_qr_url,
    )


@gym_bp.route("/whatsapp-settings", methods=["GET", "POST"])
@login_required
@active_gym_required
@roles_required("gym_owner")
def whatsapp_settings():
    gym = Gym.query.filter_by(id=current_user.gym_id).first_or_404()
    form = WhatsAppSettingsForm(obj=gym)
    if form.validate_on_submit():
        gym.whatsapp_business_account_id = form.whatsapp_business_account_id.data
        gym.phone_number_id = form.phone_number_id.data
        gym.business_phone_number = form.business_phone_number.data
        gym.timezone = form.timezone.data
        gym.whatsapp_enabled = form.whatsapp_enabled.data
        gym.welcome_message_template = form.welcome_message_template.data.strip()
        gym.renewal_reminder_template = form.renewal_reminder_template.data.strip()
        if gym.whatsapp_enabled:
            result = WhatsAppService(gym).connect_webhooks()
            if not result.ok:
                db.session.rollback()
                flash(f"Could not connect WhatsApp number: {result.error}", "danger")
                return redirect(url_for("gym.whatsapp_settings"))
        try:
            audit(
                action="update_whatsapp_settings",
                resource_type="gym",
                resource_id=gym.id,
                metadata={"whatsapp_enabled": gym.whatsapp_enabled},
            )
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            flash("That WhatsApp number is already connected to another gym.", "danger")
            return redirect(url_for("gym.whatsapp_settings"))
        flash("WhatsApp settings saved.", "success")
        return redirect(url_for("gym.whatsapp_settings"))
    return render_template(
        "gym/whatsapp_settings.html",
        form=form,
        gym=gym,
        diagnostics=_whatsapp_diagnostics(gym),
        platform_delivery_enabled=bool(current_app.config.get("WHATSAPP_ENABLED")),
    )


@gym_bp.post("/settings/qr/remove")
@login_required
@active_gym_required
@roles_required("gym_owner")
def remove_qr():
    qr_settings = QRSettings.query.filter_by(gym_id=current_user.gym_id).first_or_404()
    old_path = qr_settings.qr_image_path
    old_media_url = _whatsapp_media_cache_url(qr_settings)
    if old_path and not old_path.startswith(("http://", "https://")):
        try:
            delete_local_upload(old_path)
        except Exception:
            current_app.logger.exception(
                "Could not remove local QR upload for gym %s",
                current_user.gym_id,
            )
    qr_settings.qr_public_url = None
    qr_settings.qr_image_path = None
    qr_settings.is_active = False
    invalidate_whatsapp_media_cache(current_user.gym.phone_number_id, old_media_url)
    audit(action="remove_qr_settings", resource_type="qr_settings", resource_id=qr_settings.id)
    db.session.commit()
    flash("Payment QR removed.", "success")
    return redirect(url_for("gym.settings"))


def _whatsapp_media_cache_url(qr_settings: QRSettings) -> str | None:
    if qr_settings.qr_public_url:
        return normalize_public_media_url(qr_settings.qr_public_url) or None
    if qr_settings.qr_image_path and qr_settings.qr_image_path.startswith(("http://", "https://")):
        return normalize_public_media_url(qr_settings.qr_image_path) or None
    return None


def _whatsapp_diagnostics(gym: Gym) -> list[dict[str, str | bool]]:
    reminder_template_name = current_app.config.get("WHATSAPP_REMINDER_TEMPLATE_NAME", "")
    return [
        {
            "label": "Platform delivery",
            "ok": bool(current_app.config.get("WHATSAPP_ENABLED")),
            "detail": "WHATSAPP_ENABLED=true" if current_app.config.get("WHATSAPP_ENABLED") else "Off in env",
        },
        {
            "label": "Access token",
            "ok": bool(current_app.config.get("WHATSAPP_ACCESS_TOKEN")),
            "detail": "Set" if current_app.config.get("WHATSAPP_ACCESS_TOKEN") else "Missing",
        },
        {
            "label": "Webhook secret",
            "ok": bool(current_app.config.get("WHATSAPP_WEBHOOK_SECRET")),
            "detail": "Set" if current_app.config.get("WHATSAPP_WEBHOOK_SECRET") else "Missing",
        },
        {
            "label": "Verify token",
            "ok": bool(current_app.config.get("WHATSAPP_VERIFY_TOKEN")),
            "detail": "Set" if current_app.config.get("WHATSAPP_VERIFY_TOKEN") else "Missing",
        },
        {
            "label": "Public URL",
            "ok": bool(current_app.config.get("PUBLIC_BASE_URL")),
            "detail": current_app.config.get("PUBLIC_BASE_URL") or "Missing",
        },
        {
            "label": "Gym phone ID",
            "ok": bool(gym.phone_number_id),
            "detail": "Set" if gym.phone_number_id else "Missing",
        },
        {
            "label": "Template fallback",
            "ok": bool(reminder_template_name),
            "detail": (
                reminder_template_name
                if reminder_template_name
                else "Not configured; WhatsApp Settings message must be inside Meta's 24-hour window"
            ),
        },
    ]


@gym_bp.route("/templates/new", methods=["GET", "POST"])
@gym_bp.route("/templates/<int:template_id>/edit", methods=["GET", "POST"])
@login_required
@active_gym_required
@roles_required("gym_owner")
def template_form(template_id: int | None = None):
    template = None
    if template_id:
        template = NotificationTemplate.query.filter_by(
            id=template_id, gym_id=current_user.gym_id
        ).first_or_404()
    form = NotificationTemplateForm(obj=template)
    if template is None and request.method == "GET":
        form.is_active.data = True
    if form.validate_on_submit():
        if template is None:
            template = NotificationTemplate(gym_id=current_user.gym_id)
            db.session.add(template)
        template.name = form.name.data
        template.days_before = form.days_before.data
        template.message_body = form.message_body.data
        template.is_active = form.is_active.data
        db.session.flush()
        audit(
            action="save_notification_template",
            resource_type="notification_template",
            resource_id=template.id,
        )
        db.session.commit()
        flash("Reminder template saved.", "success")
        return redirect(url_for("gym.settings"))
    return render_template("gym/template_form.html", form=form, template=template)


@gym_bp.route("/plans", methods=["GET", "POST"])
@login_required
@active_gym_required
@roles_required("gym_owner")
def plans():
    form = MembershipPlanForm()
    if form.validate_on_submit():
        plan = MembershipPlan(
            gym_id=current_user.gym_id,
            name=form.name.data.strip(),
            duration_days=int(form.duration_days.data),
            price=form.price.data,
        )
        db.session.add(plan)
        try:
            db.session.flush()
            audit(action="create_plan", resource_type="membership_plan", resource_id=plan.id)
            db.session.commit()
            flash("Membership plan created.", "success")
            return redirect(url_for("gym.plans"))
        except IntegrityError:
            db.session.rollback()
            flash("A plan with this name already exists.", "danger")
    plans_list = (
        MembershipPlan.query.filter_by(gym_id=current_user.gym_id)
        .order_by(MembershipPlan.is_active.desc(), MembershipPlan.name.asc())
        .all()
    )
    return render_template("gym/plans.html", form=form, plans=plans_list)


@gym_bp.post("/plans/<int:plan_id>/toggle")
@login_required
@active_gym_required
@roles_required("gym_owner")
def toggle_plan(plan_id: int):
    plan = TenantRepository(MembershipPlan, current_user.gym_id).get_or_404(plan_id)
    plan.is_active = not plan.is_active
    audit(action="toggle_plan", resource_type="membership_plan", resource_id=plan.id)
    db.session.commit()
    flash("Plan status updated.", "success")
    return redirect(url_for("gym.plans"))
