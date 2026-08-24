from __future__ import annotations

from flask import Blueprint, abort, flash, redirect, render_template, request, url_for
from flask_login import login_required
from sqlalchemy import func, select
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models import Gym, Member, PaymentVerification, ReminderLog, User
from app.services.audit_service import audit
from app.services.bridge_service import queue_membership_command
from app.utils.decorators import roles_required


admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


@admin_bp.route("/")
@login_required
@roles_required("super_admin")
def dashboard():
    stats = {
        "gyms": Gym.query.count(),
        "active_gyms": Gym.query.filter_by(status="active").count(),
        "members": Member.query.filter(Member.deleted_at.is_(None)).count(),
        "sent_reminders": ReminderLog.query.filter_by(status="sent").count(),
        "revenue_verified": PaymentVerification.query.with_entities(
            func.coalesce(func.sum(PaymentVerification.amount), 0)
        )
        .filter_by(status="verified")
        .scalar(),
    }
    recent_gyms = Gym.query.order_by(Gym.created_at.desc()).limit(8).all()
    failed_reminders = (
        ReminderLog.query.filter_by(status="failed")
        .options(joinedload(ReminderLog.member))
        .order_by(ReminderLog.created_at.desc())
        .limit(8)
        .all()
    )
    return render_template(
        "admin/dashboard.html",
        stats=stats,
        recent_gyms=recent_gyms,
        failed_reminders=failed_reminders,
    )


@admin_bp.route("/gyms")
@login_required
@roles_required("super_admin")
def gyms():
    page = request.args.get("page", 1, type=int)
    status = request.args.get("status", "")
    query = Gym.query
    if status:
        query = query.filter_by(status=status)
    pagination = query.order_by(Gym.created_at.desc()).paginate(
        page=page, per_page=20, error_out=False
    )
    return render_template("admin/gyms.html", pagination=pagination, status=status)


@admin_bp.post("/gyms/<int:gym_id>/toggle")
@login_required
@roles_required("super_admin")
def toggle_gym(gym_id: int):
    gym = (
        db.session.execute(select(Gym).where(Gym.id == gym_id).with_for_update())
        .scalar_one_or_none()
    )
    if gym is None:
        abort(404)
    gym.status = "suspended" if gym.status == "active" else "active"
    audit(action="toggle_gym_status", resource_type="gym", resource_id=gym.id, gym_id=gym.id)
    db.session.commit()
    flash(f"{gym.name} is now {gym.status}.", "success")
    return redirect(url_for("admin.gyms"))


@admin_bp.route("/gyms/<int:gym_id>")
@login_required
@roles_required("super_admin")
def gym_detail(gym_id: int):
    from datetime import date
    from app.models.bot import FeatureEntitlement, GymBotConfig
    from app.models.bridge import BridgeInstallation

    gym = Gym.query.get_or_404(gym_id)
    stats = {
        "users": User.query.filter_by(gym_id=gym.id).count(),
        "members": Member.query.filter_by(gym_id=gym.id).filter(Member.deleted_at.is_(None)).count(),
        "pending_payments": PaymentVerification.query.filter_by(gym_id=gym.id, status="pending").count(),
        "sent_reminders": ReminderLog.query.filter_by(gym_id=gym.id, status="sent").count(),
    }
    users = User.query.filter_by(gym_id=gym.id).order_by(User.created_at.desc()).limit(100).all()

    # Load entitlements
    known_features = ["whatsapp_bot", "renewal_desk", "biometric", "advanced_reports"]
    entitlements = {
        e.feature: e for e in FeatureEntitlement.query.filter_by(gym_id=gym.id).all()
    }
    for feat in known_features:
        if feat not in entitlements:
            entitlements[feat] = FeatureEntitlement(gym_id=gym.id, feature=feat, enabled=False)

    # Load bot config
    bot_config = GymBotConfig.query.filter_by(gym_id=gym.id).first()
    if not bot_config:
        bot_config = GymBotConfig(gym_id=gym.id)

    bridge = BridgeInstallation.query.filter_by(gym_id=gym.id).first()

    return render_template(
        "admin/gym_detail.html",
        gym=gym,
        stats=stats,
        users=users,
        entitlements=entitlements,
        bot_config=bot_config,
        bridge=bridge,
        today=date.today(),
    )


