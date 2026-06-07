from __future__ import annotations

import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


BASE_DIR = Path(__file__).resolve().parent.parent


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me")
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL", f"sqlite:///{BASE_DIR / 'instance' / 'dev.db'}"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    WTF_CSRF_ENABLED = True
    WTF_CSRF_TIME_LIMIT = 3600
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    REMEMBER_COOKIE_HTTPONLY = True
    REMEMBER_COOKIE_DURATION = timedelta(days=30)
    PERMANENT_SESSION_LIFETIME = timedelta(hours=12)

    UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", str(BASE_DIR / "uploads"))
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH", str(5 * 1024 * 1024)))
    ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
    PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
    STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local")
    AWS_S3_BUCKET = os.getenv("AWS_S3_BUCKET", "")
    AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "")
    AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")
    AWS_S3_REGION = os.getenv("AWS_S3_REGION", "ap-south-1")
    AWS_S3_PUBLIC_BASE_URL = os.getenv("AWS_S3_PUBLIC_BASE_URL", "").rstrip("/")

    ENABLE_SCHEDULER = os.getenv("ENABLE_SCHEDULER", "false").lower() == "true"
    REMINDER_DAYS_BEFORE = [
        int(day.strip())
        for day in os.getenv("REMINDER_DAYS_BEFORE", "7,3,1,0").split(",")
        if day.strip()
    ]
    REMINDER_JOB_MINUTES = int(os.getenv("REMINDER_JOB_MINUTES", "60"))

    WHATSAPP_ENABLED = os.getenv("WHATSAPP_ENABLED", "false").lower() == "true"
    WHATSAPP_ACCESS_TOKEN = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
    WHATSAPP_API_VERSION = os.getenv("WHATSAPP_API_VERSION", "v20.0")
    WHATSAPP_VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "")
    WHATSAPP_WEBHOOK_SECRET = os.getenv(
        "WHATSAPP_WEBHOOK_SECRET", os.getenv("WHATSAPP_APP_SECRET", "")
    )
    WHATSAPP_REMINDER_TEMPLATE_NAME = os.getenv("WHATSAPP_REMINDER_TEMPLATE_NAME", "").strip()
    WHATSAPP_REMINDER_TEMPLATE_LANGUAGE = os.getenv(
        "WHATSAPP_REMINDER_TEMPLATE_LANGUAGE", "en_US"
    ).strip()
    WHATSAPP_REMINDER_TEMPLATE_BODY_PARAMS = [
        name.strip()
        for name in os.getenv(
            "WHATSAPP_REMINDER_TEMPLATE_BODY_PARAMS",
            "member_name,gym_name,expiry_date,payment_upi_id",
        ).split(",")
        if name.strip()
    ]
    REDIS_URL = os.getenv("REDIS_URL", "memory://")

    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")


class DevelopmentConfig(Config):
    DEBUG = True
    SESSION_COOKIE_SECURE = False
    ENABLE_SCHEDULER = os.getenv("ENABLE_SCHEDULER", "true").lower() == "true"


class TestingConfig(Config):
    TESTING = True
    WTF_CSRF_ENABLED = False
    ENABLE_SCHEDULER = False
    SQLALCHEMY_DATABASE_URI = os.getenv("TEST_DATABASE_URL", "sqlite:///:memory:")


class ProductionConfig(Config):
    DEBUG = False
    SESSION_COOKIE_SECURE = True
    REMEMBER_COOKIE_SECURE = True


config_by_name = {
    "development": DevelopmentConfig,
    "testing": TestingConfig,
    "production": ProductionConfig,
    "default": DevelopmentConfig,
}
