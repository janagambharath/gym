"""Shared server-side validation for the mobile CSV preview and atomic import."""
from __future__ import annotations

import csv
import io
import re
from decimal import Decimal, InvalidOperation
from datetime import date
from typing import Any

from app.models import Member, MembershipPlan
from app.services.bridge_service import canonical_enroll_number
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

    plans = {plan.name.lower(): plan for plan in MembershipPlan.query.filter_by(gym_id=gym_id, is_active=True)}
    existing_phones = {
        phone for (phone,) in Member.query.with_entities(Member.phone).filter_by(gym_id=gym_id).filter(Member.deleted_at.is_(None))
    }
    existing_enrolls = {
        canonical_enroll_number(enroll)
        for (enroll,) in Member.query.with_entities(Member.device_enroll_number)
        .filter_by(gym_id=gym_id)
        .filter(Member.deleted_at.is_(None), Member.device_enroll_number.isnot(None))
        .all()
    }
    seen_phones: set[str] = set()
    seen_enrolls: set[str] = set()
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
        plan = plans.get(plan_name.lower()) if plan_name else None
        if plan_name and plan is None:
            errors.append(f"plan '{plan_name}' does not exist for this gym")
        plan_id = plan.id if plan else None

        raw_price = row.get("price", "") or row.get("member_price", "")
        if raw_price:
            try:
                parsed_price = Decimal(raw_price)
                member_price = parsed_price.quantize(Decimal("0.01"))
                if (not parsed_price.is_finite() or parsed_price < 0
                        or parsed_price > Decimal("99999999.99")
                        or parsed_price != member_price):
                    raise InvalidOperation
            except (InvalidOperation, ValueError):
                errors.append("price must be a non-negative amount with up to two decimal places")
                member_price = Decimal("0.00")
        else:
            member_price = Decimal(str(plan.price)) if plan else Decimal("0.00")

        device_enroll_number = row.get("device_enroll_number", "").strip()
        if device_enroll_number:
            try:
                device_enroll_number = canonical_enroll_number(device_enroll_number)
                if device_enroll_number in seen_enrolls or device_enroll_number in existing_enrolls:
                    errors.append("duplicate biometric Enroll Number")
                seen_enrolls.add(device_enroll_number)
            except ValueError as exc:
                errors.append(str(exc))
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
                "gender": gender, "plan_id": plan_id, "price": str(member_price),
                "device_enroll_number": device_enroll_number or None,
                "membership_start": start,
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