@admin_bp.post("/gyms/<int:gym_id>/whatsapp")
@login_required
@roles_required("super_admin")
def update_gym_whatsapp(gym_id: int):
    from app.services.whatsapp_service import WhatsAppService

    gym = (
        db.session.execute(select(Gym).where(Gym.id == gym_id).with_for_update())
        .scalar_one_or_none()
    )
    if gym is None:
        abort(404)

    phone_number_id = (request.form.get("phone_number_id") or "").strip() or None
    waba_id = (request.form.get("whatsapp_business_account_id") or "").strip() or None
    business_phone = (request.form.get("business_phone_number") or "").strip() or None
    enabled = request.form.get("whatsapp_enabled") == "on"

    # Check for uniqueness if phone_number_id changed
    if phone_number_id and phone_number_id != gym.phone_number_id:
        existing = Gym.query.filter(Gym.phone_number_id == phone_number_id, Gym.id != gym.id).first()
        if existing:
            flash(f"Phone Number ID '{phone_number_id}' is already assigned to {existing.name}.", "danger")
            return redirect(url_for("admin.gym_detail", gym_id=gym.id))

    gym.phone_number_id = phone_number_id
    gym.whatsapp_business_account_id = waba_id
    gym.business_phone_number = business_phone
    gym.whatsapp_enabled = enabled

    if enabled and gym.phone_number_id and gym.whatsapp_business_account_id:
        result = WhatsAppService(gym).connect_webhooks()
        if not result.ok:
            flash(f"Saved, but Meta webhook subscription warning: {result.error}", "warning")

    audit(action="admin_update_whatsapp", resource_type="gym", resource_id=gym.id, gym_id=gym.id)
    db.session.commit()
    flash(f"WhatsApp configuration for {gym.name} updated successfully.", "success")
    return redirect(url_for("admin.gym_detail", gym_id=gym.id))


@admin_bp.post("/gyms/<int:gym_id>/entitlements")
@login_required
@roles_required("super_admin")
def update_gym_entitlements(gym_id: int):
    from datetime import datetime, timezone
    from app.models.bot import FeatureEntitlement

    gym = Gym.query.get_or_404(gym_id)
    features = ["whatsapp_bot", "renewal_desk", "biometric", "advanced_reports"]

    for feat in features:
        enabled = request.form.get(f"feat_{feat}") == "on"
        expiry_str = (request.form.get(f"expiry_{feat}") or "").strip()
        expires_at = None
        if expiry_str:
            try:
                dt = datetime.strptime(expiry_str, "%Y-%m-%d")
                expires_at = dt.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
            except ValueError:
                pass

        ent = FeatureEntitlement.query.filter_by(gym_id=gym.id, feature=feat).first()
        if not ent:
            ent = FeatureEntitlement(gym_id=gym.id, feature=feat, enabled=enabled, expires_at=expires_at)
            db.session.add(ent)
        else:
            ent.enabled = enabled
            ent.expires_at = expires_at

    audit(action="admin_update_entitlements", resource_type="gym", resource_id=gym.id, gym_id=gym.id)
    db.session.commit()
    flash(f"Feature entitlements for {gym.name} updated successfully.", "success")
    return redirect(url_for("admin.gym_detail", gym_id=gym.id))


@admin_bp.post("/gyms/<int:gym_id>/bot-config")
@login_required
@roles_required("super_admin")
def update_gym_bot_config(gym_id: int):
    from decimal import Decimal
    from app.models.bot import GymBotConfig

    gym = Gym.query.get_or_404(gym_id)
    cfg = GymBotConfig.query.filter_by(gym_id=gym.id).first()
    if not cfg:
        cfg = GymBotConfig(gym_id=gym.id)
        db.session.add(cfg)

    cfg.greeting_message = (request.form.get("greeting_message") or "").strip() or None
    cfg.opening_hours = (request.form.get("opening_hours") or "").strip() or None
    cfg.map_link = (request.form.get("map_link") or "").strip() or None
    cfg.payment_link = (request.form.get("payment_link") or "").strip() or None
    cfg.registration_link = (request.form.get("registration_link") or "").strip() or None

    cfg.trial_enabled = request.form.get("trial_enabled") == "on"
    trial_price_str = (request.form.get("trial_price") or "").strip()
    if trial_price_str:
        try:
            cfg.trial_price = Decimal(trial_price_str)
        except Exception:
            cfg.trial_price = None
    else:
        cfg.trial_price = None

    trial_dur_str = (request.form.get("trial_duration_days") or "").strip()
    cfg.trial_duration_days = int(trial_dur_str) if trial_dur_str.isdigit() else 1

    cfg.followup_enabled = request.form.get("followup_enabled") == "on"
    cfg.handover_enabled = request.form.get("handover_enabled") == "on"

    audit(action="admin_update_bot_config", resource_type="gym", resource_id=gym.id, gym_id=gym.id)
    db.session.commit()
    flash(f"AI Receptionist settings for {gym.name} updated.", "success")
    return redirect(url_for("admin.gym_detail", gym_id=gym.id))


