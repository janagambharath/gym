from __future__ import annotations

import logging
import os
from pathlib import Path

from datetime import datetime

import sentry_sdk
from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
from flask_login import current_user, login_required
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sentry_sdk.integrations.flask import FlaskIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sqlalchemy import text
from werkzeug.middleware.proxy_fix import ProxyFix

from app.config import config_by_name
from app.extensions import csrf, db, limiter, login_manager, migrate, scheduler


def create_app(config_name: str | None = None) -> Flask:
    sentry_dsn = os.getenv("SENTRY_DSN")
    if sentry_dsn:
        try:
            sentry_sdk.init(
                dsn=sentry_dsn,
                integrations=[FlaskIntegration(), SqlalchemyIntegration()],
                traces_sample_rate=0.05,
                send_default_pii=False,
            )
        except Exception as exc:
            logging.getLogger(__name__).warning(
                "Sentry initialisation failed (non-fatal): %s", exc
            )

    app = Flask(__name__, instance_relative_config=True)
    selected_config = config_name or os.getenv("FLASK_ENV", "default")
    app.config.from_object(config_by_name[selected_config])
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    _normalize_database_url(app)
    _configure_engine_options(app, selected_config)
    _validate_config(app, selected_config)
    _ensure_runtime_dirs(app)
    _configure_logging(app)
    _init_extensions(app)
    _register_blueprints(app)
    _register_error_handlers(app)
    _register_security_headers(app)
    _register_health_check(app)
    _register_upload_route(app)
    _register_template_helpers(app)
    _register_cli(app)
    _start_scheduler(app)

    @app.route("/")
    def index():
        if current_user.is_authenticated:
            if current_user.role == "super_admin":
                return redirect(url_for("admin.dashboard"))
            return redirect(url_for("gym.dashboard"))
        return redirect(url_for("auth.login"))

    return app


def _normalize_database_url(app: Flask) -> None:
    database_url = app.config.get("SQLALCHEMY_DATABASE_URI")
    if database_url and database_url.startswith("postgres://"):
        app.config["SQLALCHEMY_DATABASE_URI"] = database_url.replace(
            "postgres://", "postgresql://", 1
        )


def _configure_engine_options(app: Flask, selected_config: str) -> None:
    database_url = app.config.get("SQLALCHEMY_DATABASE_URI", "")
    if database_url.startswith("sqlite"):
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {}
        return

    is_production = selected_config == "production"
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_size": 10 if is_production else 5,
        "max_overflow": 20 if is_production else 10,
        "pool_timeout": 30,
        "pool_recycle": 300,
        "pool_pre_ping": True,
    }


def _validate_config(app: Flask, selected_config: str) -> None:
    if selected_config in {"development", "default"} and not app.debug:
        app.logger.warning(
            "Running with DevelopmentConfig but app.debug is False. "
            "Set FLASK_ENV=production for production deployments."
        )

    if selected_config != "production":
        return
    database_url = app.config.get("SQLALCHEMY_DATABASE_URI", "")
    if not database_url or database_url.startswith("sqlite"):
        raise RuntimeError("DATABASE_URL must be set to PostgreSQL in production.")
    secret_key = app.config.get("SECRET_KEY", "")
    if not secret_key or secret_key == "dev-only-change-me" or len(secret_key) < 32:
        raise RuntimeError(
            "SECRET_KEY is not set or too weak. Generate one with: "
            "python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    redis_url = app.config.get("REDIS_URL", "memory://")
    if redis_url == "memory://":
        raise RuntimeError(
            "REDIS_URL must be set to a real Redis instance in production. "
            "In-memory rate limiting does not work across multiple workers."
        )


def _ensure_runtime_dirs(app: Flask) -> None:
    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)
    Path(app.instance_path).mkdir(parents=True, exist_ok=True)


