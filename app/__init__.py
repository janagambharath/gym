from __future__ import annotations

import logging
import os
from pathlib import Path

from datetime import datetime

from flask import Flask, redirect, render_template, request, send_from_directory, url_for
from flask_login import current_user

from app.config import config_by_name
from app.extensions import csrf, db, login_manager, migrate, scheduler


def create_app(config_name: str | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    selected_config = config_name or os.getenv("FLASK_ENV", "default")
    app.config.from_object(config_by_name[selected_config])

    _normalize_database_url(app)
    _ensure_runtime_dirs(app)
    _configure_logging(app)
    _init_extensions(app)
    _register_blueprints(app)
    _register_error_handlers(app)
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


def _ensure_runtime_dirs(app: Flask) -> None:
    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)
    Path(app.instance_path).mkdir(parents=True, exist_ok=True)


def _configure_logging(app: Flask) -> None:
    logging.basicConfig(
        level=app.config["LOG_LEVEL"],
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


def _init_extensions(app: Flask) -> None:
    db.init_app(app)
    migrate.init_app(app, db)
    csrf.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = "auth.login"
    login_manager.login_message_category = "warning"


def _register_blueprints(app: Flask) -> None:
    from app.admin.routes import admin_bp
    from app.auth.routes import auth_bp
    from app.gym.routes import gym_bp
    from app.members.routes import members_bp
    from app.payments.routes import payments_bp
    from app.reminders.routes import reminders_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(gym_bp)
    app.register_blueprint(members_bp)
    app.register_blueprint(payments_bp)
    app.register_blueprint(reminders_bp)
    app.register_blueprint(admin_bp)


def _register_error_handlers(app: Flask) -> None:
    @app.errorhandler(403)
    def forbidden(error):
        return render_template("errors/403.html"), 403

    @app.errorhandler(404)
    def not_found(error):
        return render_template("errors/404.html"), 404

    @app.errorhandler(500)
    def server_error(error):
        app.logger.exception("Unhandled server error: %s", error)
        return render_template("errors/500.html"), 500


def _register_upload_route(app: Flask) -> None:
    @app.route("/uploads/<path:filename>")
    def uploaded_file(filename: str):
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
        email = app.config["DEFAULT_ADMIN_EMAIL"]
        password = app.config["DEFAULT_ADMIN_PASSWORD"]
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
        from datetime import date, timedelta

        from app.models import Member, MembershipPlan, NotificationTemplate, QRSettings

        gym = Gym.query.filter_by(slug="demo-gym").first()
        if not gym:
            gym = Gym(name="Demo Fitness", slug="demo-gym", email="owner@example.com")
            db.session.add(gym)
            db.session.flush()

        owner = User.query.filter_by(email="owner@example.com").first()
        if not owner:
            owner = User(
                gym_id=gym.id,
                email="owner@example.com",
                full_name="Demo Owner",
                role="gym_owner",
            )
            owner.set_password("ChangeMe123!")
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
        from app.services.reminder_service import run_due_reminders_for_gym

        active_gyms = Gym.query.filter_by(status="active").all()
        totals = {"queued": 0, "sent": 0, "failed": 0, "skipped": 0}
        for gym in active_gyms:
            result = run_due_reminders_for_gym(gym.id, app.config["REMINDER_DAYS_BEFORE"])
            for key, value in result.items():
                totals[key] = totals.get(key, 0) + value
            print(f"{gym.name}: {result}")
        print(f"Totals: {totals}")


def _start_scheduler(app: Flask) -> None:
    if not app.config["ENABLE_SCHEDULER"]:
        return

    from app.services.reminder_scheduler import configure_scheduler

    configure_scheduler(app)
    if not scheduler.running:
        scheduler.start()
