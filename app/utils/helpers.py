from __future__ import annotations

import re
import unicodedata
from datetime import date
from urllib.parse import parse_qs, urlparse

from flask import current_app
from itsdangerous import URLSafeTimedSerializer

from app.services.timezone_service import today_for_gym



E164_RE = re.compile(r"^\+\d{7,15}$")


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return cleaned or "gym"


def normalize_phone_e164(phone: str, default_country_code: str = "+91") -> str:
    """Normalize any phone string to E.164 standard (e.g. +917995854994)."""
    raw = (phone or "").strip()
    if not raw:
        return ""
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return raw

    if raw.startswith("+"):
        return f"+{digits}"

    if len(digits) == 10:
        return f"{default_country_code}{digits}"
    if len(digits) == 11 and digits.startswith("0"):
        return f"{default_country_code}{digits[1:]}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+{digits}"

    return f"{default_country_code}{digits}"


def phone_to_whatsapp(phone: str, default_country_code: str = "+91") -> str:
    """Convert phone number to WhatsApp recipient format (digits only with country code, e.g. 917995854994)."""
    raw = (phone or "").strip()
    if not raw:
        raise ValueError("Phone number cannot be empty.")

    normalized = normalize_phone_e164(raw, default_country_code)
    if not E164_RE.match(normalized):
        raise ValueError(f"Phone number '{phone}' is not a valid phone number.")
    return normalized[1:]



def normalize_public_media_url(value: str | None) -> str:
    """Return a fetchable media URL for common sharing-page links."""
    url = (value or "").strip()
    if not url:
        return ""

    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host in {"drive.google.com", "www.drive.google.com"}:
        file_id = ""
        match = re.search(r"/file/d/([^/]+)", parsed.path)
        if match:
            file_id = match.group(1)
        else:
            file_id = (parse_qs(parsed.query).get("id") or [""])[0]
        if file_id:
            return f"https://drive.google.com/uc?export=download&id={file_id}"

    if parsed.scheme == "http":
        return "https" + url[4:]

    return url


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
