"""Report conflicting canonical enroll-number pairs (V4-M6).

The V3-H3 backfill (c4a9012b3d4e) silently SKIPPED any row whose canonical
form was already held by another row — so two members holding "042" and
"42" kept the duplicate canonical ID forever, with no log, no output and
no follow-up list, and every canonical-compare path then resolved
first-holder-wins with no alert.

This migration changes nothing: it REPORTS the conflicting pairs (to
stdout and the migration log) so an owner can clean them up. The code-side
fixes (canonical mapping lookups in _mapped_member / Guard 3, the second-
holder scan in find_member_by_enroll_number) make the duplicates
resolvable; this report makes them visible.

Revises: m3rg3v3fixall
"""

import logging

from alembic import op
import sqlalchemy as sa

revision = "v4a3a3conflicts"
down_revision = "m3rg3v3fixall"

log = logging.getLogger(__name__)


def _canonical(value):
    """Strip leading zeros from an all-digit value; None otherwise."""
    if value is None:
        return None
    text = str(value).strip()
    if not text.isdigit():
        return None
    stripped = text.lstrip("0")
    return stripped if stripped else "0"


def _conflicts(conn, table, id_col, enroll_col):
    """Return {(gym_id, canonical): [(row_id, raw_value), ...]} with >1 row."""
    rows = conn.execute(
        sa.text(
            f"SELECT gym_id, {id_col}, {enroll_col} FROM {table} "
            f"WHERE {enroll_col} IS NOT NULL"
        )
    ).fetchall()
    grouped = {}
    for gym_id, row_id, raw in rows:
        canonical = _canonical(raw)
        if canonical is None:
            continue
        grouped.setdefault((gym_id, canonical), []).append((row_id, str(raw)))
    return {
        key: holders
        for key, holders in grouped.items()
        if len(holders) > 1
        or len({raw for _, raw in holders}) > 1
    }


def upgrade():
    conn = op.get_bind()
    sections = [
        ("members.device_enroll_number", "members", "id", "device_enroll_number"),
        ("rrr_identity_mappings.external_id", "rrr_identity_mappings", "id", "external_id"),
        ("rrr_biometric_templates.enroll_number", "rrr_biometric_templates", "id", "enroll_number"),
    ]
    total = 0
    print("V4-M6 conflicting-canonical-pairs report (no rows changed):")
    for label, table, id_col, enroll_col in sections:
        try:
            conflicts = _conflicts(conn, table, id_col, enroll_col)
        except Exception as exc:  # Table missing on a partial schema — report and move on.
            print(f"  {label}: skipped ({exc})")
            continue
        if not conflicts:
            print(f"  {label}: none")
            continue
        for (gym_id, canonical), holders in sorted(conflicts.items()):
            total += 1
            detail = ", ".join(f"id={row_id} raw={raw!r}" for row_id, raw in holders)
            line = (
                f"  CONFLICT {label} gym={gym_id} canonical={canonical!r}: {detail}"
            )
            print(line)
            log.warning("V4-M6 conflicting canonical pair: %s", line)
    if total:
        print(
            f"V4-M6: {total} conflicting canonical pair(s) found — resolve them "
            "by clearing the duplicate holder's enroll number (linking the ID "
            "to a live member now frees a soft-deleted holder automatically)."
        )
    else:
        print("V4-M6: no conflicting canonical pairs found.")


def downgrade():
    # Report-only migration: nothing to undo.
    pass
