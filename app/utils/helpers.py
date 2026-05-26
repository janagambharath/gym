from __future__ import annotations

import re
import unicodedata
from datetime import date

from flask import current_app
from itsdangerous import URLSafeTimedSerializer


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return cleaned or "gym"


def phone_to_whatsapp(phone: str) -> str:
    cleaned = re.sub(r"[^\d+]", "", phone or "")
    if cleaned.startswith("+"):
        return cleaned.lstrip("+")
    if len(cleaned) == 10:
        return f"91{cleaned}"
    return cleaned


def pagination_window(page: int, pages: int, radius: int = 2) -> range:
    start = max(1, page - radius)
    end = min(pages, page + radius)
    return range(start, end + 1)


def public_upload_url(relative_path: str | None) -> str | None:
    if not relative_path:
        return None
    base_url = current_app.config.get("PUBLIC_BASE_URL")
    if not base_url:
        return None
    clean_path = relative_path.replace("\\", "/")
    return f"{base_url}/uploads/{clean_path}"


def signed_upload_url(relative_path: str | None) -> str | None:
    if not relative_path:
        return None
    base_url = current_app.config.get("PUBLIC_BASE_URL")
    if not base_url:
        return None
    serializer = URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="qr-media")
    token = serializer.dumps({"path": relative_path.replace("\\", "/")})
    return f"{base_url}/media/qr/{token}"


def format_date(value: date | None) -> str:
    return value.strftime("%d %b %Y") if value else ""
