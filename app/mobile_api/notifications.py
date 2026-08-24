"""Mobile API notification inbox and push token registration endpoints."""
from __future__ import annotations

from flask import g, jsonify, request
from sqlalchemy import or_

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import AppNotification, UserPushToken


def _serialize_notification(n: AppNotification) -> dict:
    return {
        "id": n.id,
        "title": n.title,
        "body": n.body,
        "category": n.category,
        "data": n.data or {},
        "is_read": n.is_read,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


def register_notifications_routes(bp):
    @bp.route("/notifications/register-token", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def register_push_token():
        data = request.get_json(silent=True) or {}
        push_token = (data.get("push_token") or "").strip()
        if not push_token or not push_token.startswith("ExponentPushToken"):
            return error_response("VALIDATION_ERROR", "Valid ExponentPushToken is required.", 400)

        device_name = (data.get("device_name") or "Android Device").strip()[:128]
        platform = (data.get("platform") or "android").strip()[:32]

        existing = UserPushToken.query.filter_by(
            gym_id=g.gym_id, user_id=g.user_id, push_token=push_token
        ).first()

        if existing:
            existing.is_active = True
            existing.device_name = device_name
            existing.platform = platform
        else:
            new_token = UserPushToken(
                gym_id=g.gym_id,
                user_id=g.user_id,
                push_token=push_token,
                device_name=device_name,
                platform=platform,
                is_active=True,
            )
            db.session.add(new_token)

        try:
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            return error_response("DB_ERROR", str(exc), 500)

        return jsonify({"success": True, "data": {"message": "Push token registered successfully."}})

    @bp.route("/notifications/unregister-token", methods=["DELETE", "POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def unregister_push_token():
        data = request.get_json(silent=True) or {}
        push_token = (data.get("push_token") or "").strip()
        if not push_token:
            return error_response("VALIDATION_ERROR", "push_token is required.", 400)

        token_record = UserPushToken.query.filter_by(
            gym_id=g.gym_id, user_id=g.user_id, push_token=push_token
        ).first()

        if token_record:
            token_record.is_active = False
            try:
                db.session.commit()
            except Exception as exc:
                db.session.rollback()
                return error_response("DB_ERROR", str(exc), 500)

        return jsonify({"success": True, "data": {"message": "Push token unregistered."}})

    @bp.route("/notifications", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def list_notifications():
        page = request.args.get("page", 1, type=int)
        page_size = min(request.args.get("page_size", 20, type=int), 100)
        category = request.args.get("category", "").strip()

        query = AppNotification.query.filter_by(gym_id=g.gym_id).filter(
            or_(AppNotification.user_id == g.user_id, AppNotification.user_id.is_(None))
        )
        if category and category != "all":
            query = query.filter_by(category=category)

        total = query.count()
        unread_count = (
            AppNotification.query.filter_by(gym_id=g.gym_id, is_read=False)
            .filter(or_(AppNotification.user_id == g.user_id, AppNotification.user_id.is_(None)))
            .count()
        )

        notifications = (
            query.order_by(AppNotification.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )

        return jsonify({
            "success": True,
            "data": {
                "notifications": [_serialize_notification(n) for n in notifications],
                "unread_count": unread_count,
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total,
                    "total_pages": (total + page_size - 1) // page_size,
                },
            },
        })

    @bp.route("/notifications/unread-count", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def get_unread_count():
        count = (
            AppNotification.query.filter_by(gym_id=g.gym_id, is_read=False)
            .filter(or_(AppNotification.user_id == g.user_id, AppNotification.user_id.is_(None)))
            .count()
        )
        return jsonify({"success": True, "data": {"unread_count": count}})

    @bp.route("/notifications/<int:notification_id>/read", methods=["POST", "PATCH"])
    @token_required
    @roles_required("gym_owner", "staff")
    def mark_notification_read(notification_id: int):
        notif = AppNotification.query.filter_by(id=notification_id, gym_id=g.gym_id).first()
        if not notif:
            return error_response("NOT_FOUND", "Notification not found.", 404)

        notif.is_read = True
        try:
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            return error_response("DB_ERROR", str(exc), 500)

        return jsonify({"success": True, "data": {"message": "Notification marked as read."}})

    @bp.route("/notifications/read-all", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def mark_all_read():
        try:
            AppNotification.query.filter_by(gym_id=g.gym_id, is_read=False).filter(
                or_(AppNotification.user_id == g.user_id, AppNotification.user_id.is_(None))
            ).update({"is_read": True}, synchronize_session=False)
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            return error_response("DB_ERROR", str(exc), 500)

        return jsonify({"success": True, "data": {"message": "All notifications marked as read."}})