def _configure_logging(app: Flask) -> None:
    if not app.debug and not app.testing:
        import json

        class JsonFormatter(logging.Formatter):
            def format(self, record: logging.LogRecord) -> str:
                payload = {
                    "time": self.formatTime(record),
                    "level": record.levelname,
                    "logger": record.name,
                    "message": record.getMessage(),
                }
                if record.exc_info:
                    payload["exception"] = self.formatException(record.exc_info)
                return json.dumps(payload)

        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        root_logger = logging.getLogger()
        root_logger.setLevel(app.config["LOG_LEVEL"])
        root_logger.handlers = [handler]
        return

    logging.basicConfig(
        level=app.config["LOG_LEVEL"],
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


def _init_extensions(app: Flask) -> None:
    db.init_app(app)
    migrate.init_app(app, db)
    csrf.init_app(app)
    limiter.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = "auth.login"
    login_manager.login_message_category = "warning"


def _register_blueprints(app: Flask) -> None:
    from app.admin.routes import admin_bp
    from app.auth.routes import auth_bp
    from app.gym.routes import gym_bp
    from app.gym.staff_routes import staff_bp
    from app.members.routes import members_bp
    from app.payments.routes import payments_bp
    from app.reminders.routes import reminders_bp
    from app.webhooks.whatsapp import webhooks_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(gym_bp)
    app.register_blueprint(staff_bp)
    app.register_blueprint(members_bp)
    app.register_blueprint(payments_bp)
    app.register_blueprint(reminders_bp)
    app.register_blueprint(webhooks_bp)
    app.register_blueprint(admin_bp)


def _register_error_handlers(app: Flask) -> None:
    @app.errorhandler(403)
    def forbidden(error):
        return render_template("errors/403.html"), 403

    @app.errorhandler(404)
    def not_found(error):
        return render_template("errors/404.html"), 404

    @app.errorhandler(429)
    def too_many_requests(error):
        return render_template("errors/429.html"), 429

    @app.errorhandler(500)
    def server_error(error):
        app.logger.exception("Unhandled server error: %s", error)
        return render_template("errors/500.html"), 500


def _register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_security_headers(response):
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' https://cdn.jsdelivr.net; "
            "style-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
            "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com data:; "
            "img-src 'self' data: https: blob:; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self';"
        )
        if not app.debug:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response


def _register_health_check(app: Flask) -> None:
    @app.route("/health")
    @limiter.exempt
    def health():
        try:
            db.session.execute(text("SELECT 1"))
            db.session.execute(
                text(
                    "SELECT trial_ends_at, max_members, whatsapp_business_account_id, "
                    "phone_number_id, "
                    "whatsapp_enabled, welcome_message_template, "
                    "renewal_reminder_template FROM gyms LIMIT 1"
                )
            )
            db.session.execute(
                text("SELECT whatsapp_opted_in, whatsapp_opted_in_at FROM members LIMIT 1")
            )
            db.session.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
            return jsonify({"status": "ok", "db": "ok", "schema": "ok"}), 200
        except Exception as exc:
            app.logger.exception("Health check DB failure")
            return jsonify({"status": "error", "db": str(exc)}), 503


def _register_upload_route(app: Flask) -> None:
    @app.route("/uploads/<path:filename>")
    @login_required
    def uploaded_file(filename: str):
        parts = filename.replace("\\", "/").split("/")
        if parts and parts[0] == "gym_qr" and len(parts) >= 2:
            try:
                file_gym_id = int(parts[1])
            except ValueError:
                abort(403)
            if not current_user.is_super_admin and current_user.gym_id != file_gym_id:
                abort(403)
        elif not current_user.is_super_admin:
            abort(403)
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

    @app.route("/media/qr/<token>")
    def signed_qr_file(token: str):
        serializer = URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="qr-media")
        try:
            payload = serializer.loads(token, max_age=24 * 60 * 60)
        except (BadSignature, SignatureExpired):
            abort(403)

        filename = str(payload.get("path", "")).replace("\\", "/")
        parts = filename.split("/")
        if len(parts) < 3 or parts[0] != "gym_qr":
            abort(403)
        try:
            int(parts[1])
        except ValueError:
            abort(403)
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


def _register_template_helpers(app: Flask) -> None:
    @app.context_processor
    def inject_helpers():
        def page_url(page: int) -> str:
            args = request.args.to_dict()
            args["page"] = page
            return url_for(request.endpoint, **(request.view_args or {}), **args)

        return {"page_url": page_url, "current_year": datetime.utcnow().year}


