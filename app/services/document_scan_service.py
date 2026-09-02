"""AI Document Scanner Service for Member Records Onboarding.

Uses OpenRouter free vision models to extract structured gym member records from
paper registers, membership forms, fee receipts, and rosters.
Ensures zero client secret leakage, rigorous server-side normalization, plan matching,
duplicate detection, and actionable review warnings before final confirmation.
"""
from __future__ import annotations

import base64
import json
import re
import time
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import requests
from flask import current_app

from app.models import Member, MembershipPlan
from app.services.reminder_service import today_for_gym
from app.utils.helpers import normalize_phone_e164


E164_REGEX = re.compile(r"^\+[1-9]\d{7,14}$")

DATE_FORMATS = [
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%Y/%m/%d",
    "%d %b %Y",
    "%d %B %Y",
    "%b %d, %Y",
    "%B %d, %Y",
    "%d-%b-%Y",
    "%d-%B-%Y",
]


def _normalize_date(date_str: str | None) -> tuple[str | None, list[str]]:
    """Normalize extracted date string to ISO YYYY-MM-DD or report ambiguity."""
    if not date_str or not str(date_str).strip():
        return None, []

    cleaned = str(date_str).strip()
    warnings: list[str] = []

    # Check for ambiguous numerical dates like 01/02/2026 where day vs month is ambiguous
    # If standard ISO YYYY-MM-DD, direct return
    try:
        iso_d = date.fromisoformat(cleaned)
        return iso_d.isoformat(), []
    except ValueError:
        pass

    for fmt in DATE_FORMATS:
        try:
            parsed = datetime.strptime(cleaned, fmt).date()
            return parsed.isoformat(), []
        except ValueError:
            continue

    warnings.append(f"Date format ambiguous or unparseable: '{cleaned}'")
    return None, warnings


