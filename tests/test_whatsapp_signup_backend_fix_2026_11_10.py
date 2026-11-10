"""Backend fix tests — WhatsApp embedded signup deep review (2026-11-10).

Covers the backend crew's fixes only: commit-before-provisioning,
try/except JSON errors, connect-waba dedup, 30-min handshake, trial
lockdown message, 409 reasons, partial-failure warnings, W-L2 guard,
route rate limit, background provisioning + retry endpoint.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import date, timedelta

import pytest

from app.extensions import db
from app.models import Gym, User
from app.services.embedded_signup_service import EmbeddedSignupService


def _make_owner(app, slug, email, **gym_kwargs):
    with app.app_context():
        gym = Gym(name=f"Gym {slug}", slug=slug, country="India",
                  currency="INR", phone="+919871112233", **gym_kwargs)
        db.session.add(gym)
        db.session.flush()
        owner = User(gym_id=gym.id, email=email, full_name="WA Owner",
                     role="gym_owner")
        owner.set_password("password123")
        db.session.add(owner)
        db.session.commit()
        return gym.id, owner.id


def _login(client, email):
    resp = client.post("/api/mobile/v1/auth/login",
                       json={"email": email, "password": "password123"})
    assert resp.status_code == 200, resp.get_json()
    return {"Authorization": f"Bearer {resp.get_json()['data']['access_token']}"}


def _mock_meta_success(monkeypatch):
    monkeypatch.setattr(
        EmbeddedSignupService, "_exchange_code",
        lambda self, code, result: "bisu-token-123")
    monkeypatch.setattr(
        EmbeddedSignupService, "_discover_waba",
        lambda self, token, result: "waba_12345")
    monkeypatch.setattr(
        EmbeddedSignupService, "_fetch_phone_numbers",
        lambda self, waba_id, token, result: ("phone_9988", "+919871112233"))
    monkeypatch.setattr(
        EmbeddedSignupService, "_register_phone",
        lambda self, phone_id, token, result: (True, "ok"))
    monkeypatch.setattr(
        EmbeddedSignupService, "_subscribe_app",
        lambda self, waba_id, token, result: (True, "ok"))


def _no_provision_thread(monkeypatch):
    calls = []
    monkeypatch.setattr(
        "app.services.template_provisioning_service.schedule_template_provisioning",
        lambda app, gym_id, waba_id="", phone_number_id="": calls.append(
            (gym_id, waba_id, phone_number_id)) or True)
    return calls


# ── W-C1 / W-H5: commit first, provision in background ───────────────

def test_flow1_commits_connect_and_schedules_provisioning(client, app, monkeypatch):
    gym_id, _ = _make_owner(app, "w-flow1", "w-flow1@example.com")
    headers = _login(client, "w-flow1@example.com")
    _mock_meta_success(monkeypatch)
    scheduled = _no_provision_thread(monkeypatch)

    resp = client.post("/api/mobile/v1/whatsapp/connect-waba",
                       json={"code": "meta-code-1"}, headers=headers)
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()["data"]
    assert data["status"] == "CONNECTED"
    assert data["templates_provisioned"] is False
    assert data["provisioning"] == "pending"
    assert data["warnings"] == []
    # The gym row is CONNECTED even though provisioning never ran.
    with app.app_context():
        gym = db.session.get(Gym, gym_id)
        assert gym.whatsapp_connection_status == "CONNECTED"
        assert gym.whatsapp_business_account_id == "waba_12345"
        assert gym.phone_number_id == "phone_9988"
        assert gym.whatsapp_templates_provisioned is False
    assert scheduled == [(gym_id, "waba_12345", "phone_9988")]


# ── W-M4: 409 says WHY ────────────────────────────────────────────────

def test_flow1_code_exchange_failure_409_with_reason(client, app, monkeypatch):
    gym_id, _ = _make_owner(app, "w-codefail", "w-codefail@example.com")
    headers = _login(client, "w-codefail@example.com")
    monkeypatch.setattr(
        EmbeddedSignupService, "_exchange_code",
        lambda self, code, result: "")
    calls = []
    monkeypatch.setattr(
        EmbeddedSignupService, "_discover_waba",
        lambda self, token, result: calls.append("discover") or "")
    _no_provision_thread(monkeypatch)

    resp = client.post("/api/mobile/v1/whatsapp/connect-waba",
                       json={"code": "stale-code"}, headers=headers)
    assert resp.status_code == 409, resp.get_json()
    body = resp.get_json()
    assert body["error"]["code"] == "EMBEDDED_SIGNUP_FAILED"
    assert body["error"]["details"]["reason"] == "code_exchange_failed"
    assert "expired" in body["error"]["message"]
    # Fail-fast: no fall-through to the global-token discovery path.
    assert calls == []
    with app.app_context():
        gym = db.session.get(Gym, gym_id)
        assert gym.whatsapp_connection_status == "NOT_CONNECTED"


# ── W-H4: unexpected raise → JSON 500, no half-save ───────────────────

def test_flow1_unexpected_raise_is_json_500(client, app, monkeypatch):
    gym_id, _ = _make_owner(app, "w-raise", "w-raise@example.com")
    headers = _login(client, "w-raise@example.com")

    def _boom(self, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(EmbeddedSignupService, "process_signup", _boom)
    resp = client.post("/api/mobile/v1/whatsapp/connect-waba",
                       json={"code": "meta-code-1"}, headers=headers)
    assert resp.status_code == 500, resp.get_json()
    assert resp.get_json()["error"]["code"] == "INTERNAL_ERROR"
    with app.app_context():
        gym = db.session.get(Gym, gym_id)
        assert gym.whatsapp_connection_status == "NOT_CONNECTED"
        assert not gym.phone_number_id


# ── W-M1: register failure warns, never silently CONNECTED ────────────

def test_flow1_register_failure_records_warning(client, app, monkeypatch):
    gym_id, _ = _make_owner(app, "w-regfail", "w-regfail@example.com")
    headers = _login(client, "w-regfail@example.com")
    _mock_meta_success(monkeypatch)
    monkeypatch.setattr(
        EmbeddedSignupService, "_register_phone",
        lambda self, phone_id, token, result: (False, "HTTP 400"))
    _no_provision_thread(monkeypatch)

    resp = client.post("/api/mobile/v1/whatsapp/connect-waba",
                       json={"code": "meta-code-1"}, headers=headers)
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["data"]["warnings"], "warning must be returned"
    with app.app_context():
        gym = db.session.get(Gym, gym_id)
        assert gym.whatsapp_connection_status == "CONNECTED"
        assert "Messaging may not work" in (gym.whatsapp_connection_error or "")
    status = client.get("/api/mobile/v1/whatsapp/connection-status",
                        headers=headers)
    data = status.get_json()["data"]
    assert data["status"] == "CONNECTED"
    assert data["warning"], "status endpoint must surface the warning"
    assert data["templates_provisioned"] is False
    # The checklist endpoint must not claim messaging works either.
    checklist = client.get("/api/mobile/v1/whatsapp/status", headers=headers)
    assert checklist.get_json()["data"]["checklist"]["messaging_ready"] is False


# ── W-H6: dedup + Flow 2 must not flip CONNECTED to FAILED ───────────

def test_dedup_same_ids_returns_success_without_meta(client, app, monkeypatch):
    gym_id, _ = _make_owner(
        app, "w-dedup", "w-dedup@example.com",
        whatsapp_enabled=True, whatsapp_connection_status="CONNECTED",
        whatsapp_business_account_id="waba_12345", phone_number_id="phone_9988")
    headers = _login(client, "w-dedup@example.com")

    def _forbidden(self, **kwargs):
        raise AssertionError("Meta chain must not run for a dedup hit")

    monkeypatch.setattr(EmbeddedSignupService, "process_signup", _forbidden)
    from app.services.whatsapp_service import WhatsAppService
    monkeypatch.setattr(
        WhatsAppService, "connect_webhooks",
        lambda self: (_ for _ in ()).throw(AssertionError("must not verify")))
    scheduled = _no_provision_thread(monkeypatch)

    resp = client.post("/api/mobile/v1/whatsapp/connect-waba",
                       json={"waba_id": "waba_12345",
                             "phone_number_id": "phone_9988"}, headers=headers)
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["data"]["status"] == "CONNECTED"
    assert scheduled, "dedup must re-trigger pending provisioning"


def test_flow2_must_not_overwrite_connected_with_failed(client, app, monkeypatch):
    gym_id, _ = _make_owner(
        app, "w-noflip", "w-noflip@example.com",
        whatsapp_enabled=True, whatsapp_connection_status="CONNECTED",
        whatsapp_business_account_id="waba_A", phone_number_id="phone_A",
        business_phone_number="+919871112233")
    headers = _login(client, "w-noflip@example.com")
    from app.services.whatsapp_service import WhatsAppResult, WhatsAppService
    monkeypatch.setattr(
        WhatsAppService, "connect_webhooks",
        lambda self: WhatsAppResult(ok=False, error="Meta rejected the subscription"))

    resp = client.post("/api/mobile/v1/whatsapp/connect-waba",
                       json={"waba_id": "waba_B",
                             "phone_number_id": "phone_B"}, headers=headers)
    assert resp.status_code == 409, resp.get_json()
    assert "existing WhatsApp connection is unchanged" in resp.get_json()["error"]["message"]
    with app.app_context():
        gym = db.session.get(Gym, gym_id)
        assert gym.whatsapp_connection_status == "CONNECTED"
        assert gym.whatsapp_business_account_id == "waba_A"
        assert gym.phone_number_id == "phone_A"
        assert gym.whatsapp_enabled is True


# ── W-H7: 30-min handshake + early page validation ────────────────────

def test_handshake_ttl_is_30_minutes(app):
    from app.mobile_api.token_service import (
        create_handshake_token, decode_handshake_token)
    with app.app_context():
        token = create_handshake_token(1, 1, "whatsapp_embedded_signup")
        payload = decode_handshake_token(token, "whatsapp_embedded_signup")
    assert payload is not None
    assert payload["exp"] - payload["iat"] == 30 * 60


def test_expired_handshake_page_rejected_early(client, app):
    gym_id, owner_id = _make_owner(app, "w-hs", "w-hs@example.com")
    app.config["META_APP_ID"] = "1234567890123456"
    app.config["META_CONFIG_ID"] = "test_meta_config_id"
    with app.app_context():
        from app.mobile_api.token_service import _b64url_encode, _token_secret
        now = int(time.time())
        payload = {"sub": owner_id, "gym_id": gym_id, "typ": "handshake",
                   "purpose": "whatsapp_embedded_signup",
                   "iat": now - 3600, "exp": now - 60}
        header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        body = _b64url_encode(json.dumps(payload).encode())
        sig = hmac.new(_token_secret().encode(), f"{header}.{body}".encode(),
                       hashlib.sha256).digest()
        expired = f"{header}.{body}.{_b64url_encode(sig)}"
    resp = client.get(
        "/api/mobile/v1/whatsapp/embedded-signup-page?meta_app_id=1234567890123456"
        f"&config_id=test_meta_config_id&handshake={expired}")
    assert resp.status_code == 401
    assert "expired" in resp.get_data(as_text=True).lower()


# ── W-M2: trial lockdown stays, message is displayable ───────────────

def _expired_trial_gym(app, slug, email):
    return _make_owner(
        app, slug, email,
        subscription_status="trial",
        trial_ends_at=date.today() - timedelta(days=1))


def test_trial_expired_connect_blocked_access_token(client, app, monkeypatch):
    _expired_trial_gym(app, "w-trial1", "w-trial1@example.com")
    headers = _login(client, "w-trial1@example.com")
    from app.services.whatsapp_service import WhatsAppResult, WhatsAppService
    monkeypatch.setattr(
        WhatsAppService, "connect_webhooks",
        lambda self: WhatsAppResult(ok=True))
    resp = client.post("/api/mobile/v1/whatsapp/connect-waba",
                       json={"waba_id": "waba_1",
                             "phone_number_id": "phone_1"}, headers=headers)
    assert resp.status_code == 403, resp.get_json()
    assert resp.get_json()["error"]["code"] == "SUBSCRIPTION_REQUIRED"
    assert resp.get_json()["error"]["message"] == (
        "Your free trial has ended — upgrade to connect WhatsApp.")


def test_trial_expired_connect_blocked_handshake_path(client, app):
    gym_id, owner_id = _expired_trial_gym(app, "w-trial2", "w-trial2@example.com")
    with app.app_context():
        from app.mobile_api.token_service import create_handshake_token
        handshake = create_handshake_token(
            owner_id, gym_id, "whatsapp_embedded_signup")
    resp = client.post("/api/mobile/v1/whatsapp/connect-waba",
                       json={"waba_id": "waba_1", "phone_number_id": "phone_1"},
                       headers={"Authorization": f"Bearer {handshake}"})
    assert resp.status_code == 403, resp.get_json()
    assert resp.get_json()["error"]["code"] == "SUBSCRIPTION_REQUIRED"
    assert "upgrade to connect WhatsApp" in resp.get_json()["error"]["message"]


# ── W-L2: non-JSON Meta body cannot raise out of connect_webhooks ────

def test_connect_webhooks_non_json_body_is_clean_error(app, monkeypatch):
    from app.services.whatsapp_service import WhatsAppService

    class _Resp:
        status_code = 200

        def __init__(self, body):
            self._body = body

        def json(self):
            if self._body is None:
                raise ValueError("No JSON object could be decoded")
            return self._body

    with app.app_context():
        gym = Gym(name="WL2 Gym", slug="w-l2", country="India", currency="INR",
                  whatsapp_business_account_id="waba_1", phone_number_id="phone_1")
        db.session.add(gym)
        db.session.commit()
        app.config["PUBLIC_BASE_URL"] = "https://example.invalid"
        app.config["WHATSAPP_VERIFY_TOKEN"] = "verify-me"
        app.config["WHATSAPP_ACCESS_TOKEN"] = "global-token"
        svc = WhatsAppService(gym)
        import app.services.whatsapp_service as ws_mod
        monkeypatch.setattr(
            ws_mod._SESSION, "get", lambda *a, **k: _Resp(None))
        result = svc.connect_webhooks()
        assert result.ok is False
        assert "unreadable" in (result.error or "")

        monkeypatch.setattr(
            ws_mod._SESSION, "get",
            lambda *a, **k: _Resp({"data": [{"id": "phone_1"}]}))
        monkeypatch.setattr(
            ws_mod._SESSION, "post", lambda *a, **k: _Resp(None))
        result = svc.connect_webhooks()
        assert result.ok is False
        assert "unreadable" in (result.error or "")


# ── W-C1: background provisioning worker + retry endpoint ─────────────

def test_provision_worker_success_and_failure(app, monkeypatch):
    from app.services import template_provisioning_service as tps
    with app.app_context():
        gym = Gym(name="Prov Gym", slug="w-prov", country="India",
                  currency="INR", whatsapp_enabled=True,
                  whatsapp_connection_status="CONNECTED",
                  whatsapp_business_account_id="waba_1",
                  phone_number_id="phone_1")
        gym.set_whatsapp_token("bisu-token")
        db.session.add(gym)
        db.session.commit()
        gym_id = gym.id
        monkeypatch.setattr(
            tps, "provision_templates",
            lambda **k: {"renewal_reminder": "exists", "gym_announcement": "created (id=9)"})
        assert tps.provision_templates_for_gym(app, gym_id, retry_delay_s=0) is True
        # The worker commits in its own session; expire this test
        # session's identity map before re-reading (same staleness
        # rule as any cross-session read — prod requests are unaffected,
        # each gets its own session).
        db.session.expire_all()
        gym = db.session.get(Gym, gym_id)
        assert gym.whatsapp_templates_provisioned is True
        assert gym.whatsapp_connection_error is None

        gym.whatsapp_templates_provisioned = False
        db.session.commit()
        monkeypatch.setattr(
            tps, "provision_templates",
            lambda **k: {"renewal_reminder": "failed: HTTP 400 Bad Request"})
        assert tps.provision_templates_for_gym(
            app, gym_id, max_attempts=1, retry_delay_s=0) is False
        db.session.expire_all()
        gym = db.session.get(Gym, gym_id)
        assert gym.whatsapp_templates_provisioned is False
        assert "Templates not provisioned" in (gym.whatsapp_connection_error or "")


def test_retry_templates_endpoint(client, app, monkeypatch):
    gym_id, _ = _make_owner(
        app, "w-retry", "w-retry@example.com",
        whatsapp_enabled=True, whatsapp_connection_status="CONNECTED",
        whatsapp_business_account_id="waba_1", phone_number_id="phone_1")
    headers = _login(client, "w-retry@example.com")
    scheduled = _no_provision_thread(monkeypatch)
    resp = client.post("/api/mobile/v1/whatsapp/retry-templates", headers=headers)
    assert resp.status_code == 202, resp.get_json()
    assert resp.get_json()["data"]["status"] == "PROVISIONING"
    assert scheduled == [(gym_id, "waba_1", "phone_1")]
    with app.app_context():
        gym = db.session.get(Gym, gym_id)
        gym.whatsapp_templates_provisioned = True
        db.session.commit()
    # Expire the test thread's shared session so the next request
    # re-reads the committed row instead of its identity map.
    db.session.expire_all()
    resp = client.post("/api/mobile/v1/whatsapp/retry-templates", headers=headers)
    assert resp.status_code == 200
    assert resp.get_json()["data"]["provisioning"] == "done"


def test_retry_templates_requires_connected(client, app):
    _make_owner(app, "w-retry2", "w-retry2@example.com")
    headers = _login(client, "w-retry2@example.com")
    resp = client.post("/api/mobile/v1/whatsapp/retry-templates", headers=headers)
    assert resp.status_code == 409


# ── W-L9 / W-M5: route-level rate limit ───────────────────────────────

def test_connect_waba_rate_limited(client, app, monkeypatch):
    _make_owner(
        app, "w-rate", "w-rate@example.com",
        whatsapp_enabled=True, whatsapp_connection_status="CONNECTED",
        whatsapp_business_account_id="waba_1", phone_number_id="phone_1")
    headers = _login(client, "w-rate@example.com")
    _no_provision_thread(monkeypatch)
    statuses = []
    for _ in range(6):
        resp = client.post("/api/mobile/v1/whatsapp/connect-waba",
                           json={"waba_id": "waba_1",
                                 "phone_number_id": "phone_1"}, headers=headers)
        statuses.append(resp.status_code)
    assert statuses[:5] == [200] * 5, statuses
    assert statuses[5] == 429, statuses
