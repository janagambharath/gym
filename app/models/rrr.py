"""RRR domain models.

These tables deliberately sit beside the existing operational gym records.  They
do not replace members, payments or the bridge outbox; they make every recovery
recommendation and connector outcome traceable to those real records.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import CheckConstraint, Index, UniqueConstraint

from app.extensions import db
from app.models.mixins import TenantMixin, TimestampMixin, utcnow


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
    adms_path_token = db.Column(db.String(64), nullable=True, unique=True)
    device_name = db.Column(db.String(160), nullable=True)
    pairing_code_hash = db.Column(db.String(64), nullable=True, unique=True, index=True)
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
        code = "".join(str(secrets.randbelow(10)) for _ in range(6))
        integration.pairing_code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
        integration.pairing_code_expires_at = utcnow() + timedelta(minutes=10)
        integration.status = "pairing"
        integration.last_error = None
        return integration, code

    @staticmethod
    def hash_pairing_code(code: str) -> str:
        return hashlib.sha256(code.encode("utf-8")).hexdigest()


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
    """
    __tablename__ = "rrr_adms_commands"
    __table_args__ = (
        CheckConstraint(
            "action IN ('probe_info', 'block_test', 'unblock_test', 'block', 'unblock')",
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
