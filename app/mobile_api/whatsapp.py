"""Mobile API WhatsApp reminder endpoint."""
from __future__ import annotations
from functools import wraps
import re

from flask import current_app, g, jsonify, request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.extensions import db, limiter
import requests
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import _is_trial_expired, roles_required, token_required
from app.mobile_api.token_service import (
    consume_handshake_token,
    create_handshake_token,
    decode_handshake_token,
)
from app.models import Gym, Member, QRSettings, ReminderLog, User
from app.services.audit_service import audit
from app.services.error_messages import friendly_error
from app.services.idempotency_service import (
    begin_idempotency,
    record_idempotency,
    replay_after_conflict,
)
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



def whatsapp_handshake_or_token_required(view):
    """Accept the embedded-signup handshake token or a normal access token.

    The handshake is minted by the authenticated onboarding-config endpoint
    and is scoped to the whatsapp_embedded_signup purpose (30 minutes).
    """
    @wraps(view)
    def wrapped(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            # Single-use (2026-10-13): consume_handshake_token atomically
            # records first use — replays return None and fall through to
            # the standard access-token flow, which rejects them.
            payload = consume_handshake_token(
                auth_header[7:], "whatsapp_embedded_signup"
            )
            if payload is not None:
                user = db.session.get(User, payload.get("sub"))
                if (
                    user is not None
                    and user.is_active
                    and user.gym_id == payload.get("gym_id")
                    and user.gym is not None
                    and user.gym.is_operational()
                ):
                    g.current_user = user
                    g.user_id = user.id
                    g.gym_id = user.gym_id
                    # W-M2: the handshake path used to bypass the trial
                    # lockdown entirely (token_required was never run).
                    # A trial-expired gym must not connect paid WhatsApp
                    # on either auth path — same code + message as the
                    # access-token path so the page displays one thing.
                    if _is_trial_expired(user.gym):
                        return error_response(
                            "SUBSCRIPTION_REQUIRED",
                            "Your free trial has ended — upgrade to connect WhatsApp.",
                            403,
                        )
                    return view(*args, **kwargs)
                return error_response("UNAUTHORIZED", "Handshake is not valid for this account.", 401)
        # Fall back to the standard access-token flow.
        return token_required(view)(*args, **kwargs)

    return wrapped


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
        # W-M1: when registration/subscription did not confirm, the stored
        # warning says so — messaging_ready must NOT claim messaging works.
        from app.services.embedded_signup_service import has_messaging_warning

        messaging_degraded = has_messaging_warning(gym)
        is_messaging_ready = bool(
            gym.whatsapp_enabled
            and gym.whatsapp_connection_status == "CONNECTED"
            and not messaging_degraded
        )
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
        # A retry after a successful send must replay instead of
        # sending the member a second reminder. NOTE: the WhatsApp
        # send happens before the final commit, so this protects the
        # sequential retry (timeout / lost response); a concurrent
        # same-key double-send can still deliver twice.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="whatsapp_send_reminder",
            headers=request.headers,
            payload=data,
        )
        if replay is not None:
            return replay

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
            if log.status == "sent":
                response_body = {
                    "success": True,
                    "data": {"message": f"Reminder sent to {member.full_name}.", "status": "sent"},
                }
                record_idempotency(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="whatsapp_send_reminder",
                    key=idempotency_key,
                    request_hash=request_hash,
                    status_code=200,
                    response_body=response_body,
                )
            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                replayed = replay_after_conflict(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="whatsapp_send_reminder",
                    key=idempotency_key,
                    request_hash=request_hash,
                )
                if replayed is not None:
                    return replayed
                raise
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

    @bp.route("/whatsapp/logs", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def whatsapp_logs():
        """Recent WhatsApp message log for the PWA WhatsApp screen.

        Same underlying data as ``/whatsapp/reminders`` but shaped for the
        PWA (``logs`` key with member/phone/template/sent_at fields).
        """
        page_size = min(request.args.get("page_size", 20, type=int), 100)

        logs = (
            ReminderLog.query.filter_by(gym_id=g.gym_id)
            .options(
                joinedload(ReminderLog.member),
                joinedload(ReminderLog.template),
            )
            .order_by(ReminderLog.created_at.desc())
            .limit(page_size)
            .all()
        )

        return jsonify({
            "success": True,
            "data": {
                "logs": [
                    {
                        "id": log.id,
                        "member_id": log.member_id,
                        "member_name": log.member.full_name if log.member else None,
                        "phone": log.phone_snapshot,
                        "template": log.template.name if log.template else log.reminder_stage,
                        "message_type": log.channel,
                        "status": log.status,
                        "sent_at": log.sent_at.isoformat() if log.sent_at else None,
                        "created_at": log.created_at.isoformat() if log.created_at else None,
                    }
                    for log in logs
                ],
            },
        })

    @bp.route("/whatsapp/broadcast/stats", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def broadcast_stats():
        """Return audience counts for announcement broadcasts."""
        from datetime import timedelta
        from app.services.broadcast_service import get_target_members
        from app.services.timezone_service import today_for_gym

        gym = g.current_user.gym
        # V10-L4: "expiring in 7 days" segments are gym-local, not
        # server-local.
        today = today_for_gym(gym.timezone or "Asia/Kolkata")
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

        # A retry after a successful broadcast must replay instead of
        # messaging the whole audience twice. Same caveat as campaign
        # send: the WhatsApp sends happen inside the service before
        # this record is committed, so this protects the sequential
        # retry (timeout / lost response), not a concurrent double-send.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="whatsapp_broadcast",
            headers=request.headers,
            payload=data,
        )
        if replay is not None:
            return replay

        result = send_broadcast_announcement(gym, announcement_text=message, audience=audience)
        if not result.get("success"):
            return error_response("BROADCAST_FAILED", result.get("error", "Broadcast failed"), 400)

        response_body = {
            "success": True,
            "data": result,
        }
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="whatsapp_broadcast",
            key=idempotency_key,
            request_hash=request_hash,
            status_code=200,
            response_body=response_body,
        )
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            replayed = replay_after_conflict(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="whatsapp_broadcast",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise

        return jsonify(response_body)

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
                # W-C1/W-M1: provisioning state + the stored non-blocking
                # warning (register/subscribe or templates). Null when
                # there is nothing to warn about. Clients must show
                # `warning` when present — a CONNECTED gym can still
                # have degraded messaging or unprovisioned templates.
                "templates_provisioned": bool(gym.whatsapp_templates_provisioned),
                "warning": gym.whatsapp_connection_error or None,
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
                # Short-lived, single-purpose token for the embedded-signup
                # WebView page. The owner's full access token must never be
                # placed in a page URL.
                "signup_handshake": create_handshake_token(
                    g.current_user.id, gym.id, "whatsapp_embedded_signup"
                ),
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
        authenticated onboarding-config endpoint, along with a short-lived
        handshake token (never the owner's full access token).
        """
        meta_app_id = request.args.get("meta_app_id", "")
        config_id = request.args.get("config_id", "")
        feature_type = request.args.get("feature_type", "")
        handshake = request.args.get("handshake", "")

        # Strict allowlists: every reflected value lands inside a JS string
        # literal, so reject anything outside the expected shapes (XSS guard).
        if not re.fullmatch(r"[0-9]{4,32}", meta_app_id):
            return "<h1>Configuration Error</h1><p>Meta App ID is missing or invalid.</p>", 400
        if not re.fullmatch(r"[A-Za-z0-9_-]{4,128}", config_id):
            return "<h1>Configuration Error</h1><p>Configuration ID is missing or invalid.</p>", 400
        if feature_type and not re.fullmatch(r"[a-z_]{1,32}", feature_type):
            return "<h1>Configuration Error</h1><p>Feature type is invalid.</p>", 400
        if not re.fullmatch(r"[A-Za-z0-9_.-]{16,512}", handshake):
            return "<h1>Configuration Error</h1><p>Signup handshake is missing or invalid.</p>", 400

        # W-H7: validate the handshake HERE, before serving a page that
        # can only fail at the final save. decode (peek) only — do NOT
        # consume: consumption happens on the connect-waba POST. An
        # expired/invalid handshake gets a clear error page instead of
        # a page that freezes on "Verifying..." after Meta signup.
        if decode_handshake_token(handshake, "whatsapp_embedded_signup") is None:
            return (
                "<h1>Signup link expired</h1>"
                "<p>This WhatsApp signup link has expired or is no longer "
                "valid. Please return to the app and tap Connect WhatsApp "
                "again to get a fresh link.</p>",
                401,
            )

        html = (
            _EMBEDDED_SIGNUP_HTML
            .replace("{{META_APP_ID}}", meta_app_id)
            .replace("{{META_CONFIG_ID}}", config_id)
            .replace("{{FEATURE_TYPE}}", feature_type)
            .replace("{{AUTH_TOKEN}}", handshake)
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
    @whatsapp_handshake_or_token_required
    @roles_required("gym_owner")
    @limiter.limit("5 per minute")
    def connect_waba():
        """Connect or update tenant-scoped WABA and Phone Number ID.

        Handles two flows:
        1. **Embedded Signup (preferred)**: Receives authorization `code` +
           `waba_id` + `phone_number_id` + `business_id` from Meta's
           postMessage callback. Runs the full automated pipeline.
        2. **Manual fallback**: Receives `waba_id` + `phone_number_id` directly.

        W-H6 dedup: if this gym is already CONNECTED with the same
        waba_id + phone_number_id, the request returns success at once
        — no Meta chain, no re-verify, no chance of a late Flow 2
        overwriting a good connect with FAILED.
        W-L9: 5 attempts/minute per IP — a retry storm from stuck
        pages must not stack 48s requests and starve the API threads.
        """
        data = request.get_json(silent=True) or {}
        waba_id = str(data.get("waba_id") or "").strip()
        phone_number_id = str(data.get("phone_number_id") or "").strip()
        code = str(data.get("code") or "").strip()
        business_id = str(data.get("business_id") or "").strip()
        phone = str(data.get("business_phone_number") or data.get("phone") or "").strip()

        if phone_number_id.lower() in ("undefined", "null", "none", "0"):
            phone_number_id = ""
        if waba_id.lower() in ("undefined", "null", "none", "0"):
            waba_id = ""

        gym = g.current_user.gym
        was_connected = bool(
            gym.whatsapp_enabled
            and gym.whatsapp_connection_status == "CONNECTED"
            and gym.phone_number_id
        )

        def _connected_response(gym_row, *, provisioning: str):
            return jsonify({
                "success": True,
                "data": {
                    "status": "CONNECTED",
                    "message": "WhatsApp Business connected successfully.",
                    "waba_id": gym_row.whatsapp_business_account_id,
                    "phone_number_id": gym_row.phone_number_id,
                    "business_phone_number": gym_row.business_phone_number,
                    "business_id": gym_row.whatsapp_meta_business_id,
                    "templates_provisioned": bool(gym_row.whatsapp_templates_provisioned),
                    "provisioning": provisioning,
                    "warning": gym_row.whatsapp_connection_error or None,
                },
            })

        def _schedule_provisioning(
            gym_id: int, waba_id: str = "", phone_number_id: str = ""
        ) -> None:
            # Best-effort, post-commit only: never fail a good connect
            # because the background thread could not start. The IDs
            # let the worker abort if the gym reconnects meanwhile.
            try:
                from app.services.template_provisioning_service import (
                    schedule_template_provisioning,
                )

                schedule_template_provisioning(
                    current_app._get_current_object(),
                    gym_id,
                    waba_id,
                    phone_number_id,
                )
            except Exception:
                current_app.logger.exception(
                    "Background template provisioning could not start gym=%s",
                    gym_id,
                )

        # ── W-H6: already CONNECTED with the same WABA + phone ──
        # Return success immediately. If templates are still pending,
        # re-trigger the background provisioning (this is also the
        # retry path for a failed provisioning run).
        if (
            was_connected
            and waba_id
            and phone_number_id
            and gym.whatsapp_business_account_id == waba_id
            and gym.phone_number_id == phone_number_id
            and (not business_id or gym.whatsapp_meta_business_id in (None, "", business_id))
        ):
            if not gym.whatsapp_templates_provisioned:
                _schedule_provisioning(
                    gym.id,
                    gym.whatsapp_business_account_id or "",
                    gym.phone_number_id or "",
                )
                return _connected_response(gym, provisioning="pending")
            return _connected_response(gym, provisioning="done")

        # ── Flow 1: Full Embedded Signup (has authorization code) ──
        if code:
            from app.services.embedded_signup_service import EmbeddedSignupService

            service = EmbeddedSignupService(gym)
            # W-H4: any unexpected exception (DB flush/commit, token
            # encryption, audit) returns a JSON error and rolls back
            # cleanly — no half-save, no uncaught 500.
            try:
                result = service.process_signup(
                    code=code,
                    waba_id=waba_id,
                    phone_number_id=phone_number_id,
                    display_phone_number=phone,
                    business_id=business_id,
                )
            except Exception:
                db.session.rollback()
                current_app.logger.exception(
                    "Embedded signup failed unexpectedly gym=%s", gym.id
                )
                return error_response(
                    "INTERNAL_ERROR",
                    "An unexpected error occurred while connecting WhatsApp. Please try again.",
                    500,
                )

            if result.ok:
                try:
                    audit(
                        action="mobile_connect_waba",
                        resource_type="gym",
                        resource_id=gym.id,
                        gym_id=gym.id,
                        actor_id=g.current_user.id,
                        metadata={
                            "waba_id": result.waba_id,
                            "phone_number_id": result.phone_number_id,
                            "business_id": result.business_id,
                            "steps": result.steps_completed,
                            "flow": "embedded_signup",
                        },
                    )
                    db.session.commit()
                except Exception:
                    db.session.rollback()
                    current_app.logger.exception(
                        "Embedded signup audit/commit failed gym=%s", gym.id
                    )
                    return error_response(
                        "INTERNAL_ERROR",
                        "WhatsApp connected at Meta but the save failed. Please try again.",
                        500,
                    )

                # W-C1/W-H5: the gym row is COMMITTED before provisioning
                # starts. Provisioning runs in a background thread, so
                # the response returns promptly and a slow/failed Meta
                # can never roll back this connect.
                if result.provisioning_pending and not gym.whatsapp_templates_provisioned:
                    _schedule_provisioning(
                        gym.id, result.waba_id, result.phone_number_id
                    )

                return jsonify({
                    "success": True,
                    "data": {
                        "status": "CONNECTED",
                        "message": "WhatsApp Business connected successfully via Embedded Signup.",
                        "waba_id": result.waba_id,
                        "phone_number_id": result.phone_number_id,
                        "business_phone_number": result.display_phone_number,
                        "business_id": result.business_id,
                        "steps_completed": result.steps_completed,
                        "warnings": result.warnings,
                        "templates_provisioned": False,
                        "provisioning": "pending",
                    },
                })
            else:
                db.session.rollback()
                # W-H6: the duplicate POST of one signup (page + app
                # firing the same single-use code) fails code exchange
                # on the second attempt even though the first already
                # committed CONNECTED. Report the stored success
                # instead of a 409 — the connect DID happen.
                fresh = db.session.get(Gym, gym.id)
                if (
                    fresh is not None
                    and fresh.whatsapp_enabled
                    and fresh.whatsapp_connection_status == "CONNECTED"
                    and fresh.phone_number_id
                    and (
                        (waba_id and phone_number_id
                         and fresh.whatsapp_business_account_id == waba_id
                         and fresh.phone_number_id == phone_number_id)
                        or ((not waba_id and not phone_number_id) and was_connected)
                    )
                    and (not business_id or fresh.whatsapp_meta_business_id in (None, "", business_id))
                ):
                    if not fresh.whatsapp_templates_provisioned:
                        _schedule_provisioning(
                            fresh.id,
                            fresh.whatsapp_business_account_id or "",
                            fresh.phone_number_id or "",
                        )
                    return _connected_response(
                        fresh,
                        provisioning="pending"
                        if not fresh.whatsapp_templates_provisioned else "done",
                    )
                # W-M4 / W-L8: the 409 says WHY — a machine-readable
                # reason plus a human message, no tokens, no raw Meta
                # bodies (the detail lives in the server logs).
                return error_response(
                    "EMBEDDED_SIGNUP_FAILED",
                    result.error or "Embedded Signup flow failed. Please try again.",
                    409,
                    details={"reason": result.failure_reason or "signup_failed"},
                )

        # ── Flow 2: Manual/Direct connection (no code) ──
        token = current_app.config.get("WHATSAPP_ACCESS_TOKEN")
        api_ver = current_app.config.get("WHATSAPP_API_VERSION", "v20.0")

        # Auto-fetch phone numbers if only WABA ID is provided
        if not phone_number_id and waba_id and token:
            try:
                res = requests.get(
                    f"https://graph.facebook.com/{api_ver}/{waba_id}/phone_numbers",
                    params={"fields": "id,display_phone_number,verified_name"},
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10,
                )
                if res.status_code == 200:
                    numbers = res.json().get("data", [])
                    if numbers:
                        phone_number_id = str(numbers[0].get("id"))
                        if not phone and numbers[0].get("display_phone_number"):
                            phone = str(numbers[0].get("display_phone_number"))
            except Exception as exc:
                current_app.logger.warning(f"Could not auto-fetch phone numbers for WABA {waba_id}: {exc}")

        if phone_number_id and not phone and token:
            try:
                res = requests.get(
                    f"https://graph.facebook.com/{api_ver}/{phone_number_id}",
                    params={"fields": "display_phone_number,verified_name"},
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10,
                )
                if res.status_code == 200:
                    num_data = res.json()
                    if num_data.get("display_phone_number"):
                        phone = str(num_data.get("display_phone_number"))
            except Exception as exc:
                current_app.logger.debug(f"Could not fetch display number for {phone_number_id}: {exc}")

        if not phone_number_id:
            return error_response("VALIDATION_ERROR", "phone_number_id is required or could not be found for this WABA.", 400)

        gym.whatsapp_business_account_id = waba_id or gym.whatsapp_business_account_id or f"waba_{gym.id}"
        gym.phone_number_id = phone_number_id
        if phone:
            gym.business_phone_number = phone
        gym.whatsapp_enabled = False
        gym.whatsapp_connection_status = "PENDING"
        gym.whatsapp_connection_error = None
        # W-H4: connect_webhooks can raise (non-JSON Meta body used to
        # escape — W-L2 guards the common case, this catches the rest).
        try:
            verification = WhatsAppService(gym).connect_webhooks()
        except Exception:
            db.session.rollback()
            current_app.logger.exception(
                "WhatsApp webhook verification failed unexpectedly gym=%s", gym.id
            )
            return error_response(
                "INTERNAL_ERROR",
                "An unexpected error occurred while verifying WhatsApp. Please try again.",
                500,
            )
        if not verification.ok:
            error_msg = f"We could not finish connecting WhatsApp: {verification.error}" if verification.error else "We could not verify this WhatsApp connection with Meta. Please try again."
            # W-H6: a late Flow 2 must never overwrite a CONNECTED row
            # with FAILED. Keep the existing connection and say so.
            if was_connected:
                db.session.rollback()
                return error_response(
                    "WHATSAPP_CONNECTION_NOT_VERIFIED",
                    "We could not verify the new number. Your existing WhatsApp connection is unchanged.",
                    409,
                )
            gym.whatsapp_connection_status = "FAILED"
            gym.whatsapp_connection_error = error_msg
            db.session.commit()
            return error_response(
                "WHATSAPP_CONNECTION_NOT_VERIFIED",
                error_msg,
                409,
            )

        gym.whatsapp_enabled = True
        gym.whatsapp_connection_status = "CONNECTED"
        gym.whatsapp_connection_error = None

        try:
            audit(
                action="mobile_connect_waba",
                resource_type="gym",
                resource_id=gym.id,
                gym_id=gym.id,
                actor_id=g.current_user.id,
                metadata={"waba_id": gym.whatsapp_business_account_id, "phone_number_id": phone_number_id, "flow": "manual"},
            )
            db.session.commit()
        except Exception:
            db.session.rollback()
            current_app.logger.exception(
                "Manual connect audit/commit failed gym=%s", gym.id
            )
            return error_response(
                "INTERNAL_ERROR",
                "WhatsApp verified at Meta but the save failed. Please try again.",
                500,
            )

        # Flow 2 never provisioned templates before; same background
        # treatment as Flow 1 so the two flows converge.
        templates_pending = not gym.whatsapp_templates_provisioned
        if templates_pending:
            _schedule_provisioning(
                gym.id,
                gym.whatsapp_business_account_id or "",
                gym.phone_number_id or "",
            )

        return jsonify({
            "success": True,
            "data": {
                "status": "CONNECTED",
                "message": "WhatsApp Business connected successfully.",
                "waba_id": gym.whatsapp_business_account_id,
                "phone_number_id": gym.phone_number_id,
                "business_phone_number": gym.business_phone_number,
                "templates_provisioned": bool(gym.whatsapp_templates_provisioned),
                "provisioning": "pending" if templates_pending else "done",
            },
        })

    @bp.route("/whatsapp/retry-templates", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    @limiter.limit("5 per minute")
    def retry_templates():
        """Retry background template provisioning for a CONNECTED gym.

        W-C1: the retry surface for a provisioning run that failed or
        was cut short (e.g. worker restart). Returns 202 at once — the
        run itself happens in the background thread. The outcome is
        visible in connection-status (``templates_provisioned`` +
        ``warning``).
        """
        gym = g.current_user.gym
        if not gym.whatsapp_enabled or gym.whatsapp_connection_status != "CONNECTED":
            return error_response(
                "WHATSAPP_NOT_CONFIGURED",
                "WhatsApp is not connected for this gym.",
                409,
            )
        if gym.whatsapp_templates_provisioned:
            return jsonify({
                "success": True,
                "data": {
                    "status": "CONNECTED",
                    "templates_provisioned": True,
                    "provisioning": "done",
                    "message": "Message templates are already provisioned.",
                },
            })
        from app.services.template_provisioning_service import (
            schedule_template_provisioning,
        )

        started = schedule_template_provisioning(
            current_app._get_current_object(),
            gym.id,
            gym.whatsapp_business_account_id or "",
            gym.phone_number_id or "",
        )
        if not started:
            return error_response(
                "INTERNAL_ERROR",
                "Could not start template provisioning. Please try again.",
                500,
            )
        resp = jsonify({
            "success": True,
            "data": {
                "status": "PROVISIONING",
                "templates_provisioned": False,
                "provisioning": "pending",
                "message": "Template provisioning restarted in the background. Check connection status in a minute.",
            },
        })
        resp.status_code = 202
        return resp


    @bp.route("/whatsapp/fetch-numbers", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def fetch_waba_numbers():
        """Auto-fetch registered phone numbers for a WABA or the gym's existing WABA."""
        data = request.get_json(silent=True) or {}
        waba_id = str(data.get("waba_id") or "").strip()
        gym = g.current_user.gym
        if not waba_id:
            waba_id = gym.whatsapp_business_account_id or ""

        if waba_id.lower() in ("undefined", "null", "none", "0"):
            waba_id = ""

        token = current_app.config.get("WHATSAPP_ACCESS_TOKEN")
        api_ver = current_app.config.get("WHATSAPP_API_VERSION", "v20.0")

        if not token:
            return error_response("CONFIG_ERROR", "WHATSAPP_ACCESS_TOKEN is not configured on backend.", 500)

        found_numbers = []
        # If waba_id still not known, try to find assigned WABAs for our system user
        if not waba_id:
            try:
                sys_res = requests.get(
                    f"https://graph.facebook.com/{api_ver}/me/assigned_whatsapp_business_accounts",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10,
                )
                if sys_res.status_code == 200:
                    accounts = sys_res.json().get("data", [])
                    if accounts:
                        waba_id = str(accounts[0].get("id"))
            except Exception as exc:
                current_app.logger.warning(f"Could not query assigned WABAs: {exc}")

        if waba_id:
            try:
                res = requests.get(
                    f"https://graph.facebook.com/{api_ver}/{waba_id}/phone_numbers",
                    params={"fields": "id,display_phone_number,verified_name,code_verification_status,quality_rating"},
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10,
                )
                if res.status_code == 200:
                    found_numbers = res.json().get("data", [])
            except Exception as exc:
                current_app.logger.warning(f"Error fetching numbers for WABA {waba_id}: {exc}")

        return jsonify({
            "success": True,
            "data": {
                "waba_id": waba_id,
                "numbers": found_numbers,
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
            
            # V10-M1: audit BEFORE the commit — an audit staged after
            # the final commit is rolled back by teardown and lost in prod.
            audit(
                action="mobile_update_whatsapp_profile",
                resource_type="gym",
                resource_id=gym.id,
                gym_id=gym.id,
                actor_id=g.current_user.id,
            )
            db.session.commit()

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

<div id="cardContent" style="background-color: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 24px; width: 100%; max-width: 420px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.06); box-sizing: border-box;">
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

  <button id="browserBtn" onclick="openExternal()" style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; margin-top: 12px; padding: 12px 0; border: 1px solid #CBD5E1; border-radius: 12px; background-color: #F8FAFC; color: #1E293B; font-size: 14px; font-weight: 600; cursor: pointer;">
    🌐 Having trouble? Open in Browser
  </button>

  <button onclick="cancelSetup()" style="display: block; width: 100%; text-align: center; margin-top: 14px; padding: 8px; border: none; background: transparent; color: #94A3B8; font-size: 13px; cursor: pointer;">Cancel</button>
  <p id="statusText" style="text-align: center; margin-top: 16px; font-size: 13px; color: #64748B;"></p>
</div>

<!-- Meta Facebook SDK -->
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js" onerror="metaSdkFailed()"></script>

<script>
  var META_APP_ID = '{{META_APP_ID}}';
  var META_CONFIG_ID = '{{META_CONFIG_ID}}';
  var FEATURE_TYPE = '{{FEATURE_TYPE}}';
  var AUTH_TOKEN = '{{AUTH_TOKEN}}';
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

  function enableConnectButton() {
    var b = document.getElementById('connectBtn');
    if (b) b.disabled = false;
  }

  // W-C1 / W-H1: every connect-waba save goes through postConnectWaba —
  // 60 s timeout (AbortController), defensive JSON parse, and a typed
  // rejection. Callers must turn the rejection into a VISIBLE status;
  // a .catch that only console.warns is never acceptable again.
  var CONNECT_TIMEOUT_MS = 60000;
  // W-H6: true while a connect-waba save is in flight for this signup, so
  // the code path and the WA_EMBEDDED_SIGNUP path can never fire two saves.
  var _exchangeInFlight = false;
  var _signupPending = false;
  var _postSigninTimer = null;

  // W-H1: the post-signin recovery timer. Armed whenever the page hands a
  // signup off (code posted / save fired); the 8 s pre-login
  // recoveryTimeout is cleared on login, so this is the live recovery
  // path after sign-in. Fires 5 s after the fetch timeout as a backstop
  // in case the fetch promise itself never settles.
  function armPostSigninWatchdog() {
    clearPostSigninWatchdog();
    _signupPending = true;
    _postSigninTimer = setTimeout(function() {
      if (!_signupPending) return;
      _signupPending = false;
      _exchangeInFlight = false;
      enableConnectButton();
      setStatus('Couldn\'t reach the server — tap Connect to try again.', true);
    }, CONNECT_TIMEOUT_MS + 5000);
  }

  function clearPostSigninWatchdog() {
    if (_postSigninTimer) { clearTimeout(_postSigninTimer); _postSigninTimer = null; }
    _signupPending = false;
  }

  function postConnectWaba(payload) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, CONNECT_TIMEOUT_MS);
    return fetch('/api/mobile/v1/whatsapp/connect-waba', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + AUTH_TOKEN
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    }).then(function(res) {
      return res.text().then(function(text) {
        clearTimeout(timer);
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!data) {
          var bad = new Error('non-JSON response');
          bad.kind = 'non-json';
          bad.status = res.status;
          throw bad;
        }
        data._httpStatus = res.status;
        return data;
      });
    }).catch(function(err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        var t = new Error('request timed out');
        t.kind = 'timeout';
        throw t;
      }
      if (err && err.kind) throw err;
      var n = new Error('network error');
      n.kind = 'network';
      throw n;
    });
  }

  // Error contract (PROVISIONAL — no backend-crew contract existed when
  // this page was fixed; keys taken from the review: TOKEN_EXPIRED /
  // UNAUTHORIZED / SUBSCRIPTION_REQUIRED / EMBEDDED_SIGNUP_FAILED /
  // INTERNAL_ERROR). The server's own message is shown when it sent one.
  // Every branch ends with a retry prompt.
  function signupErrorText(result, err) {
    if (err) {
      if (err.kind === 'timeout') return 'The connection timed out — tap Connect to try again.';
      return 'Couldn\'t reach the server — tap Connect to try again.';
    }
    var error = (result && result.error) || {};
    var code = error.code || '';
    var status = (result && result._httpStatus) || 0;
    var msg = error.message || '';
    if (code === 'TOKEN_EXPIRED' || code === 'UNAUTHORIZED' || status === 401) {
      return 'This setup link expired — restart setup from the app.';
    }
    if (code === 'SUBSCRIPTION_REQUIRED' || status === 403) {
      return 'Your trial has ended — renew your subscription, then restart setup from the app.';
    }
    if (msg) return msg + ' Tap Connect to try again.';
    if (code === 'EMBEDDED_SIGNUP_FAILED') return 'Meta rejected the connection — tap Connect to try again.';
    if (code === 'INTERNAL_ERROR') return 'Something went wrong on our side — tap Connect to try again.';
    return 'Couldn\'t connect WhatsApp — tap Connect to try again.';
  }

  // Shared failure landing for both save paths: clear the watchdog, free
  // the exchange guard for a retry, re-enable Connect, show the real error.
  function failSignup(result, err) {
    clearPostSigninWatchdog();
    _exchangeInFlight = false;
    enableConnectButton();
    setStatus(signupErrorText(result, err), true);
  }

  function openExternal() {
    var extrasObj = { sessionInfoVersion: '3', version: 'v4' };
    // Never compare FEATURE_TYPE to the placeholder literal — serve-time
    // replacement rewrites the literal too, so that comparison is always
    // false and a passed feature type is silently dropped. An unreplaced
    // placeholder still starts with '{{'.
    if (FEATURE_TYPE && FEATURE_TYPE !== 'none' && FEATURE_TYPE.indexOf('{{') !== 0) {
      extrasObj.featureType = FEATURE_TYPE;
    }
    var directMetaUrl = 'https://business.facebook.com/messaging/whatsapp/onboard/?app_id=' +
      encodeURIComponent(META_APP_ID) +
      '&config_id=' + encodeURIComponent(META_CONFIG_ID) +
      '&extras=' + encodeURIComponent(JSON.stringify(extrasObj));

    postToApp({
      type: 'open_external_browser',
      direct_meta_url: directMetaUrl
    });

    if (!window.ReactNativeWebView) {
      // W-H3 (option a): open Meta in a NEW tab so this page survives —
      // the owner finishes on Meta's tab, returns here and taps Connect
      // again. Navigating this page itself away was a dead end: no return
      // URL exists, so nothing could ever complete the connect.
      var tab = window.open(directMetaUrl, '_blank');
      if (tab) {
        setStatus('Meta opened in a new tab — finish signup there, then return to this tab and tap Connect again.', false);
      } else {
        setStatus('Your browser blocked the new tab — allow popups for this site, then tap "Having trouble? Open in Browser" again.', true);
      }
    }
  }

  function metaSdkFailed() {
    setStatus('Meta sign-in could not load. Check your internet connection, then close and try again.', true);
  }

  // Track business_id from Meta's WA_EMBEDDED_SIGNUP postMessage
  var _capturedBusinessId = '';

  function handleSignupSuccess(wabaId, phoneId, phoneNum, businessId) {
    setStatus('WhatsApp Business connected! Saving...', false);
    postToApp({
      type: 'embedded_signup_complete',
      waba_id: wabaId,
      phone_number_id: phoneId,
      business_phone_number: phoneNum,
      business_id: businessId || _capturedBusinessId || ''
    });

    // W-H6: single owner of the save. Inside the app WebView the app owns
    // the exchange (it just received this complete message); the page must
    // not fire its own fetch. And if the FB.login code path already fired
    // a save for this signup, never fire a second one.
    if (window.ReactNativeWebView || _exchangeInFlight) return;

    // NOTE: never compare AUTH_TOKEN to the placeholder literal — serve-time
    // replacement rewrites the literal too, so the old guard was ALWAYS
    // false and neither save fetch ever fired in the served page (the
    // incident freeze: "Retrieving..." with no request at all). An
    // unreplaced placeholder still starts with '{{'.
    if (AUTH_TOKEN && AUTH_TOKEN.indexOf('{{') !== 0) {
      _exchangeInFlight = true;
      armPostSigninWatchdog();
      postConnectWaba({
        waba_id: wabaId,
        phone_number_id: phoneId,
        business_phone_number: phoneNum,
        business_id: businessId || _capturedBusinessId || ''
      }).then(function(result) {
        if (result && result.success) {
          clearPostSigninWatchdog();
          _exchangeInFlight = false;
          setStatus('WhatsApp Connected Successfully!', false);
          var card = document.getElementById('cardContent');
          if (card) {
            card.innerHTML = '<div style="text-align:center; padding: 24px 0;"><h2 style="color:#25D366; font-size:20px; font-weight:800; margin-bottom:8px;">WhatsApp Connected!</h2><p style="color:#475569; font-size:14px; line-height:1.5;">Your business number is now linked to Renewal Desk. Automated renewal reminders and AI receptionist are ready.</p></div>';
          }
        } else {
          failSignup(result, null);
        }
      }).catch(function(err) {
        failSignup(null, err);
      });
    }
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
      // W-L3: a swallowed FB.init throw used to leave the page blank/idle
      // with no guidance at all.
      setStatus('Meta sign-in could not load. Check your internet connection, then close and try again.', true);
    }
  };

  function startSignup() {
    var button = document.getElementById('connectBtn');
    if (button) button.disabled = true;
    setStatus('Opening Meta Business login...', false);

    // Auto re-enable button fallback if popup was closed without event
    var recoveryTimeout = setTimeout(function() {
      if (button && button.disabled) {
        button.disabled = false;
        // W-L5: do not promise a manual-entry path — the PWA has no manual
        // WABA/phone-ID entry form (only the Android modal does).
        setStatus('Ready. Tap Connect WhatsApp to try again.', false);
      }
    }, 8000);

    function launchFb() {
      try {
        var loginExtras = {
          setup: {},
          sessionInfoVersion: '3',
          version: 'v4'
        };
        if (FEATURE_TYPE && FEATURE_TYPE !== 'none' && FEATURE_TYPE.indexOf('{{') !== 0) {
          loginExtras.featureType = FEATURE_TYPE;
        }

        FB.login(function(response) {
          clearTimeout(recoveryTimeout);
          if (response && response.authResponse) {
            var code = response.authResponse.code;
            if (code) {
              // W-M3: only claim "Retrieving..." once a code actually
              // exists — a missing code used to freeze on that text with
              // no fetch ever attempted.
              setStatus('Signed in. Retrieving WhatsApp Business details...', false);
              postToApp({
                type: 'embedded_signup_code',
                code: code,
                business_id: _capturedBusinessId || ''
              });
              // W-H1: arm the post-signin watchdog even in the WebView —
              // if the app never closes this page, the owner still gets a
              // visible error + retry instead of a frozen screen.
              armPostSigninWatchdog();
              // W-H6: single owner of the code exchange. Inside the app
              // WebView the app owns it (it just received the code above)
              // — the page must not fire its own fetch with the same
              // one-time code. In a plain browser tab the page fetch is
              // the only save path, so it owns the exchange there.
              if (!window.ReactNativeWebView && !_exchangeInFlight) {
                // Same replacement-proof guard as handleSignupSuccess (see
                // note there): the old placeholder comparison was always
                // false in the served page, so this fetch never ran.
                if (AUTH_TOKEN && AUTH_TOKEN.indexOf('{{') !== 0) {
                  _exchangeInFlight = true;
                  postConnectWaba({ code: code, business_id: _capturedBusinessId || '' }).then(function(result) {
                    if (result && result.success) {
                      clearPostSigninWatchdog();
                      _exchangeInFlight = false;
                      setStatus('WhatsApp Connected Successfully!', false);
                      postToApp({
                        type: 'embedded_signup_complete',
                        phone_number_id: result.data && result.data.phone_number_id,
                        waba_id: result.data && result.data.waba_id,
                        business_phone_number: result.data && result.data.business_phone_number,
                        business_id: result.data && result.data.business_id
                      });
                      var card = document.getElementById('cardContent');
                      if (card) {
                        card.innerHTML = '<div style="text-align:center; padding: 24px 0;"><h2 style="color:#25D366; font-size:20px; font-weight:800; margin-bottom:8px;">WhatsApp Connected!</h2><p style="color:#475569; font-size:14px; line-height:1.5;">Your business number is now linked to Renewal Desk.</p></div>';
                      }
                    } else {
                      // W-H2 / W-L8: show the REAL error, never a bare
                      // "Verifying..." as a terminal state.
                      failSignup(result, null);
                    }
                  }).catch(function(err) {
                    failSignup(null, err);
                  });
                }
              }
            } else {
              enableConnectButton();
              setStatus('Meta didn\'t return a sign-in code — tap Connect to try again.', true);
            }
          } else {
            if (button) button.disabled = false;
            setStatus('Setup was closed. You can tap Connect WhatsApp to try again.', false);
          }
        }, {
          config_id: META_CONFIG_ID,
          response_type: 'code',
          override_default_response_type: true,
          extras: loginExtras
        });
      } catch (err) {
        clearTimeout(recoveryTimeout);
        if (button) button.disabled = false;
        setStatus('Meta sign-in could not open. Tap "Having trouble? Open in Browser" below.', true);
      }
    }

    if (typeof FB !== 'undefined' && FB.login) {
      launchFb();
    } else {
      setStatus('Loading Meta SDK, please wait...', false);
      var checks = 0;
      var interval = setInterval(function() {
        checks++;
        if (typeof FB !== 'undefined' && FB.login) {
          clearInterval(interval);
          launchFb();
        } else if (checks >= 25) { // 5-second polling timeout
          clearInterval(interval);
          clearTimeout(recoveryTimeout);
          if (button) button.disabled = false;
          setStatus('Meta SDK took too long to load. Tap "Having trouble? Open in Browser" below.', true);
        }
      }, 200);
    }
  }

  // Meta Embedded Signup message listener
  window.addEventListener('message', function(event) {
    if (!event.origin || (!event.origin.includes('facebook.com') && event.origin !== window.location.origin)) {
      return;
    }

    try {
      var data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (!data) return;

      if (data.type === 'WA_EMBEDDED_SIGNUP') {
        if (data.event === 'CANCEL') {
          var btn = document.getElementById('connectBtn');
          if (btn) btn.disabled = false;
          setStatus('Setup was cancelled. You can tap Connect WhatsApp to try again.', false);
          return;
        }

        var setupData = data.data || {};
        var phoneId = setupData.phone_number_id || setupData.phoneNumberId || '';
        var wabaId = setupData.waba_id || setupData.wabaId || '';
        var phoneNum = setupData.display_phone_number || setupData.business_phone_number || '';
        var businessId = setupData.business_id || setupData.businessId || '';

        // Capture business_id for use in FB.login callback
        if (businessId) _capturedBusinessId = businessId;

        if (phoneId || wabaId) {
          handleSignupSuccess(wabaId, phoneId, phoneNum, businessId);
          return;
        }

        if (!phoneId && !wabaId) {
          // W-M8: Meta sent only a business_id — keep the capture, but do
          // not leave the owner with no feedback. START/PROGRESS events
          // are mid-flow, so only a non-progress event with no IDs is a
          // dead end; a save already in flight owns the status instead.
          var signupEvent = data.event || '';
          if (signupEvent !== 'START' && signupEvent !== 'PROGRESS' && !_exchangeInFlight) {
            enableConnectButton();
            setStatus('Signup is incomplete — Meta didn\'t return a WhatsApp number. Tap Connect to try again.', true);
          }
          return;
        }
      }

      if (data && (data.waba_id || data.phone_number_id || data.phoneNumberId)) {
        handleSignupSuccess(
          data.waba_id || data.wabaId || '',
          data.phone_number_id || data.phoneNumberId || '',
          data.display_phone_number || data.business_phone_number || '',
          data.business_id || data.businessId || ''
        );
      }
    } catch (e) {}
  });

  function cancelSetup() {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      postToApp({ type: 'embedded_signup_cancel' });
      return;
    }
    // W-M9: in a plain browser tab (PWA window.open) there is no app to
    // receive the cancel message — and the PWA has no deep-link URL for
    // WhatsApp Setup (in-memory router), so close this tab back to the
    // app. If the browser refuses to close it, fall back to the app home.
    setStatus('Setup cancelled. Returning to the app…', false);
    window.close();
    setTimeout(function() {
      window.location.href = window.location.origin + '/';
    }, 500);
  }
</script>
</body>
</html>"""
