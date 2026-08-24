"""Mobile API staff endpoint."""
from __future__ import annotations

from flask import g, jsonify

from app.mobile_api.middleware import roles_required, token_required
from app.models import User


def register_staff_routes(bp):
    @bp.route("/staff", methods=["GET"])
    @token_required
    @roles_required("gym_owner")
    def list_staff():
        staff = (
            User.query.filter_by(gym_id=g.gym_id)
            .filter(User.role.in_(["gym_owner", "staff"]))
            .order_by(User.full_name.asc())
            .all()
        )
        return jsonify({
            "success": True,
            "data": {
                "staff": [
                    {
                        "id": u.id,
                        "full_name": u.full_name,
                        "email": u.email,
                        "role": u.role,
                        "is_active": u.is_active,
                        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
                        "created_at": u.created_at.isoformat() if u.created_at else None,
                    }
                    for u in staff
                ],
            },
        })
