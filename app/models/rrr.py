"""RRR domain models.

These tables deliberately sit beside the existing operational gym records.  They
do not replace members, payments or the bridge outbox; they make every recovery
recommendation and connector outcome traceable to those real records.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta, timezone
from decimal import Decimal

from sqlalchemy import CheckConstraint, Index, UniqueConstraint

from app.extensions import db
from app.models.mixins import TenantMixin, TimestampMixin, utcnow


def hash_adms_token(token: str) -> str:
    """SHA-256 of a high-entropy ADMS path token.

    The token itself (~192 bits from ``token_urlsafe(32)``) carries the
    entropy; the hash only removes the plaintext from the database so a
    DB read cannot be replayed as a device credential.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_adms_token() -> tuple[str, str]:
    """Return ``(plaintext_token, token_hash)`` for a fresh ADMS token.

    The plaintext is shown to the owner exactly once (provision/rotate
    response) and must never be stored.
    """
    token = secrets.token_urlsafe(32)
    return token, hash_adms_token(token)


def generate_pairing_salt() -> str:
    return secrets.token_hex(16)


def hash_pairing_code_salted(code: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{code}".encode("utf-8")).hexdigest()


def verify_pairing_code(code: str, stored_hash: str | None, salt: str | None) -> bool:
    """Verify a pairing code against a salted (new) or legacy (old) hash.

    Legacy rows have ``salt is None`` and ``stored_hash`` is the bare
    SHA-256 of the code; they keep verifying during the transition so
    already-issued codes are not invalidated by this change.
    """
    if not stored_hash or not code:
        return False
    if salt:
        candidate = hash_pairing_code_salted(code, salt)
    else:
        candidate = hashlib.sha256(code.encode("utf-8")).hexdigest()
    return hmac.compare_digest(candidate, stored_hash)


def _as_utc(value):
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def issue_salted_pairing_code() -> tuple[str, str, str]:
    """Return ``(code, salt, hash)`` for a new 6-digit pairing code."""
    code = "".join(str(secrets.randbelow(10)) for _ in range(6))
    salt = generate_pairing_salt()
    return code, salt, hash_pairing_code_salted(code, salt)


class RRRIntegration(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "rrr_integrations"
    __table_args__ = (
        UniqueConstraint("gym_id", "connector_type", name="uq_rrr_integration_type"),
        CheckConstraint(
            "connector_type IN ('ebioserver', 'direct_bridge', 'adms_direct', 'csv')",
            name="ck_rrr_integration_type",
        ),
        CheckConstraint(
            "status IN ('not_configured', 'pairing', 'connected', 'degraded', 'disconnected', 'needs_attention')",
            name="ck_rrr_integration_status",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    connector_type = db.Column(db.String(32), nullable=False, index=True)
    display_name = db.Column(db.String(120), nullable=False)
    status = db.Column(db.String(32), nullable=False, default="not_configured", index=True)
    is_primary = db.Column(db.Boolean, nullable=False, default=False)
    device_serial = db.Column(db.String(120), nullable=True, index=True)
    # Per-integration secret embedded in the ADMS path (/iclock/<token>/...).
    # Serial-only auth is enumerable; the token makes the path unguessable.
    # ADMS AUTH HARDENING (batch #3): new tokens are stored ONLY as a
    # SHA-256 hash (``adms_token_hash``); ``adms_path_token`` survives
    # solely as the legacy plaintext column for rows provisioned before
    # this change, and is cleared (with the hash backfilled) the first
    # time such a device authenticates, or by the hardening migration.
    # Never write a fresh token into ``adms_path_token``.
    adms_path_token = db.Column(db.String(64), nullable=True, unique=True)
    adms_token_hash = db.Column(db.String(64), nullable=True, unique=True, index=True)
    adms_token_hash_prev = db.Column(db.String(64), nullable=True)
    adms_token_grace_until = db.Column(db.DateTime(timezone=True), nullable=True)
    adms_token_version = db.Column(db.Integer, nullable=False, default=1)
    # Serial-fallback gate (C1): when False (the default for NEW
    # integrations), a bare-serial request is indistinguishable-OK and
    # changes nothing. When True (legacy existing integrations, backfilled
    # by the hardening migration), serial requests keep working but are
    # warning-logged and never clear error state (M10). The owner flips
    # this off once the terminal is re-provisioned onto the token path.
    allow_serial_fallback = db.Column(db.Boolean, nullable=False, default=False)
    device_name = db.Column(db.String(160), nullable=True)
    pairing_code_hash = db.Column(db.String(64), nullable=True, unique=True, index=True)
    pairing_code_salt = db.Column(db.String(32), nullable=True)
    pairing_code_expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_success_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_error = db.Column(db.String(500), nullable=True)
    records_synced = db.Column(db.Integer, nullable=False, default=0)
    unmapped_records = db.Column(db.Integer, nullable=False, default=0)
    commissioning_status = db.Column(
        db.String(32), nullable=False, default="not_started", index=True
    )  # not_started, attendance_verified, physical_test_passed
    commands_enabled = db.Column(db.Boolean, nullable=False, default=False)

    @classmethod
    def issue_pairing_code(cls, gym_id: int) -> tuple["RRRIntegration", str]:
        integration = cls.query.filter_by(gym_id=gym_id, connector_type="ebioserver").first()
        if integration is None:
            integration = cls(
                gym_id=gym_id,
                connector_type="ebioserver",
                display_name="eSSL eBioServer",
            )
            db.session.add(integration)
        # Salted from here on (M9): legacy unsalted codes keep verifying
        # via verify_pairing_code() until they expire or are burned.
        code, salt, digest = issue_salted_pairing_code()
        integration.pairing_code_hash = digest
        integration.pairing_code_salt = salt
        integration.pairing_code_expires_at = utcnow() + timedelta(minutes=10)
        integration.status = "pairing"
        integration.last_error = None
        return integration, code

    @staticmethod
    def hash_pairing_code(code: str) -> str:
        """Legacy unsalted pairing-code hash — kept for verifying old codes
        and for callers that still compare against stored legacy hashes.
        New codes must use :func:`issue_salted_pairing_code`."""
        return hashlib.sha256(code.encode("utf-8")).hexdigest()

    def verify_pairing_code(self, code: str) -> bool:
        return verify_pairing_code(code, self.pairing_code_hash, self.pairing_code_salt)

    def issue_adms_token(self) -> str:
        """Issue a fresh ADMS path token, storing only its hash.

        Returns the plaintext token (shown to the owner exactly once).
        Any previous token is revoked immediately — use
        :meth:`rotate_adms_token` when the old token needs a grace window.
        A first-ever token is version 1; re-issuing over an existing
        token bumps the version.
        """
        had_token = bool(self.adms_token_hash or self.adms_path_token)
        token, digest = new_adms_token()
        self.adms_token_hash = digest
        self.adms_token_hash_prev = None
        self.adms_token_grace_until = None
        self.adms_path_token = None
        self.adms_token_version = (self.adms_token_version or 0) + 1 if had_token else 1
        return token

    def rotate_adms_token(self, grace_days: int = 7) -> str:
        """Rotate the ADMS path token (H7), keeping the old token valid
        during a grace window so a terminal can be re-provisioned without
        a flag day. ``grace_days=0`` revokes the old token immediately.
        Returns the new plaintext token (shown to the owner exactly once).
        """
        current = self.adms_token_hash
        if current is None and self.adms_path_token:
            current = hash_adms_token(self.adms_path_token)
        token, digest = new_adms_token()
        if current and grace_days and grace_days > 0:
            self.adms_token_hash_prev = current
            self.adms_token_grace_until = utcnow() + timedelta(days=grace_days)
        else:
            self.adms_token_hash_prev = None
            self.adms_token_grace_until = None
        self.adms_token_hash = digest
        self.adms_path_token = None
        self.adms_token_version = (self.adms_token_version or 0) + 1
        return token

    def adms_token_matches(self, token: str) -> str | None:
        """Return ``"token"`` / ``"token_prev"`` if ``token`` is the current
        or in-grace previous token, else ``None``. Never accepts a token
        whose grace window has expired."""
        if not token:
            return None
        digest = hash_adms_token(token)
        if self.adms_token_hash and hmac.compare_digest(self.adms_token_hash, digest):
            return "token"
        if (
            self.adms_token_hash_prev
            and self.adms_token_grace_until is not None
            and utcnow() <= _as_utc(self.adms_token_grace_until)
            and hmac.compare_digest(self.adms_token_hash_prev, digest)
        ):
            return "token_prev"
        return None


class RRRDevice(TenantMixin, TimestampMixin, db.Model):
    """Sanitized device inventory reported by a paired gym-PC connector."""
    __tablename__ = "rrr_devices"
    __table_args__ = (UniqueConstraint("gym_id", "serial_number", name="uq_rrr_device_serial"),)

    id = db.Column(db.Integer, primary_key=True)
    integration_id = db.Column(db.Integer, db.ForeignKey("rrr_integrations.id", ondelete="CASCADE"), nullable=False, index=True)
    serial_number = db.Column(db.String(120), nullable=False)
    device_name = db.Column(db.String(160), nullable=False, default="eSSL device")
    status = db.Column(db.String(32), nullable=True)
    last_seen_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    is_selected = db.Column(db.Boolean, nullable=False, default=False)
    integration = db.relationship("RRRIntegration")


class RRRAdmsCommand(TenantMixin, TimestampMixin, db.Model):
    """One auditable command issued to a direct ADMS terminal.

    The command body is generated server-side from a narrowly scoped action.
    ``probe_info``/``block_test``/``unblock_test`` are the owner-driven
    commissioning tests; ``block``/``unblock`` are the automatic membership
    commands queued by ``queue_adms_membership_command`` once the owner
    finishes supervised commissioning.  It is deliberately not an arbitrary
    raw-command console.

    ``operlog_snapshot`` rows are NOT servable commands: they are created
    with ``status='acked'`` and hold the accumulated OPERLOG enrollment
    snapshot in ``result_data`` (see ``upsert_terminal_snapshot``).
    ``getrequest`` only serves ``queued``/``delivered`` rows, so a snapshot
    row can never be served to a terminal or pass through the fail-safe
    disable guard — it is inert storage that reuses this table's
    integration/result_data shape rather than a second snapshot store.
    """
    __tablename__ = "rrr_adms_commands"
    __table_args__ = (
        CheckConstraint(
            "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock', "
            "'create_user', 'delete_user', 'unlock_door', 'clear_log', 'reboot', 'check', "
            "'sync_users', 'restore_template', 'delete_biodata_test', 'delete_fingertmp_test', "
            "'operlog_snapshot')",
            name="ck_rrr_adms_command_action",
        ),
        CheckConstraint(
            "status IN ('queued', 'delivered', 'acked', 'failed')",
            name="ck_rrr_adms_command_status",
        ),
        Index("ix_rrr_adms_command_device_status", "integration_id", "status", "id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    integration_id = db.Column(
        db.Integer, db.ForeignKey("rrr_integrations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action = db.Column(db.String(24), nullable=False)
    status = db.Column(db.String(16), nullable=False, default="queued", index=True)
    test_enroll_number = db.Column(db.String(32), nullable=True)
    command_text = db.Column(db.Text, nullable=False)
    delivered_at = db.Column(db.DateTime(timezone=True), nullable=True)
    acknowledged_at = db.Column(db.DateTime(timezone=True), nullable=True)
    result_code = db.Column(db.String(32), nullable=True)
    result_message = db.Column(db.String(500), nullable=True)
    # JSON snapshot of the terminal's USERINFO table (sync_users action).
    # Powers smart enroll matching on the PC-less ADMS path.
    result_data = db.Column(db.Text, nullable=True)
    requested_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    integration = db.relationship("RRRIntegration")


class RRRIdentityMapping(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "rrr_identity_mappings"
    __table_args__ = (
        UniqueConstraint("gym_id", "external_id", name="uq_rrr_mapping_external"),
        UniqueConstraint("gym_id", "member_id", "source", name="uq_rrr_mapping_member_source"),
    )

    id = db.Column(db.Integer, primary_key=True)
    member_id = db.Column(db.Integer, db.ForeignKey("members.id", ondelete="CASCADE"), nullable=True, index=True)
    external_id = db.Column(db.String(120), nullable=False)
    source = db.Column(db.String(32), nullable=False, default="ebioserver")
    status = db.Column(db.String(32), nullable=False, default="confirmed")
    confirmed_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    member = db.relationship("Member")


class RRRAttendanceEvent(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "rrr_attendance_events"
    __table_args__ = (
        UniqueConstraint("gym_id", "dedupe_key", name="uq_rrr_attendance_dedupe"),
        Index("ix_rrr_attendance_member_time", "gym_id", "member_id", "punch_time"),
        Index("ix_rrr_attendance_unmapped", "gym_id", "member_id", "processing_status"),
    )

    id = db.Column(db.Integer, primary_key=True)
    integration_id = db.Column(db.Integer, db.ForeignKey("rrr_integrations.id", ondelete="SET NULL"), nullable=True)
    member_id = db.Column(db.Integer, db.ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True)
    source = db.Column(db.String(32), nullable=False)
    device_serial = db.Column(db.String(120), nullable=True)
    external_event_id = db.Column(db.String(160), nullable=True)
    biometric_user_id = db.Column(db.String(120), nullable=False)
    punch_time = db.Column(db.DateTime(timezone=True), nullable=False, index=True)
    received_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    direction = db.Column(db.String(16), nullable=True)
    verify_method = db.Column(db.String(32), nullable=True)
    dedupe_key = db.Column(db.String(64), nullable=False)
    processing_status = db.Column(db.String(32), nullable=False, default="processed")
    raw_payload_hash = db.Column(db.String(64), nullable=True)
    # Provenance for the commissioning gate (H1): "token" / "token_prev"
    # for a token-authenticated ADMS push, "serial" for a legacy
    # serial-fallback push, None for non-ADMS sources and for punches
    # recorded before this column existed. Only token-proven punches
    # satisfy commissioning for integrations with serial fallback off.
    auth_method = db.Column(db.String(16), nullable=True)
    member = db.relationship("Member")
    integration = db.relationship("RRRIntegration")


class RRRRule(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "rrr_rules"
    __table_args__ = (UniqueConstraint("gym_id", "rule_key", name="uq_rrr_rule_key"),)

    id = db.Column(db.Integer, primary_key=True)
    rule_key = db.Column(db.String(64), nullable=False)
    value = db.Column(db.Integer, nullable=False)
    is_enabled = db.Column(db.Boolean, nullable=False, default=True)


class RRROpportunity(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "rrr_opportunities"
    __table_args__ = (
        UniqueConstraint("gym_id", "dedupe_key", name="uq_rrr_opportunity_dedupe"),
        Index("ix_rrr_opportunity_pillar_status", "gym_id", "pillar", "status"),
        CheckConstraint("pillar IN ('revenue', 'retain', 'recover')", name="ck_rrr_opportunity_pillar"),
    )

    id = db.Column(db.Integer, primary_key=True)
    member_id = db.Column(db.Integer, db.ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True)
    pillar = db.Column(db.String(16), nullable=False)
    reason_code = db.Column(db.String(64), nullable=False)
    reason_text = db.Column(db.Text, nullable=False)
    priority = db.Column(db.String(16), nullable=False, default="medium")
    potential_revenue = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0"))
    outcome_revenue = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0"))
    status = db.Column(db.String(24), nullable=False, default="open", index=True)
    dedupe_key = db.Column(db.String(160), nullable=False)
    actioned_at = db.Column(db.DateTime(timezone=True), nullable=True)
    closed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    member = db.relationship("Member")


class RRRAutomationRun(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "rrr_automation_runs"
    __table_args__ = (UniqueConstraint("gym_id", "rule_key", "member_id", "period_key", name="uq_rrr_automation_period"),)

    id = db.Column(db.Integer, primary_key=True)
    member_id = db.Column(db.Integer, db.ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    opportunity_id = db.Column(db.Integer, db.ForeignKey("rrr_opportunities.id", ondelete="SET NULL"), nullable=True)
    rule_key = db.Column(db.String(64), nullable=False)
    period_key = db.Column(db.String(32), nullable=False)
    status = db.Column(db.String(32), nullable=False, default="queued")
    provider_message_id = db.Column(db.String(255), nullable=True)


class RRRBiometricTemplate(TenantMixin, TimestampMixin, db.Model):
    """Backed-up fingerprint template from a terminal.

    Captured during sync_users uploads. Used to restore a member's
    fingerprint after a DELETE-based block, avoiding physical re-enrollment.
    """
    __tablename__ = "rrr_biometric_templates"
    __table_args__ = (
        UniqueConstraint("gym_id", "integration_id", "enroll_number", "finger_id",
                         name="uq_biometric_template"),
        Index("ix_biometric_template_lookup", "gym_id", "integration_id", "enroll_number"),
    )

    id = db.Column(db.Integer, primary_key=True)
    integration_id = db.Column(
        db.Integer, db.ForeignKey("rrr_integrations.id", ondelete="CASCADE"), nullable=False
    )
    enroll_number = db.Column(db.String(32), nullable=False)
    finger_id = db.Column(db.Integer, nullable=False, default=0)
    template_data = db.Column(db.Text, nullable=False)
    template_format = db.Column(db.String(32), nullable=False, default="unknown")