def _register_cli(app: Flask) -> None:
    from app.models import Gym, User

    @app.cli.command("create-admin")
    def create_admin() -> None:
        email = os.getenv("DEFAULT_ADMIN_EMAIL", "admin@example.com")
        password = os.getenv("DEFAULT_ADMIN_PASSWORD")
        if not password:
            print("ERROR: Set DEFAULT_ADMIN_PASSWORD before running create-admin.")
            return
        user = User.query.filter_by(email=email).first()
        if user:
            print(f"Admin already exists: {email}")
            return

        admin = User(
            email=email,
            full_name="Platform Admin",
            role="super_admin",
            is_active=True,
        )
        admin.set_password(password)
        db.session.add(admin)
        db.session.commit()
        print(f"Created super admin: {email}")

    @app.cli.command("seed-demo")
    def seed_demo() -> None:
        flask_env = os.getenv("FLASK_ENV", "development")
        if flask_env == "production" and not os.getenv("DEMO_OWNER_PASSWORD"):
            print(
                "ERROR: Set DEMO_OWNER_PASSWORD before running seed-demo in production. "
                "Refusing to create account with default password."
            )
            return

        from datetime import date, timedelta

        from app.models import Member, MembershipPlan, NotificationTemplate, QRSettings

        gym = Gym.query.filter_by(slug="demo-gym").first()
        if not gym:
            gym = Gym(name="Demo Fitness", slug="demo-gym", email="owner@example.com")
            db.session.add(gym)
            db.session.flush()

        owner = User.query.filter_by(email="owner@example.com").first()
        if not owner:
            owner_password = os.getenv("DEMO_OWNER_PASSWORD", "ChangeMe123!")
            owner = User(
                gym_id=gym.id,
                email="owner@example.com",
                full_name="Demo Owner",
                role="gym_owner",
            )
            owner.set_password(owner_password)
            db.session.add(owner)

        plan = MembershipPlan.query.filter_by(gym_id=gym.id, name="Monthly").first()
        if not plan:
            plan = MembershipPlan(
                gym_id=gym.id,
                name="Monthly",
                duration_days=30,
                price=1500,
            )
            db.session.add(plan)
            db.session.flush()

        if not Member.query.filter_by(gym_id=gym.id).first():
            db.session.add_all(
                [
                    Member(
                        gym_id=gym.id,
                        plan_id=plan.id,
                        full_name="Aarav Sharma",
                        phone="+919999999999",
                        membership_start=date.today() - timedelta(days=24),
                        membership_end=date.today() + timedelta(days=6),
                        status="active",
                    ),
                    Member(
                        gym_id=gym.id,
                        plan_id=plan.id,
                        full_name="Maya Iyer",
                        phone="+918888888888",
                        membership_start=date.today() - timedelta(days=35),
                        membership_end=date.today() - timedelta(days=5),
                        status="expired",
                    ),
                ]
            )

        if not QRSettings.query.filter_by(gym_id=gym.id).first():
            db.session.add(QRSettings(gym_id=gym.id, payment_label="Demo Fitness UPI"))

        if not NotificationTemplate.query.filter_by(gym_id=gym.id).first():
            db.session.add(
                NotificationTemplate(
                    gym_id=gym.id,
                    name="Default renewal reminder",
                    days_before=3,
                    message_body=(
                        "Hi {{ member_name }}, your {{ gym_name }} membership "
                        "expires on {{ expiry_date }}. Please pay using the QR "
                        "and share confirmation."
                    ),
                )
            )

        db.session.commit()
        print("Seeded demo tenant owner@example.com / ChangeMe123!")

    @app.cli.command("run-reminders")
    def run_reminders() -> None:
        import json

        from app.models import Member
        from app.services.audit_service import audit
        from app.services.analytics_service import invalidate_dashboard_cache
        from app.services.reminder_service import run_due_reminders_for_gym, today_for_gym

        active_gyms = Gym.query.filter_by(status="active").all()
        totals = {"queued": 0, "sent": 0, "failed": 0, "skipped": 0}
        for gym in active_gyms:
            local_today = today_for_gym(gym.timezone or "Asia/Kolkata")
            expired_members = (
                Member.query.filter(
                    Member.gym_id == gym.id,
                    Member.membership_end < local_today,
                    Member.status == "active",
                    Member.deleted_at.is_(None),
                )
                .with_for_update()
                .order_by(Member.id.asc())
                .all()
            )
            for member in expired_members:
                member.status = "expired"
                audit(
                    action="auto_expired",
                    resource_type="member",
                    resource_id=member.id,
                    gym_id=gym.id,
                    metadata={"membership_end": str(member.membership_end)},
                )
            if expired_members:
                invalidate_dashboard_cache(gym.id)
                db.session.commit()
                app.logger.info(
                    json.dumps(
                        {"event": "auto_expired", "gym_id": gym.id, "count": len(expired_members)}
                    )
                )

            result = run_due_reminders_for_gym(
                gym.id,
                app.config["REMINDER_DAYS_BEFORE"],
                gym.timezone or "Asia/Kolkata",
            )
            for key, value in result.items():
                totals[key] = totals.get(key, 0) + value
            app.logger.info(
                json.dumps(
                    {"event": "gym_reminders", "gym_id": gym.id, "gym": gym.name, **result}
                )
            )
        app.logger.info(json.dumps({"event": "reminders_complete", **totals}))

    @app.cli.command("purge-audit-logs")
    def purge_audit_logs() -> None:
        from app.services.audit_service import purge_old_audit_logs

        count = purge_old_audit_logs(retention_days=90)
        print(f"Purged {count} audit log entries older than 90 days.")


def _start_scheduler(app: Flask) -> None:
    if not app.config["ENABLE_SCHEDULER"]:
        return

    from app.services.reminder_scheduler import configure_scheduler

    configured = configure_scheduler(app)
    if configured and not scheduler.running:
        scheduler.start()
