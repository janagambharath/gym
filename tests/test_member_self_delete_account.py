"""Tests for member self-service account deletion.

DELETE /api/member/v1/auth/account (GAP 8) — a member deletes ONLY their
own record: the member id comes from the Bearer <redacted> token, never from
the request body or URL, so one member can never delete another's account.
The endpoint mirrors the owner-side soft-delete (deactivate_member):
soft-delete + status "deleted", refresh-token families revoked, audit log
written. No schema change, so no migration.
"""
from datetime import date, timedelta

import pytest

from app.extensions import db
from app.models import AuditLog, Member
from app.models.mobile_token import MemberRefreshToken
from app.mobile_api.token_service import (
    create_access_token,
    create_member_refresh_token,
)


def _member_headers(member):
    token = create_access_token(user_id=member.id, gym_id=member.gym_id, role="member")
    return {"Authorization": f"Bearer {token}"}


def _second_member(seed_gym):
    gym = seed_gym["gym"]
    plan = seed_gym["plan"]
    member = Member(
        gym_id=gym.id,
        plan_id=plan.id,
        full_name="Jane Roe",
        phone="+919998887777",
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=30),
        status="active",
    )
    db.session.add(member)
    db.session.commit()
    return member


def test_delete_account_requires_auth(client, seed_member):
    res = client.delete("/api/member/v1/auth/account")
    assert res.status_code == 401
    assert res.json["success"] is False


def test_delete_account_rejects_invalid_token(client, seed_member):
    res = client.delete(
        "/api/member/v1/auth/account",
        headers={"Authorization": "Bearer <redacted>"},
    )
    assert res.status_code == 401
    assert res.json["success"] is False


def test_delete_account_rejects_owner_token(client, seed_member, seed_gym):
    """An owner JWT (role != member) must not reach the member endpoint."""
    owner_token = create_access_token(
        user_id=seed_gym["owner"].id, gym_id=seed_gym["gym"].id, role="gym_owner"
    )
    res = client.delete(
        "/api/member/v1/auth/account",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert res.status_code == 401
    assert res.json["success"] is False


def test_member_deletes_own_account(client, seed_member):
    member = seed_member
    # Seed a refresh-token family: deletion must revoke it.
    create_member_refresh_token(member.id, member.gym_id)
    db.session.commit()
    assert MemberRefreshToken.query.filter_by(member_id=member.id).count() == 1

    res = client.delete("/api/member/v1/auth/account", headers=_member_headers(member))
    assert res.status_code == 200
    assert res.json["success"] is True

    db.session.expire_all()
    deleted = db.session.get(Member, member.id)
    assert deleted.deleted_at is not None
    assert deleted.status == "deleted"

    # Refresh tokens revoked — the session cannot be refreshed afterwards.
    assert MemberRefreshToken.query.filter_by(member_id=member.id).count() == 0

    # Audit-logged as a self-service member action (actor None, member in metadata).
    entry = AuditLog.query.filter_by(action="member_self_delete_account").first()
    assert entry is not None
    assert entry.resource_type == "member"
    assert str(entry.resource_id) == str(member.id)
    assert entry.gym_id == member.gym_id
    assert entry.metadata_json["member_id"] == member.id
    assert entry.metadata_json["previous_status"] == "active"
    assert entry.metadata_json["self_service"] is True

    # The deleted member's token is dead immediately.
    res = client.get("/api/member/v1/dashboard", headers=_member_headers(member))
    assert res.status_code == 401


def test_delete_account_only_deletes_requesting_member(client, seed_member, seed_gym):
    """Deleting member A must leave member B fully usable."""
    member_a = seed_member
    member_b = _second_member(seed_gym)

    res = client.delete(
        "/api/member/v1/auth/account", headers=_member_headers(member_a)
    )
    assert res.status_code == 200

    db.session.expire_all()
    assert db.session.get(Member, member_a.id).deleted_at is not None
    assert db.session.get(Member, member_b.id).deleted_at is None

    res = client.get("/api/member/v1/dashboard", headers=_member_headers(member_b))
    assert res.status_code == 200
    assert res.json["data"]["member"]["id"] == member_b.id


def test_delete_account_second_call_rejected(client, seed_member):
    """A double-submit after a successful delete 401s (decorator rejects
    soft-deleted members) and does not touch the already-deleted row."""
    member = seed_member
    res = client.delete("/api/member/v1/auth/account", headers=_member_headers(member))
    assert res.status_code == 200

    res = client.delete("/api/member/v1/auth/account", headers=_member_headers(member))
    assert res.status_code == 401

    db.session.expire_all()
    deleted = db.session.get(Member, member.id)
    assert deleted.deleted_at is not None
    assert deleted.status == "deleted"
    # Exactly one audit entry — the retry did not re-delete.
    assert (
        AuditLog.query.filter_by(action="member_self_delete_account").count() == 1
    )
