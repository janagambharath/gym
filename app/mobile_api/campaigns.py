"""Mobile API campaign endpoints."""
from __future__ import annotations

from flask import g, jsonify, request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.extensions import db, limiter
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import MobileIdempotencyKey
from app.models.campaign import Campaign, CampaignRecipient, SEGMENT_TYPES
from app.services.campaign_service import (
    check_cooldown_recipients,
    create_campaign,
    get_approved_templates,
    get_campaign_results,
    preview_segment,
    send_campaign,
    validate_imported_contacts,
)
from app.services.idempotency_service import (
    begin_idempotency,
    find_replay,
    legacy_replay,
    record_idempotency,
    replay_after_conflict,
    request_fingerprint,
    valid_key,
)


def _serialize_campaign(c: Campaign) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "campaign_type": getattr(c, "campaign_type", "recovery") or "recovery",
        "promo_preset": getattr(c, "promo_preset", None),
        "segment_type": c.segment_type,
        "status": c.status,
        "total_recipients": c.total_recipients,
        "total_sent": c.total_sent,
        "total_delivered": c.total_delivered,
        "total_read": c.total_read,
        "total_replied": c.total_replied,
        "total_renewed": c.total_renewed,
        "total_revenue_recovered": str(c.total_revenue_recovered),
        "total_recorded_revenue": str(c.total_recorded_revenue or 0),
        "sent_at": c.sent_at.isoformat() if c.sent_at else None,
        "completed_at": c.completed_at.isoformat() if c.completed_at else None,
        "created_by": c.created_by.full_name if c.created_by else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "error_message": c.error_message,
    }


def _serialize_recipient(r: CampaignRecipient) -> dict:
    return {
        "id": r.id,
        "member_id": r.member_id,
        "member_name": r.member.full_name if r.member else None,
        "member_phone": r.member.phone if r.member else r.phone_snapshot,
        "member_status": r.member.status if r.member else None,
        "plan_name": r.member.plan.name if r.member and r.member.plan else None,
        "plan_price": str(r.member.plan.price) if r.member and r.member.plan else None,
        "membership_end": r.member.membership_end.isoformat() if r.member and r.member.membership_end else None,
        "status": r.status,
        "sent_at": r.sent_at.isoformat() if r.sent_at else None,
        "delivered_at": r.delivered_at.isoformat() if r.delivered_at else None,
        "read_at": r.read_at.isoformat() if r.read_at else None,
        "reply_at": r.reply_at.isoformat() if r.reply_at else None,
        "payment_claimed_at": r.payment_claimed_at.isoformat() if r.payment_claimed_at else None,
        "renewed_at": r.renewed_at.isoformat() if r.renewed_at else None,
        "renewal_amount": str(r.renewal_amount) if r.renewal_amount else None,
        "error_message": r.error_message,
    }


SEGMENT_LABELS = {
    "expiring_today": "Expiring Today",
    "expiring_3d": "Expiring in 3 Days",
    "expiring_7d": "Expiring in 7 Days",
    "expiring_14d": "Expiring in 14 Days",
    "expiring_30d": "Expiring in 30 Days",
    "recently_expired": "Recently Expired",
    "inactive_30d": "Inactive 30+ Days",
    "inactive_60d": "Inactive 60+ Days",
    "inactive_90d": "Inactive 90+ Days",
    "all_active": "All Active Members",
    "all_expired": "All Expired Members",
    "all_customers": "All Customers / Members",
    "custom_import": "Custom Upload / Spreadsheet",
}


