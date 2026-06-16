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
    if app.config.get("WHATSAPP_ENABLED"):
        webhook_secret = app.config.get("WHATSAPP_WEBHOOK_SECRET", "")
        if not webhook_secret or len(webhook_secret) < 16:
            raise RuntimeError(
                "WHATSAPP_WEBHOOK_SECRET must be set to at least 16 characters "
                "when WHATSAPP_ENABLED=true."
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
    from app.members.import_routes import import_bp
    from app.members.routes import members_bp
    from app.payments.routes import payments_bp
    from app.reminders.routes import reminders_bp
    from app.webhooks.whatsapp import webhooks_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(gym_bp)
    app.register_blueprint(staff_bp)
    app.register_blueprint(members_bp)
    app.register_blueprint(import_bp)
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
            db.session.execute(text("SELECT id FROM gyms LIMIT 1"))
            db.session.execute(text("SELECT id FROM members LIMIT 1"))
            db.session.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
            revision = (
                os.getenv("RAILWAY_GIT_COMMIT_SHA")
                or os.getenv("GIT_COMMIT_SHA")
                or os.getenv("SOURCE_VERSION")
                or ""
            )
            return jsonify(
                {
                    "status": "ok",
                    "db": "ok",
                    "schema": "ok",
                    "revision": revision[:12],
                }
            ), 200
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
    from app.services.error_messages import friendly_error

    app.jinja_env.filters["friendly_whatsapp_error"] = friendly_error

    @app.context_processor
    def inject_helpers():
        def page_url(page: int) -> str:
            args = request.args.to_dict()
            args["page"] = page
            return url_for(request.endpoint, **(request.view_args or {}), **args)

        return {"page_url": page_url, "current_year": datetime.utcnow().year}


def _record_reminders_heartbeat(app: Flask, totals: dict) -> None:
    import json
    from datetime import datetime, timezone

    redis_url = app.config.get("REDIS_URL", "memory://")
    if redis_url == "memory://":
        return
    try:
        import redis as _redis

        client = _redis.from_url(redis_url, socket_connect_timeout=2)
        payload = json.dumps(
            {"completed_at": datetime.now(timezone.utc).isoformat(), "totals": totals}
        )
        client.setex("renewaldesk:reminders_heartbeat", 48 * 3600, payload)
    except Exception:
        app.logger.exception("Could not record reminders heartbeat")
    try:
        sentry_sdk.capture_message(f"run-reminders completed: {totals}", level="info")
    except Exception:
        pass


def _register_cli(app: Flask) -> None:
    import click

    from app.models import Gym, User

    def _iter_active_gyms(batch_size: int = 50):
        last_id = 0
        while True:
            batch = (
                Gym.query.filter_by(status="active")
                .filter(Gym.id > last_id)
                .order_by(Gym.id.asc())
                .limit(batch_size)
                .all()
            )
            if not batch:
                break
            for gym in batch:
                last_id = gym.id
                yield gym

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
            gym = Gym(
                name="Demo Fitness",
                slug="demo-gym",
                email="owner@example.com",
                trial_ends_at=date.today() + timedelta(days=14),
            )
            db.session.add(gym)
            db.session.flush()
        elif gym.subscription_status == "trial" and not gym.trial_ends_at:
            gym.trial_ends_at = date.today() + timedelta(days=14)

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
                        "expires on {{ expiry_date }}. Please complete your "
                        "renewal payment and share confirmation."
                    ),
                )
            )

        db.session.commit()
        print("Seeded demo tenant owner@example.com / ChangeMe123!")

    @app.cli.command("run-reminders")
    def run_reminders() -> None:
        import json

        from app.services.reminder_service import (
            auto_expire_members_for_gym,
            run_due_reminders_for_gym,
        )

        totals = {"queued": 0, "sent": 0, "failed": 0, "skipped": 0}
        for gym in _iter_active_gyms():
            expired_count = auto_expire_members_for_gym(gym)
            if expired_count:
                db.session.commit()
                app.logger.info(
                    json.dumps(
                        {"event": "auto_expired", "gym_id": gym.id, "count": expired_count}
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
        _record_reminders_heartbeat(app, totals)

    @app.cli.command("check-reminders-heartbeat")
    def check_reminders_heartbeat() -> None:
        """Exit non-zero if run-reminders has not completed in the last 25 hours."""
        import json
        from datetime import datetime, timezone

        redis_url = app.config.get("REDIS_URL", "memory://")
        if redis_url == "memory://":
            print("REDIS_URL not set; cannot check heartbeat.")
            raise SystemExit(1)

        try:
            import redis as _redis

            client = _redis.from_url(redis_url, socket_connect_timeout=2)
            raw = client.get("renewaldesk:reminders_heartbeat")
        except Exception as exc:
            print(f"Could not read heartbeat from Redis: {exc}")
            raise SystemExit(1)

        if not raw:
            print("No reminders heartbeat found. run-reminders may have never completed.")
            raise SystemExit(1)

        payload = json.loads(raw)
        last_run = datetime.fromisoformat(payload["completed_at"])
        if last_run.tzinfo is None:
            last_run = last_run.replace(tzinfo=timezone.utc)
        age_hours = (datetime.now(timezone.utc) - last_run).total_seconds() / 3600
        if age_hours > 25:
            print(
                f"ALERT: run-reminders last completed {age_hours:.1f} hours ago "
                f"(at {payload['completed_at']}). Expected at least once per 24h."
            )
            raise SystemExit(1)

        print(
            f"OK: run-reminders last completed {age_hours:.1f} hours ago. "
            f"totals={payload['totals']}"
        )

    @app.cli.command("purge-audit-logs")
    def purge_audit_logs() -> None:
        from app.services.audit_service import purge_old_audit_logs

        count = purge_old_audit_logs(retention_days=90)
        print(f"Purged {count} audit log entries older than 90 days.")

    @app.cli.command("hard-delete-gym")
    @click.argument("gym_slug")
    @click.option("--confirm", is_flag=True, help="Must pass --confirm to proceed.")
    def hard_delete_gym(gym_slug: str, confirm: bool) -> None:
        """Permanently delete a suspended gym and its associated data."""
        if not confirm:
            print("ERROR: Pass --confirm to permanently delete this gym.")
            return
        gym = Gym.query.filter_by(slug=gym_slug).first()
        if not gym:
            print(f"ERROR: Gym '{gym_slug}' not found.")
            return
        if gym.status != "suspended":
            print(
                f"ERROR: Gym '{gym_slug}' is not suspended (status={gym.status}). "
                "Suspend it first from the admin panel."
            )
            return
        db.session.delete(gym)
        db.session.commit()
        print(f"Permanently deleted gym '{gym_slug}' and all associated data.")


def _start_scheduler(app: Flask) -> None:
    if not app.config["ENABLE_SCHEDULER"]:
        return

    from app.services.reminder_scheduler import configure_scheduler

    configured = configure_scheduler(app)
    if configured and not scheduler.running:
        scheduler.start()
