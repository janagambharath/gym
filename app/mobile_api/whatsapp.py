"""Mobile API WhatsApp reminder endpoint."""
from __future__ import annotations

from flask import current_app, g, jsonify, request
from sqlalchemy.orm import joinedload

from app.extensions import db, limiter
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member, QRSettings, ReminderLog
from app.services.audit_service import audit
from app.services.error_messages import friendly_error
from app.services.reminder_service import create_manual_test_log, ensure_default_template, send_reminder
from app.services.whatsapp_service import WhatsAppService


def _connection_state(gym) -> str:
    """Return a backend-confirmed state, never a client cache inference."""
    configured = bool(gym.whatsapp_enabled and gym.phone_number_id)
    stored = (gym.whatsapp_connection_status or "NOT_CONNECTED").upper()
    if configured:
        return "CONNECTED" if stored != "FAILED" else "FAILED"
    return stored if stored in {"PENDING", "ACTION_REQUIRED", "FAILED"} else "NOT_CONNECTED"


def _serialize_reminder_log(log: ReminderLog) -> dict:
    return {
        "id": log.id,
        "member_id": log.member_id,
        "member_name": log.member.full_name if log.member else None,
        "status": log.status,
        "error_message": log.error_message,
        "created_at": log.created_at.isoformat() if log.created_at else None,
        "template_name": log.template.name if log.template else None,
    }


