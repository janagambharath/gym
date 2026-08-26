from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required
from sqlalchemy import func, select

from app.extensions import db
from app.forms.member import E164_RE
from app.models import Member, MembershipPlan
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.audit_service import audit
from app.services.bridge_service import queue_membership_command
from app.services.reminder_service import today_for_gym
from app.utils.decorators import active_gym_required, roles_required


import_bp = Blueprint("members_import", __name__, url_prefix="/members/import")

_REQUIRED_COLUMNS = {"full_name", "phone", "membership_start", "membership_end"}
_DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y")


def _parse_date(value: str, row_errors: list[str], field: str):
    value = (value or "").strip()
    if not value:
        row_errors.append(f"{field} is required")
        return None
    for date_format in _DATE_FORMATS:
        try:
            return datetime.strptime(value, date_format).date()
        except ValueError:
            continue
    row_errors.append(f"{field} '{value}' is not a recognized date (use YYYY-MM-DD)")
    return None


@import_bp.route("", methods=["GET", "POST"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def import_members():
    if request.method == "GET":
        return render_template("members/import.html")

    upload = request.files.get("csv_file")
    if not upload or not upload.filename:
        flash("Choose a CSV file to import.", "danger")
        return redirect(url_for("members_import.import_members"))

    try:
        raw = upload.stream.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        flash("Could not read the file. Please save it as UTF-8 CSV and try again.", "danger")
        return redirect(url_for("members_import.import_members"))

    reader = csv.DictReader(io.StringIO(raw))
    if reader.fieldnames is None:
        flash("The CSV file appears to be empty.", "danger")
        return redirect(url_for("members_import.import_members"))

    headers = {name.strip().lower() for name in reader.fieldnames}
    missing = _REQUIRED_COLUMNS - headers
    if missing:
        flash(
            f"Missing required column(s): {', '.join(sorted(missing))}. "
            f"Required columns are: {', '.join(sorted(_REQUIRED_COLUMNS))}.",
            "danger",
        )
        return redirect(url_for("members_import.import_members"))

    plans_by_name = {
        plan.name.lower(): plan
        for plan in MembershipPlan.query.filter_by(gym_id=current_user.gym_id).all()
    }

    # Pre-fetch existing phone numbers in gym for duplicate detection
    existing_phones = {
        m.phone for m in Member.query.filter_by(gym_id=current_user.gym_id).filter(Member.deleted_at.is_(None)).all()
    }

    valid_rows: list[dict] = []
    row_errors: dict[int, list[str]] = {}
    seen_in_file_phones: set[str] = set()
    duplicate_count = 0

    batch_id = f"IMPORT-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"

    for index, row in enumerate(reader, start=2):
        row = {(key or "").strip().lower(): (value or "").strip() for key, value in row.items()}
        errors: list[str] = []

        full_name = row.get("full_name", "")
        if not full_name:
            errors.append("full_name is required")

        phone = row.get("phone", "")
        cleaned_phone = phone.replace(" ", "")
        if not E164_RE.match(cleaned_phone):
            errors.append(f"phone '{phone}' must be in E.164 format, e.g. +919876543210")
        elif cleaned_phone in existing_phones:
            errors.append(f"phone '{phone}' is already registered in this gym (duplicate)")
            duplicate_count += 1
        elif cleaned_phone in seen_in_file_phones:
            errors.append(f"phone '{phone}' appears multiple times in CSV file")
            duplicate_count += 1
        else:
            seen_in_file_phones.add(cleaned_phone)

        membership_start = _parse_date(row.get("membership_start", ""), errors, "membership_start")
        membership_end = _parse_date(row.get("membership_end", ""), errors, "membership_end")
        if membership_start and membership_end and membership_end < membership_start:
            errors.append("membership_end must be on or after membership_start")

        plan_id = None
        plan_name = row.get("plan", "")
        if plan_name:
            plan = plans_by_name.get(plan_name.lower())
            if not plan:
                errors.append(f"plan '{plan_name}' does not exist for this gym")
            else:
                plan_id = plan.id

        status = row.get("status", "active") or "active"
        if status not in {"active", "expired", "paused"}:
            errors.append(f"status '{status}' must be active, expired, or paused")
        elif membership_end and status == "active" and membership_end < today_for_gym(
            current_user.gym.timezone
        ):
            status = "expired"

        email = row.get("email", "") or None
        gender = row.get("gender", "") or None
        if gender and gender not in {"female", "male", "other"}:
            errors.append(f"gender '{gender}' must be female, male, or other")

        device_enroll = row.get("device_enroll_number", "") or None

        if errors:
            row_errors[index] = errors
            continue

        valid_rows.append(
            {
                "full_name": full_name,
                "phone": cleaned_phone,
                "email": email,
                "gender": gender,
                "plan_id": plan_id,
                "membership_start": membership_start,
                "membership_end": membership_end,
                "status": status,
                "device_enroll_number": device_enroll,
                "external_ref": batch_id,
                "notes": row.get("notes", "") or f"Imported in batch {batch_id}",
            }
        )

    if row_errors and not valid_rows:
        return render_template(
            "members/import.html",
            row_errors=row_errors,
            total_rows=len(valid_rows) + len(row_errors),
            duplicates=duplicate_count,
            invalid=len(row_errors) - duplicate_count,
        )

    gym = current_user.gym
    if gym.max_members is not None:
        locked_gym = db.session.execute(
            select(gym.__class__).where(gym.__class__.id == gym.id).with_for_update()
        ).scalar_one()
        current_count = (
            db.session.query(func.count(Member.id))
            .filter(Member.gym_id == gym.id, Member.deleted_at.is_(None))
            .scalar()
            or 0
        )
        if current_count + len(valid_rows) > locked_gym.max_members:
            db.session.rollback()
            flash(
                f"Importing {len(valid_rows)} members would exceed your "
                f"{locked_gym.max_members}-member limit (currently {current_count}). "
                "Upgrade your plan or import fewer rows.",
                "warning",
            )
            return render_template(
                "members/import.html",
                row_errors=row_errors,
                total_rows=len(valid_rows) + len(row_errors),
                duplicates=duplicate_count,
                invalid=len(row_errors) - duplicate_count,
            )

    created = 0
    for data in valid_rows:
        member = Member(gym_id=current_user.gym_id, **data)
        db.session.add(member)
        created += 1

    audit(
        action="bulk_import_members",
        resource_type="member",
        gym_id=current_user.gym_id,
        metadata={
            "batch_id": batch_id,
            "created": created,
            "skipped": len(row_errors),
            "duplicates": duplicate_count,
        },
    )
    invalidate_dashboard_cache(current_user.gym_id)
    db.session.commit()

    if row_errors:
        flash(
            f"Batch {batch_id}: Imported {created} members. {len(row_errors)} rows skipped ({duplicate_count} duplicates, {len(row_errors) - duplicate_count} invalid).",
            "warning",
        )
        return render_template(
            "members/import.html",
            row_errors=row_errors,
            total_rows=created + len(row_errors),
            imported=created,
            batch_id=batch_id,
            duplicates=duplicate_count,
            invalid=len(row_errors) - duplicate_count,
        )

    flash(f"Batch {batch_id}: Successfully imported {created} member(s).", "success")
    return redirect(url_for("members.index"))


@import_bp.post("/undo/<batch_id>")
@login_required
@active_gym_required
@roles_required("gym_owner")
def undo_import(batch_id: str):
    """Rollback an import batch: soft-deletes members created in that batch who have no payments."""
    from app.models.mixins import utcnow

    members = Member.query.filter_by(gym_id=current_user.gym_id, external_ref=batch_id, deleted_at=None).all()
    if not members:
        flash(f"No active members found for import batch '{batch_id}'.", "warning")
        return redirect(url_for("members.index"))

    undone_count = 0
    for m in members:
        # Check if member has verified payments recorded
        if m.payments:
            continue
        m.deleted_at = utcnow()
        m.status = "deleted"
        queue_membership_command(m)
        undone_count += 1

    audit(
        action="undo_import_batch",
        resource_type="member_batch",
        gym_id=current_user.gym_id,
        metadata={"batch_id": batch_id, "undone_count": undone_count},
    )
    invalidate_dashboard_cache(current_user.gym_id)
    db.session.commit()

    flash(f"Rollback complete: {undone_count} member(s) from batch '{batch_id}' were safely removed.", "success")
    return redirect(url_for("members.index"))