def register_campaign_routes(bp):
    @bp.route("/campaigns", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def list_campaigns():
        page = request.args.get("page", 1, type=int)
        page_size = min(request.args.get("page_size", 20, type=int), 100)
        status_filter = request.args.get("status", "").strip()
        campaign_type = request.args.get("campaign_type", "").strip()

        query = Campaign.query.filter_by(gym_id=g.gym_id)
        if status_filter:
            query = query.filter_by(status=status_filter)
        if campaign_type:
            query = query.filter_by(campaign_type=campaign_type)

        total = query.count()
        campaigns = (
            query.options(joinedload(Campaign.created_by))
            .order_by(Campaign.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )

        return jsonify({
            "success": True,
            "data": {
                "campaigns": [_serialize_campaign(c) for c in campaigns],
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total,
                    "total_pages": (total + page_size - 1) // page_size,
                },
            },
        })

    @bp.route("/campaigns/<int:campaign_id>", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def get_campaign(campaign_id: int):
        results = get_campaign_results(campaign_id, g.gym_id)
        if results is None:
            return error_response("NOT_FOUND", "Campaign not found.", 404)
        return jsonify({"success": True, "data": results})

    @bp.route("/campaigns", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @limiter.limit("10 per minute")
    def create_campaign_endpoint():
        data = request.get_json(silent=True) or {}

        # V6-M16: campaign create -> send has no idempotency — a retry
        # after a send failure created a SECOND campaign over the same
        # segment and double-messaged members. A stable Idempotency-Key
        # replays the first campaign instead of creating a duplicate
        # (same mechanism as create_payment / direct_renewal).
        idempotency_key = valid_key(request.headers.get("Idempotency-Key"))
        if idempotency_key == "":
            return error_response("VALIDATION_ERROR", "Idempotency-Key is too long.", 400)
        request_hash = request_fingerprint(data)
        if idempotency_key:
            existing, matches_request = find_replay(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="create_campaign",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if existing:
                # V8-L5: replay through the decrypting helper, not the
                # raw stored body — a credential stored as enc1:
                # ciphertext must decrypt on replay (or the row is
                # dropped and the request executes fresh), never be
                # returned as ciphertext.
                replay = legacy_replay(existing, matches_request)
                if replay is not None:
                    return replay

        name = (data.get("name") or "").strip()
        campaign_type = (data.get("campaign_type") or "recovery").strip()
        promo_preset = (data.get("promo_preset") or "").strip() or None
        imported_contacts = data.get("imported_contacts")
        exclude_recent = bool(data.get("exclude_recent"))
        segment_type = (data.get("segment_type") or ("custom_import" if imported_contacts else "all_expired")).strip()

        if not name:
            return error_response("VALIDATION_ERROR", "Campaign name is required.", 400)
        if segment_type not in SEGMENT_TYPES:
            return error_response(
                "VALIDATION_ERROR",
                f"Invalid segment type. Must be one of: {', '.join(SEGMENT_TYPES)}",
                400,
            )

        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        # V12-B3: unguarded int() cast 500d on non-numeric input —
        # guard it like the renewals.py sibling.
        try:
            attribution_window_days = int(data.get("attribution_window_days", 7))
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "Invalid attribution_window_days.", 400)
        campaign = create_campaign(
            gym_id=g.gym_id,
            name=name,
            segment_type=segment_type,
            created_by_id=g.current_user.id,
            campaign_type=campaign_type,
            promo_preset=promo_preset,
            message_template=data.get("message_template"),
            whatsapp_template_name=data.get("whatsapp_template_name"),
            attribution_window_days=attribution_window_days,
            imported_contacts=imported_contacts,
            exclude_recent=exclude_recent,
            gym_timezone=gym_timezone,
        )
        response_body = {"success": True, "data": _serialize_campaign(campaign)}
        if idempotency_key:
            db.session.add(
                MobileIdempotencyKey(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="create_campaign",
                    key=idempotency_key,
                    request_hash=request_hash,
                    status_code=201,
                    response_body=response_body,
                )
            )
        try:
            db.session.commit()
        except IntegrityError:
            # A concurrent create with the same key won the race —
            # replay its stored campaign instead of a duplicate.
            db.session.rollback()
            if idempotency_key:
                existing, matches_request = find_replay(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="create_campaign",
                    key=idempotency_key,
                    request_hash=request_hash,
                )
                if existing:
                    # V8-L5: replay through the decrypting helper, not the
                    # raw stored body — a credential stored as enc1:
                    # ciphertext must decrypt on replay (or the row is
                    # dropped and the request executes fresh), never be
                    # returned as ciphertext.
                    replay = legacy_replay(existing, matches_request)
                    if replay is not None:
                        return replay
            raise

        return jsonify(response_body), 201

    @bp.route("/campaigns/<int:campaign_id>/send", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @limiter.limit("10 per minute")
    def send_campaign_endpoint(campaign_id: int):
        # A retry after a successful send must replay the stored
        # summary, not 400 "Campaign is already sent" — the client
        # cannot tell a lost success from a failure. NOTE: send_campaign
        # commits internally and sends WhatsApp messages synchronously,
        # so the key record below is a second commit: it protects the
        # sequential retry (timeout / lost response), while a
        # concurrent same-key double-send is still guarded only by the
        # campaign status machine, not by this key.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="send_campaign",
            headers=request.headers,
            payload={"campaign_id": campaign_id},
        )
        if replay is not None:
            return replay

        result = send_campaign(campaign_id, g.gym_id)
        if not result.get("success"):
            return error_response(
                "CAMPAIGN_ERROR",
                result.get("error", "Failed to send campaign."),
                400,
            )
        response_body = {"success": True, "data": result}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="send_campaign",
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
                scope="send_campaign",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)

    @bp.route("/campaigns/<int:campaign_id>/recipients", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def list_campaign_recipients(campaign_id: int):
        campaign = Campaign.query.filter_by(id=campaign_id, gym_id=g.gym_id).first()
        if not campaign:
            return error_response("NOT_FOUND", "Campaign not found.", 404)

        page = request.args.get("page", 1, type=int)
        page_size = min(request.args.get("page_size", 20, type=int), 100)
        status_filter = request.args.get("status", "").strip()

        query = CampaignRecipient.query.filter_by(campaign_id=campaign_id)
        if status_filter:
            query = query.filter_by(status=status_filter)

        total = query.count()
        recipients = (
            query.options(
                joinedload(CampaignRecipient.member),
            )
            .order_by(CampaignRecipient.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )

        return jsonify({
            "success": True,
            "data": {
                "recipients": [_serialize_recipient(r) for r in recipients],
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total,
                    "total_pages": (total + page_size - 1) // page_size,
                },
            },
        })

    @bp.route("/campaigns/segments", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def list_segments():
        """Return available campaign segment types with labels."""
        return jsonify({
            "success": True,
            "data": {
                "segments": [
                    {"type": seg_type, "label": SEGMENT_LABELS.get(seg_type, seg_type)}
                    for seg_type in SEGMENT_TYPES
                ],
            },
        })

    @bp.route("/campaigns/segments/preview", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def preview_segment_endpoint():
        segment_type = request.args.get("type", "").strip()
        if segment_type not in SEGMENT_TYPES:
            return error_response(
                "VALIDATION_ERROR",
                f"Invalid segment type. Must be one of: {', '.join(SEGMENT_TYPES)}",
                400,
            )

        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        preview = preview_segment(g.gym_id, segment_type, gym_timezone)

        return jsonify({"success": True, "data": preview})

    @bp.route("/campaigns/latest", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def latest_campaign():
        """Return the most recent campaign for the dashboard widget."""
        campaign = (
            Campaign.query.filter_by(gym_id=g.gym_id)
            .filter(Campaign.status.in_(("sent", "completed")))
            .options(joinedload(Campaign.created_by))
            .order_by(Campaign.sent_at.desc())
            .first()
        )
        if not campaign:
            return jsonify({"success": True, "data": None})
        return jsonify({"success": True, "data": _serialize_campaign(campaign)})

    @bp.route("/campaigns/import/validate", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @limiter.limit("10 per minute")
    def validate_import():
        data = request.get_json(silent=True) or {}
        contacts = data.get("contacts") or []
        campaign_type = (data.get("campaign_type") or "recovery").strip()
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        result = validate_imported_contacts(g.gym_id, contacts, campaign_type, gym_timezone)
        return jsonify({"success": True, "data": result})

    @bp.route("/campaigns/templates", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def list_templates():
        campaign_type = request.args.get("campaign_type") or request.args.get("type") or request.args.get("purpose")
        templates = get_approved_templates(campaign_type)
        return jsonify({"success": True, "data": {"templates": templates}})

    @bp.route("/campaigns/cooldown-check", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @limiter.limit("10 per minute")
    def cooldown_check():
        data = request.get_json(silent=True) or {}
        segment_type = data.get("segment_type")
        member_ids = data.get("member_ids")
        phone_numbers = data.get("phone_numbers") or data.get("phones")
        # V12-B3: unguarded int() cast 500d on non-numeric input —
        # guard it like the renewals.py sibling.
        try:
            cooldown_days = int(data.get("cooldown_days") or 7)
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "Invalid cooldown_days.", 400)
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        res = check_cooldown_recipients(
            g.gym_id,
            segment_type=segment_type,
            member_ids=member_ids,
            phone_numbers=phone_numbers,
            cooldown_days=cooldown_days,
            gym_timezone=gym_timezone,
        )
        return jsonify({"success": True, "data": res})
