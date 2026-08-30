"""Shared server-side validation for the mobile CSV preview and atomic import."""
from __future__ import annotations

import csv
import io
import re
from datetime import date
from typing import Any

from app.models import Member, MembershipPlan
from app.services.reminder_service import today_for_gym


REQUIRED_COLUMNS = {"full_name", "phone", "membership_start", "membership_end"}
E164 = re.compile(r"^\+[1-9]\d{7,14}$")
MAX_ROWS = 2_000


def _date(value: str, errors: list[str], name: str) -> date | None:
    try:
        return date.fromisoformat(value)
    except ValueError:
        errors.append(f"{name} must be YYYY-MM-DD")
        return None


def validate_csv(gym_id: int, gym_timezone: str, csv_text: str) -> dict[str, Any]:
    if not isinstance(csv_text, str) or not csv_text.strip():
        return {"rows": [], "summary": {"total": 0, "valid": 0, "invalid": 0, "duplicates": 0}, "file_errors": ["Choose a non-empty UTF-8 CSV file."]}
    if len(csv_text.encode("utf-8")) > 2 * 1024 * 1024:
        return {"rows": [], "summary": {"total": 0, "valid": 0, "invalid": 0, "duplicates": 0}, "file_errors": ["CSV must be 2 MB or smaller."]}
    reader = csv.DictReader(io.StringIO(csv_text.lstrip("\ufeff")))
    headers = {(name or "").strip().lower() for name in (reader.fieldnames or [])}
    missing = sorted(REQUIRED_COLUMNS - headers)
    if missing:
        return {"rows": [], "summary": {"total": 0, "valid": 0, "invalid": 0, "duplicates": 0}, "file_errors": [f"Missing required columns: {', '.join(missing)}."]}

    plans = {plan.name.lower(): plan.id for plan in MembershipPlan.query.filter_by(gym_id=gym_id, is_active=True)}
    existing_phones = {
        phone for (phone,) in Member.query.with_entities(Member.phone).filter_by(gym_id=gym_id).filter(Member.deleted_at.is_(None))
    }
    seen_phones: set[str] = set()
    rows: list[dict[str, Any]] = []
    for row_number, raw in enumerate(reader, start=2):
        if row_number - 1 > MAX_ROWS:
            return {"rows": rows, "summary": _summary(rows), "file_errors": [f"CSV may contain at most {MAX_ROWS} rows."]}
        row = {(key or "").strip().lower(): (value or "").strip() for key, value in raw.items()}
        errors: list[str] = []
        full_name = row.get("full_name", "")
        phone = row.get("phone", "").replace(" ", "")
        if not full_name:
            errors.append("full_name is required")
        if not E164.match(phone):
            errors.append("phone must be in E.164 format, for example +919876543210")
        elif phone in seen_phones:
            errors.append("duplicate phone in this CSV")
        elif phone in existing_phones:
            errors.append("phone already belongs to an active member")
        seen_phones.add(phone)
        start = _date(row.get("membership_start", ""), errors, "membership_start")
        end = _date(row.get("membership_end", ""), errors, "membership_end")
        if start and end and end < start:
            errors.append("membership_end must be on or after membership_start")
        plan_name = row.get("plan", "")
        plan_id = plans.get(plan_name.lower()) if plan_name else None
        if plan_name and plan_id is None:
            errors.append(f"plan '{plan_name}' does not exist for this gym")
        status = (row.get("status") or "active").lower()
        if status not in {"active", "expired", "paused"}:
            errors.append("status must be active, expired, or paused")
        elif end and status == "active" and end < today_for_gym(gym_timezone):
            status = "expired"
        gender = (row.get("gender") or "").lower() or None
        if gender and gender not in {"female", "male", "other"}:
            errors.append("gender must be female, male, or other")
        rows.append({
            "row": row_number,
            "values": row,
            "errors": errors,
            "status": "VALID" if not errors else ("DUPLICATE" if any("duplicate" in item or "already belongs" in item for item in errors) else "INVALID"),
            "normalized": {
                "full_name": full_name, "phone": phone, "email": row.get("email") or None,
                "gender": gender, "plan_id": plan_id, "membership_start": start,
                "membership_end": end, "status": status, "notes": row.get("notes") or None,
            },
        })
        # Keep the preview JSON-safe.  The import endpoint converts these ISO
        # strings back to date objects only after it has revalidated them.
        rows[-1]["normalized"]["membership_start"] = start.isoformat() if start else None
        rows[-1]["normalized"]["membership_end"] = end.isoformat() if end else None
    return {"rows": rows, "summary": _summary(rows), "file_errors": []}


def _summary(rows: list[dict[str, Any]]) -> dict[str, int]:
    duplicates = sum(item["status"] == "DUPLICATE" for item in rows)
    valid = sum(item["status"] == "VALID" for item in rows)
    return {"total": len(rows), "valid": valid, "invalid": len(rows) - valid - duplicates, "duplicates": duplicates}