@admin_bp.post("/gyms/<int:gym_id>/settings")
@login_required
@roles_required("super_admin")
def update_gym_settings(gym_id: int):
    from datetime import datetime

    gym = Gym.query.get_or_404(gym_id)

    name = (request.form.get("name") or "").strip()
    email = (request.form.get("email") or "").strip() or None
    phone = (request.form.get("phone") or "").strip() or None
    timezone_val = (request.form.get("timezone") or "Asia/Kolkata").strip()
    sub_status = request.form.get("subscription_status") or "active"
    status_val = request.form.get("status") or "active"
    max_members_str = (request.form.get("max_members") or "").strip()

    if name:
        gym.name = name
    gym.email = email
    gym.phone = phone
    gym.timezone = timezone_val
    gym.subscription_status = sub_status
    gym.status = status_val
    gym.max_members = int(max_members_str) if max_members_str.isdigit() else None

    trial_end_str = (request.form.get("trial_ends_at") or "").strip()
    if trial_end_str:
        try:
            gym.trial_ends_at = datetime.strptime(trial_end_str, "%Y-%m-%d").date()
        except ValueError:
            pass

    audit(action="admin_update_gym_settings", resource_type="gym", resource_id=gym.id, gym_id=gym.id)
    db.session.commit()
    flash(f"Gym profile for {gym.name} updated.", "success")
    return redirect(url_for("admin.gym_detail", gym_id=gym.id))


@admin_bp.post("/gyms/<int:gym_id>/bridge/create")
@login_required
@roles_required("super_admin")
def create_gym_bridge(gym_id: int):
    from app.models.bridge import BridgeInstallation

    gym = Gym.query.get_or_404(gym_id)
    device_serial = (request.form.get("device_serial") or "").strip()
    if not device_serial:
        flash("Device serial number is required to provision Biometric Bridge.", "danger")
        return redirect(url_for("admin.gym_detail", gym_id=gym.id))

    existing = BridgeInstallation.query.filter_by(device_serial=device_serial).first()
    if existing and existing.gym_id != gym.id:
        flash(f"Device serial '{device_serial}' is already bound to another gym.", "danger")
        return redirect(url_for("admin.gym_detail", gym_id=gym.id))

    bridge = BridgeInstallation.query.filter_by(gym_id=gym.id).first()
    if bridge:
        raw_key = bridge.rotate_key()
        bridge.device_serial = device_serial
    else:
        bridge, raw_key = BridgeInstallation.create_for_gym(
            gym_id=gym.id,
            display_name=f"{gym.name} Turnstile Bridge",
            device_serial=device_serial,
        )
        db.session.add(bridge)

    audit(action="admin_provision_bridge", resource_type="bridge_installation", resource_id=bridge.id, gym_id=gym.id)
    db.session.commit()
    flash(
        f"Biometric Bridge Key generated for {gym.name}! Save this key now (shown once): {raw_key}",
        "success",
    )
    return redirect(url_for("admin.gym_detail", gym_id=gym.id))


@admin_bp.post("/gyms/<int:gym_id>/users/<int:user_id>/reset-password")
@login_required
@roles_required("super_admin")
def reset_user_password(gym_id: int, user_id: int):
    user = User.query.filter_by(id=user_id, gym_id=gym_id).first_or_404()
    new_pass = (request.form.get("new_password") or "").strip()
    if len(new_pass) < 6:
        flash("Password must be at least 6 characters long.", "danger")
        return redirect(url_for("admin.gym_detail", gym_id=gym_id))

    user.set_password(new_pass)
    user.failed_login_count = 0
    user.locked_until = None
    audit(action="admin_reset_password", resource_type="user", resource_id=user.id, gym_id=gym_id)
    db.session.commit()
    flash(f"Password for {user.email} was reset successfully.", "success")
    return redirect(url_for("admin.gym_detail", gym_id=gym_id))


@admin_bp.post("/gyms/<int:gym_id>/delete")
@login_required
@roles_required("super_admin")
def delete_gym(gym_id: int):
    import csv
    import io

    from app.models.mixins import utcnow

    gym = Gym.query.get_or_404(gym_id)
    if request.form.get("confirm") != gym.slug:
        flash("Type the gym slug to confirm deletion.", "danger")
        return redirect(url_for("admin.gym_detail", gym_id=gym_id))

    members = Member.query.filter_by(gym_id=gym_id).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "full_name", "phone", "email", "membership_end", "status"])
    for member in members:
        writer.writerow(
            [
                member.id,
                member.full_name,
                member.phone,
                member.email or "",
                member.membership_end,
                member.status,
            ]
        )
        member.deleted_at = utcnow()
        member.status = "deleted"
        queue_membership_command(member)

    gym.status = "suspended"
    audit(
        action="delete_gym",
        resource_type="gym",
        resource_id=gym_id,
        gym_id=gym_id,
        metadata={"member_count": len(members), "slug": gym.slug, "export_bytes": len(output.getvalue())},
    )
    db.session.commit()
    flash(
        f"Gym {gym.name} has been suspended and member data soft-deleted. "
        "Schedule hard deletion after the retention window.",
        "success",
    )
    return redirect(url_for("admin.gyms"))