class DocumentScanService:
    """Handles image validation, multimodal extraction via OpenRouter, and data normalization."""

    @staticmethod
    def get_api_key() -> str:
        return (
            current_app.config.get("OPENROUTER_API_KEY")
            or current_app.config.get("BOT_AI_API_KEY")
            or ""
        ).strip()

    @staticmethod
    def is_configured() -> bool:
        return bool(DocumentScanService.get_api_key())

    @classmethod
    def scan_member_documents(
        cls,
        gym_id: int,
        gym_timezone: str,
        images: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Process one or more document images and return validated candidate member records."""
        if not images:
            return {
                "ok": False,
                "error_code": "NO_IMAGES_PROVIDED",
                "message": "Please provide at least one document image to scan.",
                "members": [],
                "summary": {"total": 0, "ready": 0, "needs_review": 0, "duplicates": 0},
            }

        max_images = current_app.config.get("DOCUMENT_SCAN_MAX_IMAGES", 5)
        if len(images) > max_images:
            return {
                "ok": False,
                "error_code": "MAX_IMAGES_EXCEEDED",
                "message": f"You can scan at most {max_images} document pages in one request.",
                "members": [],
                "summary": {"total": 0, "ready": 0, "needs_review": 0, "duplicates": 0},
            }

        api_key = cls.get_api_key()
        if not api_key:
            return {
                "ok": False,
                "error_code": "AI_NOT_CONFIGURED",
                "message": "AI scanning is temporarily unavailable. You can import CSV or add members manually.",
                "members": [],
                "summary": {"total": 0, "ready": 0, "needs_review": 0, "duplicates": 0},
            }

        # 1. Validate images
        validated_images: list[dict[str, str]] = []
        max_size_bytes = current_app.config.get("DOCUMENT_SCAN_MAX_IMAGE_SIZE_MB", 5) * 1024 * 1024

        for idx, img in enumerate(images, start=1):
            data_b64 = img.get("data") or img.get("base64") or ""
            mime_type = (img.get("mime_type") or "image/jpeg").lower()

            if mime_type not in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
                return {
                    "ok": False,
                    "error_code": "INVALID_IMAGE_FORMAT",
                    "message": f"Page {idx} has an unsupported format ({mime_type}). Use JPEG, PNG, or WebP.",
                    "members": [],
                    "summary": {"total": 0, "ready": 0, "needs_review": 0, "duplicates": 0},
                }

            # Strip data url prefix if present
            if "," in data_b64:
                data_b64 = data_b64.split(",", 1)[1]

            try:
                decoded = base64.b64decode(data_b64, validate=True)
                if len(decoded) > max_size_bytes:
                    return {
                        "ok": False,
                        "error_code": "IMAGE_TOO_LARGE",
                        "message": f"Page {idx} exceeds {current_app.config.get('DOCUMENT_SCAN_MAX_IMAGE_SIZE_MB', 5)} MB limit.",
                        "members": [],
                        "summary": {"total": 0, "ready": 0, "needs_review": 0, "duplicates": 0},
                    }
                if len(decoded) < 100:
                    return {
                        "ok": False,
                        "error_code": "IMAGE_TOO_SMALL",
                        "message": f"Page {idx} appears corrupted or empty.",
                        "members": [],
                        "summary": {"total": 0, "ready": 0, "needs_review": 0, "duplicates": 0},
                    }
            except Exception:
                return {
                    "ok": False,
                    "error_code": "INVALID_BASE64",
                    "message": f"Page {idx} contains invalid image data.",
                    "members": [],
                    "summary": {"total": 0, "ready": 0, "needs_review": 0, "duplicates": 0},
                }

            validated_images.append({
                "mime_type": mime_type if mime_type != "image/jpg" else "image/jpeg",
                "base64": data_b64,
                "filename": img.get("filename", f"page_{idx}.jpg"),
            })

        # 2. Call OpenRouter Vision AI
        raw_extraction, ai_error = cls._call_openrouter_vision(validated_images, api_key)
        if ai_error:
            return {
                "ok": False,
                "error_code": ai_error.get("code", "AI_SCAN_FAILED"),
                "message": ai_error.get("message", "Could not read records from this document."),
                "members": [],
                "summary": {"total": 0, "ready": 0, "needs_review": 0, "duplicates": 0},
            }

        # 3. Normalize & match against gym's active plans and members
        processed = cls._normalize_and_enrich_records(
            gym_id=gym_id,
            gym_timezone=gym_timezone,
            raw_members=raw_extraction.get("members", []),
            doc_warnings=raw_extraction.get("document_warnings", []),
        )

        return {
            "ok": True,
            "data": processed,
        }

    @classmethod
    def _call_openrouter_vision(
        cls,
        images: list[dict[str, str]],
        api_key: str,
    ) -> tuple[dict[str, Any], dict[str, str] | None]:
        """Execute multimodal request with primary model and fallback model."""
        base_url = current_app.config.get("BOT_AI_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
        primary_model = current_app.config.get("OPENROUTER_VISION_MODEL_PRIMARY", "google/gemini-2.0-flash-exp:free")
        fallback_model = current_app.config.get("OPENROUTER_VISION_MODEL_FALLBACK", "meta-llama/llama-3.2-11b-vision-instruct:free")
        timeout = current_app.config.get("DOCUMENT_SCAN_TIMEOUT_SECONDS", 25)

        system_prompt = (
            "You are an expert document OCR extraction assistant for gym membership records. "
            "Your task is to extract structured gym member data from the provided document images (which may be "
            "paper registers, handwritten forms, printed member rosters, receipts, or membership cards).\n\n"
            "RULES:\n"
            "1. Extract each individual member row/record found in the image(s).\n"
            "2. DO NOT hallucinate or fabricate information. If a field is unreadable, blurred, or missing, return null.\n"
            "3. If uncertain about a value, set it to null or the best readable string and add an explicit note in 'warnings'.\n"
            "4. For phone numbers, extract digits and country code if present (e.g. +919876543210 or 9876543210).\n"
            "5. For dates, extract the visible date string (e.g. 2026-06-01 or 01/06/2026 or 1 June 2026).\n"
            "6. For plan_name, extract the membership plan text (e.g. Monthly, Quarterly, Annual, Gold, 3 Month).\n"
            "7. For amount, extract the fee amount paid if visible (e.g. 1500, 4500.00).\n"
            "8. Assign confidence between 0.0 and 1.0 based on document legibility.\n"
            "9. Return ONLY valid JSON matching the exact schema below, with no surrounding commentary.\n\n"
            "JSON SCHEMA:\n"
            "{\n"
            '  "members": [\n'
            "    {\n"
            '      "name": "Member Full Name",\n'
            '      "phone": "9876543210",\n'
            '      "email": "optional_email@example.com or null",\n'
            '      "plan_name": "Quarterly or null",\n'
            '      "start_date": "YYYY-MM-DD or DD/MM/YYYY or null",\n'
            '      "expiry_date": "YYYY-MM-DD or DD/MM/YYYY or null",\n'
            '      "amount": "1500 or null",\n'
            '      "notes": "any notes or null",\n'
            '      "confidence": 0.95,\n'
            '      "warnings": []\n'
            "    }\n"
            "  ],\n"
            '  "document_warnings": []\n'
            "}"
        )

        content_parts: list[dict[str, Any]] = [
            {"type": "text", "text": "Extract all gym member records from these document pages into the requested JSON schema."}
        ]

        for img in images:
            content_parts.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{img['mime_type']};base64,{img['base64']}",
                },
            })

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content_parts},
        ]

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://renewaldesk.app",
            "X-Title": "Renewal Desk AI Member Scanner",
        }

        # Multi-tier resilient vision models
        default_vision_models = [
            "google/gemini-2.0-flash-001",
            "google/gemini-2.0-flash:free",
            "qwen/qwen-2.5-vl-72b-instruct:free",
            "meta-llama/llama-3.2-11b-vision-instruct:free",
            "mistralai/pixtral-12b:free",
        ]

        configured_models = [primary_model]
        if fallback_model and fallback_model not in configured_models:
            configured_models.append(fallback_model)

        models_to_try: list[str] = []
        for m in configured_models + default_vision_models:
            if m and m not in models_to_try:
                models_to_try.append(m)

        last_error_msg = "Could not read records from this document."

        for model in models_to_try:
            payload = {
                "model": model,
                "messages": messages,
                "temperature": 0.1,
                "max_tokens": 3000,
                "response_format": {"type": "json_object"},
            }

            try:
                resp = requests.post(
                    f"{base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                    timeout=timeout,
                )

                if resp.status_code == 200:
                    data = resp.json()
                    choices = data.get("choices") or []
                    if choices:
                        raw_content = choices[0].get("message", {}).get("content", "").strip()
                        parsed = cls._safe_parse_json(raw_content)
                        if parsed and isinstance(parsed, dict) and "members" in parsed:
                            return parsed, None

                if resp.status_code == 429:
                    last_error_msg = "AI scanning rate limit reached. Please wait a moment and try again."
                    continue

                current_app.logger.warning(
                    "OpenRouter vision model %s returned HTTP %s: %s",
                    model, resp.status_code, resp.text[:200]
                )
                last_error_msg = f"AI Provider returned status {resp.status_code}."
                continue
            except requests.Timeout:
                last_error_msg = "Document scanning timed out. Please try with clearer or fewer images."
                continue
            except Exception as exc:
                last_error_msg = f"Network or processing error during AI scan: {str(exc)}"
                continue

        return {}, {"code": "AI_PROCESSING_ERROR", "message": last_error_msg}

    @staticmethod
    def _safe_parse_json(text: str) -> dict[str, Any] | None:
        """Strip markdown fences and parse JSON defensively."""
        if not text:
            return None

        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)

        try:
            return json.loads(cleaned)
        except Exception:
            # Try to locate { ... } block
            match = re.search(r"\{.*\}", cleaned, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group(0))
                except Exception:
                    pass
            return None

    @classmethod
    def _normalize_and_enrich_records(
        cls,
        gym_id: int,
        gym_timezone: str,
        raw_members: list[dict[str, Any]],
        doc_warnings: list[str],
    ) -> dict[str, Any]:
        """Normalize extracted member records, match plans, and flag duplicates."""
        gym_today = today_for_gym(gym_timezone)

        # 1. Fetch active gym plans
        plans = MembershipPlan.query.filter_by(gym_id=gym_id, is_active=True).all()
        plan_lookup = {p.name.strip().lower(): p for p in plans}
        serialized_plans = [
            {"id": p.id, "name": p.name, "duration_days": p.duration_days, "price": str(p.price)}
            for p in plans
        ]

        # 2. Fetch existing active member phones and names for duplicate check
        existing_members = (
            Member.query.with_entities(Member.id, Member.phone, Member.full_name)
            .filter_by(gym_id=gym_id)
            .filter(Member.deleted_at.is_(None))
            .all()
        )
        existing_phones = {m.phone: m for m in existing_members if m.phone}
        existing_names = {m.full_name.strip().lower(): m for m in existing_members if m.full_name}

        enriched_members: list[dict[str, Any]] = []
        seen_batch_phones: set[str] = set()

        for idx, item in enumerate(raw_members, start=1):
            name = (item.get("name") or item.get("full_name") or "").strip()
            raw_phone = str(item.get("phone") or "").strip()
            raw_email = str(item.get("email") or "").strip() or None
            raw_plan = str(item.get("plan_name") or item.get("plan") or "").strip()
            raw_start = item.get("start_date") or item.get("membership_start")
            raw_end = item.get("expiry_date") or item.get("membership_end")
            raw_amount = str(item.get("amount") or "").strip()
            notes = str(item.get("notes") or "").strip() or None
            confidence = float(item.get("confidence") or 0.8)
            warnings = list(item.get("warnings") or [])

            # Validation & Normalization
            # 1. Name check
            if not name:
                warnings.append("Member name missing")

            # 2. Phone normalization (E.164)
            normalized_phone = ""
            if raw_phone:
                normalized_phone = normalize_phone_e164(raw_phone)
                if not E164_REGEX.match(normalized_phone):
                    warnings.append(f"Phone number '{raw_phone}' is not in valid international format")
            else:
                warnings.append("Phone number missing")

            # 3. Duplicate checks
            is_duplicate = False
            duplicate_reason = None
            if normalized_phone:
                if normalized_phone in existing_phones:
                    is_duplicate = True
                    duplicate_reason = f"Phone already belongs to active member '{existing_phones[normalized_phone].full_name}'"
                    warnings.append(duplicate_reason)
                elif normalized_phone in seen_batch_phones:
                    is_duplicate = True
                    duplicate_reason = "Duplicate phone number within this scanned batch"
                    warnings.append(duplicate_reason)
                seen_batch_phones.add(normalized_phone)

            # 4. Dates normalization
            start_date_iso, start_warnings = _normalize_date(raw_start)
            expiry_date_iso, end_warnings = _normalize_date(raw_end)
            warnings.extend(start_warnings)
            warnings.extend(end_warnings)

            if not start_date_iso and not expiry_date_iso:
                # Default start date to today if start date is missing
                start_date_iso = gym_today.isoformat()

            # If start date exists and plan is matched, calculate end date if missing
            matched_plan = None
            if raw_plan:
                plan_key = raw_plan.lower()
                matched_plan = plan_lookup.get(plan_key)
                if not matched_plan:
                    # Try partial match (e.g. "Monthly Plan" matches "Monthly")
                    for k, p in plan_lookup.items():
                        if k in plan_key or plan_key in k:
                            matched_plan = p
                            break

                if not matched_plan:
                    warnings.append(f"Plan '{raw_plan}' not matched to an existing gym plan")
            else:
                warnings.append("Membership plan not specified")

            if start_date_iso and not expiry_date_iso and matched_plan:
                from datetime import timedelta
                s_date = date.fromisoformat(start_date_iso)
                expiry_date_iso = (s_date + timedelta(days=matched_plan.duration_days)).isoformat()

            if start_date_iso and expiry_date_iso:
                if date.fromisoformat(expiry_date_iso) < date.fromisoformat(start_date_iso):
                    warnings.append("Expiry date cannot be earlier than start date")

            # Status determination
            status = "active"
            if expiry_date_iso:
                if date.fromisoformat(expiry_date_iso) < gym_today:
                    status = "expired"

            # Amount validation
            amount_decimal = None
            if raw_amount:
                clean_amt = re.sub(r"[^\d.]", "", raw_amount)
                try:
                    amount_decimal = str(Decimal(clean_amt).quantize(Decimal("0.01")))
                except (InvalidOperation, ValueError):
                    pass

            # Confidence Level
            confidence_level = "HIGH" if confidence >= 0.85 else ("MEDIUM" if confidence >= 0.60 else "LOW")

            # Ready for import if name, valid phone, valid dates, and no critical blocking errors
            is_ready = bool(
                name
                and normalized_phone
                and E164_REGEX.match(normalized_phone)
                and start_date_iso
                and expiry_date_iso
                and not is_duplicate
            )

            enriched_members.append({
                "temp_id": f"scan_{idx}",
                "name": name,
                "phone": normalized_phone or raw_phone,
                "email": raw_email,
                "plan_id": matched_plan.id if matched_plan else None,
                "plan_name": matched_plan.name if matched_plan else (raw_plan or None),
                "membership_start": start_date_iso,
                "membership_end": expiry_date_iso,
                "status": status,
                "amount": amount_decimal or (str(matched_plan.price) if matched_plan else None),
                "notes": notes,
                "confidence": confidence,
                "confidence_level": confidence_level,
                "warnings": warnings,
                "is_duplicate": is_duplicate,
                "is_ready": is_ready,
                "selected": is_ready,
            })

        total_count = len(enriched_members)
        ready_count = sum(1 for m in enriched_members if m["is_ready"])
        duplicate_count = sum(1 for m in enriched_members if m["is_duplicate"])
        needs_review_count = total_count - ready_count

        return {
            "members": enriched_members,
            "plans": serialized_plans,
            "summary": {
                "total": total_count,
                "ready": ready_count,
                "needs_review": needs_review_count,
                "duplicates": duplicate_count,
            },
            "document_warnings": doc_warnings,
        }