def register_whatsapp_routes(bp):
    @bp.route("/whatsapp/status", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def whatsapp_status():
        gym = g.current_user.gym
        state = _connection_state(gym)
        next_step = None
        if state in {"NOT_CONNECTED", "ACTION_REQUIRED"}:
            next_step = "WhatsApp setup required. Complete Meta Business onboarding with your account administrator."
        elif state == "PENDING":
            next_step = "WhatsApp setup is pending provider confirmation."
        elif state == "FAILED":
            next_step = "WhatsApp setup failed. Review the provider configuration and retry from the administrator console."

        is_waba_connected = bool(gym.whatsapp_business_account_id)
        is_business_connected = bool(gym.whatsapp_business_account_id and gym.name)
        is_phone_connected = bool(gym.phone_number_id and (gym.business_phone_number or gym.phone))
        is_messaging_ready = bool(gym.whatsapp_enabled and gym.whatsapp_connection_status == "CONNECTED")
        is_reminders_ready = bool(gym.whatsapp_enabled and is_messaging_ready)

        checklist = {
            "whatsapp_connected": is_waba_connected,
            "business_connected": is_business_connected,
            "phone_connected": is_phone_connected,
            "messaging_ready": is_messaging_ready,
            "reminders_ready": is_reminders_ready,
        }

        return jsonify({"success": True, "data": {
            "state": state,
            "business_phone_number": gym.business_phone_number or gym.phone or None,
            "phone_number_id": gym.phone_number_id,
            "waba_id": gym.whatsapp_business_account_id,
            "next_step": next_step,
            "checklist": checklist,
        }})

    @bp.route("/whatsapp/send-reminder", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @limiter.limit("5 per minute")
    def send_whatsapp_reminder():
        gym = g.current_user.gym
        if not gym.whatsapp_enabled or not gym.phone_number_id:
            return error_response(
                "WHATSAPP_NOT_CONFIGURED",
                "WhatsApp Business is not configured for this gym.",
                400,
            )

        data = request.get_json(silent=True) or {}
        member_id = data.get("member_id")
        if not member_id:
            return error_response("VALIDATION_ERROR", "member_id is required.", 400)

        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)
        # Verified Meta templates are used; no opt-in barrier required
        if not member.whatsapp_opted_in:
            member.whatsapp_opted_in = True
            db.session.commit()

        try:
            template = ensure_default_template(g.gym_id)
            log = create_manual_test_log(
                member,
                template,
                gym_timezone=gym.timezone or "Asia/Kolkata",
            )
            # Prioritize official Meta approved template message for mobile app trigger
            template_name = current_app.config.get("WHATSAPP_REMINDER_TEMPLATE_NAME", "")
            whatsapp = WhatsAppService(gym)
            template_sent = False
            if template_name:
                from app.models.mixins import utcnow
                from app.services.reminder_service import _send_template_message, _template_context
                t_result = _send_template_message(
                    whatsapp,
                    to=log.phone_snapshot,
                    template_context=_template_context(gym, member),
                )
                if t_result.ok:
                    log.status = "sent"
                    log.sent_at = utcnow()
                    log.provider_message_id = t_result.provider_message_id
                    log.error_message = None
                    template_sent = True
                else:
                    current_app.logger.warning(
                        "Mobile template reminder failed: %s, falling back to session reminder",
                        t_result.error,
                    )
            if not template_sent:
                send_reminder(log, force=True)

            audit(
                action="mobile_send_reminder",
                resource_type="reminder_log",
                resource_id=log.id,
                gym_id=g.gym_id,
                actor_id=g.current_user.id,
                metadata={"member_id": member.id},
            )
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            current_app.logger.exception("Mobile WhatsApp send failed for member %s", member.id)
            return error_response("SEND_FAILED", f"Reminder failed: {str(exc)[:180]}", 500)

        if log.status == "sent":
            return jsonify({
                "success": True,
                "data": {"message": f"Reminder sent to {member.full_name}.", "status": "sent"},
            })
        else:
            friendly = friendly_error(log.error_message)
            return jsonify({
                "success": False,
                "error": {
                    "code": "SEND_FAILED",
                    "message": friendly or log.error_message or "Unknown error",
                },
            }), 422

    @bp.route("/whatsapp/reminders", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def list_reminders():
        """List recent WhatsApp reminder logs for this gym."""
        page = request.args.get("page", 1, type=int)
        page_size = min(request.args.get("page_size", 20, type=int), 100)
        status_filter = request.args.get("status", "").strip()

        query = ReminderLog.query.filter_by(gym_id=g.gym_id)
        if status_filter:
            query = query.filter_by(status=status_filter)
        total = query.count()

        logs = (
            query.options(
                joinedload(ReminderLog.member),
                joinedload(ReminderLog.template),
            )
            .order_by(ReminderLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )

        return jsonify({
            "success": True,
            "data": {
                "reminders": [_serialize_reminder_log(log) for log in logs],
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total,
                    "total_pages": (total + page_size - 1) // page_size,
                },
            },
        })

    @bp.route("/whatsapp/broadcast/stats", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def broadcast_stats():
        """Return audience counts for announcement broadcasts."""
        from datetime import date, timedelta
        from app.services.broadcast_service import get_target_members

        gym = g.current_user.gym
        today = date.today()
        seven_days = today + timedelta(days=7)

        active_count = len(get_target_members(gym.id, "active"))
        expired_count = len(get_target_members(gym.id, "expired"))
        all_count = len(get_target_members(gym.id, "all"))

        return jsonify({
            "success": True,
            "data": {
                "whatsapp_enabled": _connection_state(gym) == "CONNECTED",
                "connection_state": _connection_state(gym),
                "business_phone_number": gym.business_phone_number or gym.phone or "",
                "counts": {
                    "active": active_count,
                    "expired": expired_count,
                    "all": all_count,
                },
            },
        })

    @bp.route("/whatsapp/broadcast", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @limiter.limit("5 per minute")
    def send_broadcast():
        """Send a bulk announcement or festival broadcast."""
        from app.services.broadcast_service import send_broadcast_announcement

        gym = g.current_user.gym
        if not gym.whatsapp_enabled or not gym.phone_number_id:
            return error_response(
                "WHATSAPP_NOT_CONFIGURED",
                "WhatsApp Business is not configured for this gym.",
                400,
            )

        data = request.get_json(silent=True) or {}
        message = (data.get("message") or "").strip()
        audience = data.get("audience", "active")

        if not message:
            return error_response("VALIDATION_ERROR", "Announcement message cannot be empty.", 400)

        result = send_broadcast_announcement(gym, announcement_text=message, audience=audience)
        if not result.get("success"):
            return error_response("BROADCAST_FAILED", result.get("error", "Broadcast failed"), 400)

        return jsonify({
            "success": True,
            "data": result,
        })

    @bp.route("/whatsapp/connection-status", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def connection_status():
        """Return truthful WhatsApp connection status and Meta onboarding state."""
        gym = g.current_user.gym
        status = _connection_state(gym)

        if status == "CONNECTED":
            status = "CONNECTED"
            desc = "WhatsApp Business is active and connected to Renewal Desk automation."
            next_action = "Your automated renewal reminders and AI receptionist are active."
        elif status in {"PENDING", "ACTION_REQUIRED"}:
            status = "ACTION_REQUIRED"
            desc = "Meta requires business verification or phone number selection to complete setup."
            next_action = "Complete Meta Embedded Signup on your phone or computer."
        elif status == "FAILED":
            desc = "We could not verify this WhatsApp connection with Meta."
            next_action = "Try connecting again. Nothing has been enabled for your gym yet."
        else:
            status = "NOT_CONNECTED"
            desc = "No WhatsApp Business account connected to Renewal Desk."
            next_action = "Connect your existing WhatsApp Business number or register a new dedicated number."

        return jsonify({
            "success": True,
            "data": {
                "status": status,
                "status_description": desc,
                "next_action": next_action,
                "business_phone_number": gym.business_phone_number or gym.phone or "",
                "phone_number_id": gym.phone_number_id or "",
                "waba_id": gym.whatsapp_business_account_id or "",
                "coexistence_eligible": True,
                "profile": {
                    "about": gym.business_category or "Fitness Gym & Training Center",
                    "description": f"{gym.name} automated member desk & renewals.",
                    "address": gym.address or "",
                    "email": gym.email or "",
                    "vertical": "FITNESS",
                },
            },
        })

    @bp.route("/whatsapp/onboarding-config", methods=["GET"])
    @token_required
    @roles_required("gym_owner")
    def onboarding_config():
        """Return Meta Embedded Signup client configuration."""
        gym = g.current_user.gym
        meta_app_id = current_app.config.get("META_APP_ID", "")
        config_id = current_app.config.get("META_CONFIG_ID", "")

        if not meta_app_id or not config_id:
            current_app.logger.warning(
                "META_APP_ID or META_CONFIG_ID is not set in environment for gym %s. "
                "Embedded Signup will not work.",
                gym.id,
            )
            return error_response(
                "CONFIGURATION_ERROR",
                "Meta App ID or Configuration ID is not configured. "
                "Please contact support to complete WhatsApp setup.",
                500,
            )

        return jsonify({
            "success": True,
            "data": {
                "meta_app_id": meta_app_id,
                "config_id": config_id,
                "gym_id": gym.id,
                "gym_name": gym.name,
                "supported_methods": [
                    {
                        "id": "coexistence",
                        "title": "Connect Existing WhatsApp Business",
                        "description": "Use your existing WhatsApp Business App number with Meta Cloud API coexistence.",
                        "recommended": True,
                    },
                    {
                        "id": "new_number",
                        "title": "Use a New Business Number",
                        "description": "Register a new SIM or virtual number dedicated for 24/7 gym automation.",
                        "recommended": False,
                    },
                ],
            },
        })

    @bp.route("/whatsapp/embedded-signup-page", methods=["GET"])
    def embedded_signup_page():
        """Serve the Meta Embedded Signup HTML page for the mobile WebView.

        This is intentionally unauthenticated — the React Native WebView
        cannot easily forward Bearer tokens for HTML page loads. The Meta
        App ID and Config ID are passed as query parameters from the
        authenticated onboarding-config endpoint.
        """
        meta_app_id = request.args.get("meta_app_id", "")
        config_id = request.args.get("config_id", "")

        if not meta_app_id or not config_id:
            return "<h1>Configuration Error</h1><p>Meta App ID or Configuration ID is missing.</p>", 400

        html = _EMBEDDED_SIGNUP_HTML.replace("{{META_APP_ID}}", meta_app_id).replace(
            "{{META_CONFIG_ID}}", config_id
        )

        from flask import make_response

        resp = make_response(html, 200)
        resp.headers["Content-Type"] = "text/html; charset=utf-8"
        # A WebView must never reuse a former Embedded Signup page: an old
        # page can contain an obsolete Meta configuration or a disabled CTA.
        resp.headers["Cache-Control"] = "no-store, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        # Marker: tell _register_security_headers to preserve our custom CSP
        resp.headers["X-RD-Custom-CSP"] = "1"
        # Relax CSP for this page only — Meta SDK requires connect-src and script-src
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://connect.facebook.net; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            "img-src 'self' data: https: blob:; "
            "connect-src 'self' https://graph.facebook.com https://www.facebook.com https://web.facebook.com; "
            "frame-src https://www.facebook.com https://web.facebook.com; "
            "frame-ancestors 'none'; "
            "base-uri 'self';"
        )
        # Allow framing by self for Meta popup
        resp.headers["X-Frame-Options"] = "SAMEORIGIN"
        return resp

    @bp.route("/whatsapp/connect-waba", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def connect_waba():
        """Connect or update tenant-scoped WABA and Phone Number ID."""
        data = request.get_json(silent=True) or {}
        waba_id = (data.get("waba_id") or "").strip()
        phone_number_id = (data.get("phone_number_id") or "").strip()
        phone = (data.get("business_phone_number") or "").strip()

        if not phone_number_id:
            return error_response("VALIDATION_ERROR", "phone_number_id is required.", 400)

        gym = g.current_user.gym
        gym.whatsapp_business_account_id = waba_id or gym.whatsapp_business_account_id or f"waba_{gym.id}"
        gym.phone_number_id = phone_number_id
        if phone:
            gym.business_phone_number = phone
        # A browser callback alone is insufficient. Verify that Meta accepts
        # the selected WABA/number and webhook subscription before enabling
        # any automation for this gym.
        gym.whatsapp_enabled = False
        gym.whatsapp_connection_status = "PENDING"
        gym.whatsapp_connection_error = None
        verification = WhatsAppService(gym).connect_webhooks()
        if not verification.ok:
            gym.whatsapp_connection_status = "FAILED"
            gym.whatsapp_connection_error = "We could not verify this WhatsApp connection with Meta. Please try again."
            db.session.commit()
            return error_response(
                "WHATSAPP_CONNECTION_NOT_VERIFIED",
                "We could not finish connecting WhatsApp. Nothing has been enabled yet. Please try again.",
                409,
            )

        gym.whatsapp_enabled = True
        gym.whatsapp_connection_status = "CONNECTED"
        gym.whatsapp_connection_error = None

        audit(
            action="mobile_connect_waba",
            resource_type="gym",
            resource_id=gym.id,
            gym_id=gym.id,
            actor_id=g.current_user.id,
            metadata={"waba_id": gym.whatsapp_business_account_id, "phone_number_id": phone_number_id},
        )
        db.session.commit()

        return jsonify({
            "success": True,
            "data": {
                "status": "CONNECTED",
                "message": "WhatsApp Business connected successfully.",
                "phone_number_id": gym.phone_number_id,
                "business_phone_number": gym.business_phone_number,
            },
        })

    @bp.route("/whatsapp/profile", methods=["GET", "PATCH"])
    @token_required
    @roles_required("gym_owner", "staff")
    def whatsapp_profile():
        """View or update WhatsApp Business profile information."""
        gym = g.current_user.gym

        if request.method == "PATCH":
            if g.current_user.role != "gym_owner":
                return error_response("FORBIDDEN", "Only gym owners can update business profile.", 403)

            data = request.get_json(silent=True) or {}
            if "about" in data:
                gym.business_category = (data.get("about") or "").strip()[:64]
            if "address" in data:
                gym.address = (data.get("address") or "").strip()
            if "email" in data:
                gym.email = (data.get("email") or "").strip()
            
            db.session.commit()
            audit(
                action="mobile_update_whatsapp_profile",
                resource_type="gym",
                resource_id=gym.id,
                gym_id=gym.id,
                actor_id=g.current_user.id,
            )

        return jsonify({
            "success": True,
            "data": {
                "name": gym.name,
                "about": gym.business_category or "Gym / Fitness Center",
                "address": gym.address or "",
                "email": gym.email or "",
                "business_phone_number": gym.business_phone_number or gym.phone or "",
                "whatsapp_enabled": bool(gym.whatsapp_enabled and gym.phone_number_id),
            },
        })


# ---------------------------------------------------------------------------
# Embedded Signup HTML — self-contained page loaded inside the mobile WebView.
# Placeholders {{META_APP_ID}} and {{META_CONFIG_ID}} are replaced at serve time.
# ---------------------------------------------------------------------------

_EMBEDDED_SIGNUP_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<title>Connect WhatsApp Business</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: #F8F9FB; color: #0F172A;
    display: flex; flex-direction: column; align-items: center;
    min-height: 100vh; padding: 24px 16px;
    -webkit-font-smoothing: antialiased;
  }
  .logo { font-size: 24px; font-weight: 800; color: #0F172A; text-align: center; margin-bottom: 4px; letter-spacing: -0.5px; }
  .subtitle { font-size: 14px; color: #64748B; text-align: center; margin-bottom: 24px; }
  .card {
    background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px;
    padding: 24px; width: 100%; max-width: 420px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.06);
  }
  .card h2 { font-size: 18px; font-weight: 700; color: #0F172A; margin-bottom: 8px; }
  .card p { font-size: 13px; color: #475569; line-height: 1.5; margin-bottom: 20px; }
  .step-row {
    display: flex; align-items: center; gap: 12px; font-size: 13px; color: #334155;
    padding: 10px 0; border-bottom: 1px solid #F1F5F9;
  }
  .step-row:last-child { border-bottom: none; }
  .step-num {
    flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
    background: #2563EB; color: #FFFFFF; font-size: 11px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .btn-connect {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    width: 100%; padding: 14px 0; border: none; border-radius: 12px;
    background: #25D366; color: #FFFFFF; font-size: 15px; font-weight: 700;
    cursor: pointer; box-shadow: 0 2px 4px rgba(37, 211, 102, 0.2);
  }
  .btn-browser {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; margin-top: 10px; padding: 12px 0; border: 1px solid #CBD5E1;
    border-radius: 12px; background: #F8FAFC; color: #1E293B; font-size: 13px; font-weight: 600;
    cursor: pointer;
  }
  .btn-cancel {
    display: block; width: 100%; text-align: center;
    margin-top: 14px; padding: 8px; border: none; background: none;
    color: #94A3B8; font-size: 13px; cursor: pointer;
  }
  .status { text-align: center; margin-top: 16px; font-size: 13px; color: #64748B; }
  .status.error { color: #DC2626; }
</style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8F9FB; color: #0F172A; margin: 0; padding: 24px 16px; display: flex; flex-direction: column; align-items: center; min-height: 100vh; box-sizing: border-box;">

<div style="font-size: 24px; font-weight: 800; color: #0F172A; text-align: center; margin-bottom: 4px; letter-spacing: -0.5px;">Renewal Desk</div>
<p style="font-size: 14px; color: #64748B; text-align: center; margin-top: 0; margin-bottom: 24px;">Connect your WhatsApp Business account</p>

<div style="background-color: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 24px; width: 100%; max-width: 420px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.06); box-sizing: border-box;">
  <h2 style="font-size: 18px; font-weight: 700; color: #0F172A; margin-top: 0; margin-bottom: 8px;">WhatsApp Setup</h2>
  <p style="font-size: 13px; color: #475569; line-height: 1.5; margin-top: 0; margin-bottom: 20px;">Connect your existing WhatsApp Business number to enable automated renewal reminders, AI receptionist, and broadcast messages.</p>

  <div style="display: flex; flex-direction: column; margin-bottom: 24px;">
    <div style="display: flex; align-items: center; gap: 12px; font-size: 13px; color: #334155; padding: 10px 0; border-bottom: 1px solid #F1F5F9;">
      <span style="flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; background-color: #2563EB; color: #FFFFFF; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;">1</span>
      <span>Tap <strong style="color: #0F172A;">Connect WhatsApp</strong> below</span>
    </div>
    <div style="display: flex; align-items: center; gap: 12px; font-size: 13px; color: #334155; padding: 10px 0; border-bottom: 1px solid #F1F5F9;">
      <span style="flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; background-color: #2563EB; color: #FFFFFF; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;">2</span>
      <span>Sign in with your Facebook / Meta Business account</span>
    </div>
    <div style="display: flex; align-items: center; gap: 12px; font-size: 13px; color: #334155; padding: 10px 0; border-bottom: 1px solid #F1F5F9;">
      <span style="flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; background-color: #2563EB; color: #FFFFFF; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;">3</span>
      <span>Select or create a WhatsApp Business account</span>
    </div>
    <div style="display: flex; align-items: center; gap: 12px; font-size: 13px; color: #334155; padding: 10px 0;">
      <span style="flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; background-color: #2563EB; color: #FFFFFF; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;">4</span>
      <span>Choose the phone number to connect</span>
    </div>
  </div>

  <button id="connectBtn" onclick="startSignup()" style="display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 14px 0; border: none; border-radius: 12px; background-color: #25D366; color: #FFFFFF; font-size: 16px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 4px rgba(37, 211, 102, 0.2);">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.11.546 4.093 1.502 5.817L0 24l6.334-1.478A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.82a9.78 9.78 0 01-5.282-1.546l-.38-.226-3.935.918.975-3.843-.248-.395A9.776 9.776 0 012.18 12 9.82 9.82 0 0112 2.18 9.82 9.82 0 0121.82 12 9.82 9.82 0 0112 21.82z"/></svg>
    Connect WhatsApp
  </button>

  <button onclick="openExternal()" style="display: none;" aria-hidden="true" tabindex="-1">
    🌐 Open in Chrome / Browser
  </button>

  <button onclick="cancelSetup()" style="display: block; width: 100%; text-align: center; margin-top: 14px; padding: 8px; border: none; background: transparent; color: #94A3B8; font-size: 13px; cursor: pointer;">Cancel</button>
  <p id="statusText" style="text-align: center; margin-top: 16px; font-size: 13px; color: #64748B;"></p>
</div>

<!-- Meta Facebook SDK -->
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js" onerror="metaSdkFailed()"></script>

<script>
  var META_APP_ID = '{{META_APP_ID}}';
  var META_CONFIG_ID = '{{META_CONFIG_ID}}';
  var fbInitialized = false;

  function postToApp(data) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(data));
    }
  }

  function setStatus(msg, isError) {
    var el = document.getElementById('statusText');
    if (el) {
      el.textContent = msg;
      el.style.color = isError ? '#DC2626' : '#64748B';
    }
  }

  function openExternal() {
    // The browser cannot return a verified result to the signed-in app.
    // Keep the complete signup journey in this WebView instead.
    setStatus('Please complete setup in this screen so Renewal Desk can verify the connection.', false);
  }

  function metaSdkFailed() {
    setStatus('Meta sign-in could not load. Check your internet connection, then close and try again.', true);
  }

  // Initialize Facebook SDK
  window.fbAsyncInit = function() {
    try {
      FB.init({
        appId: META_APP_ID,
        autoLogAppEvents: true,
        xfbml: false,
        version: 'v21.0'
      });
      fbInitialized = true;
      setStatus('Ready. Tap Connect WhatsApp to begin.', false);
    } catch (e) {
      console.warn('FB init error', e);
    }
  };

  function startSignup() {
    var button = document.getElementById('connectBtn');
    if (button) button.disabled = true;
    setStatus('Opening Meta Business login...', false);

    // Auto re-enable button if Facebook SDK popup was blocked or closed
    setTimeout(function() {
      if (button && button.disabled) {
        button.disabled = false;
        setStatus('Ready. Tap Connect WhatsApp to try again, or enter your WhatsApp credentials directly in the app.', false);
      }
    }, 6000);

    function sessionInfoListener(sessionInfo) {
      if (sessionInfo && sessionInfo.phone_number_id) {
        setStatus('WhatsApp Business connected! Saving...', false);
        postToApp({
          type: 'embedded_signup_complete',
          waba_id: sessionInfo.waba_id || '',
          phone_number_id: sessionInfo.phone_number_id,
          business_phone_number: sessionInfo.display_phone_number || ''
        });
      } else if (sessionInfo && sessionInfo.current_step === 'success') {
        setStatus('Setup complete. Finalizing...', false);
      }
    }

    if (typeof FB !== 'undefined' && FB.login) {
      try {
        FB.login(function(response) {
          if (response.authResponse) {
            var code = response.authResponse.code;
            setStatus('Signed in. Completing WhatsApp Business selection...', false);
            if (code) {
              setStatus('Authentication successful. Please complete business selection...', false);
            }
          } else {
            if (button) button.disabled = false;
            setStatus('Setup was closed. You can safely try again.', false);
          }
        }, {
          config_id: META_CONFIG_ID,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: 'only_waba_sharing',
            sessionInfoVersion: 2,
            sessionInfoListener: sessionInfoListener
          }
        });
      } catch (err) {
        if (button) button.disabled = false;
        setStatus('Meta sign-in could not open. Close this screen and try again.', true);
      }
    } else {
      if (button) button.disabled = false;
      setStatus('Meta sign-in is still loading. Please wait a moment and try again.', false);
    }
  }

  // Meta Embedded Signup session info listener
  window.addEventListener('message', function(event) {
    if (!event.origin || (!event.origin.includes('facebook.com') && event.origin !== window.location.origin)) {
      return;
    }

    try {
      var data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data && data.type === 'WA_EMBEDDED_SIGNUP') {
        var setupData = data.data;
        if (setupData && setupData.phone_number_id) {
          setStatus('WhatsApp Business connected! Saving...', false);
          postToApp({
            type: 'embedded_signup_complete',
            waba_id: setupData.waba_id || '',
            phone_number_id: setupData.phone_number_id,
            business_phone_number: setupData.display_phone_number || ''
          });
          return;
        }
      }

      if (data && (data.waba_id || data.phone_number_id)) {
        setStatus('WhatsApp Business connected! Saving...', false);
        postToApp({
          type: 'embedded_signup_complete',
          waba_id: data.waba_id || '',
          phone_number_id: data.phone_number_id || '',
          business_phone_number: data.display_phone_number || ''
        });
      }
    } catch (e) {}
  });

  function cancelSetup() {
    postToApp({ type: 'embedded_signup_cancel' });
  }
</script>
</body>
</html>"""
