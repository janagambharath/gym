"""WhatsApp Embedded Signup / connect-waba — tests for the FIXED behaviour.

Covers review gaps T1-T7 from
``~/workspace/goals/renewal-desk-gym-security-review-adms-parity-build-and-ui-ux-overhaul/hidden_files/whatsapp-signup-review-2026-11-10.md``
(review section 6 / tests-worker section 5), adapted to the mechanism
the backend + page crews actually implemented (working tree 2026-11-10):

* Backend (embedded_signup_service.py): 8s per-call Graph timeout;
  code-exchange failure fails fast with ``failure_reason``; register /
  subscribe failures are recorded as warnings (W-M1) instead of
  silently marking CONNECTED; provisioning is NOT run in-request any
  more — ``process_signup`` sets ``provisioning_pending`` and the route
  commits first, then ``schedule_template_provisioning`` spawns a daemon
  thread (template_provisioning_service.py) that retries 3x with 30s
  gaps and records the outcome on the gym row.
* Route (whatsapp.py connect-waba): try/except around process_signup
  AND the audit/commit (JSON 500, no half-save); W-H6 dedup — already
  CONNECTED with the same waba+phone returns success at once, and a
  failed re-POST of the same single-use code returns the stored success
  instead of a 409; 409 carries ``details.reason``; 5/min rate limit;
  POST /whatsapp/retry-templates (202) restarts background provisioning.
* Page route: an expired/invalid handshake is rejected at page-serve
  time (401 "Signup link expired") instead of failing at the final save.
* Page JS: ``postConnectWaba`` (AbortController, CONNECT_TIMEOUT_MS =
  60000, typed errors), ``failSignup`` (visible error + re-enabled
  Connect + retry prompt on every failure branch), missing-code else
  branch, ``_exchangeInFlight`` single-owner guard, watchdog backstop.

Scope: backend Flow 1 + background provisioning + page-literal
assertions only. PWA / Android UI tests belong to the page + Android
crews — this file deliberately does NOT add them (no fix-worker state
files from those crews existed when this file was written).

Mocking follows the established patterns (tests-worker section 3):
patch ``app.services.<service>.requests.get/post`` per URL (same style
as ``@patch("app.services.ai_provider.requests.post")``),
``monkeypatch.setattr`` on service methods, Flask test client +
seed-style gym/owner fixtures. No new dependencies.

NOTE on the background thread: tests that exercise the real
``schedule_template_provisioning`` thread patch the *template* Graph
calls (``app.services.template_provisioning_service.requests``) and
poll the gym row. Tests that only need the connect response patch
``schedule_template_provisioning`` itself with a recording stub so no
thread (and no real Graph call) escapes the test.
"""
from __future__ import annotations

import re
import time

import pytest
import requests

from app.extensions import db
from app.models import Gym, User

TEMPLATE_NAMES = (
    "renewal_reminder", "membership_renewal_reminder",
    "gym_announcement", "gym_announcement_01",
    "expired_member_reactivation_01", "gym_special_offer_01",
    "renewal_desk_test_01", "vynla_otp",
)


# ── helpers ─────────────────────────────────────────────────────────────

class _GraphResp:
    """Minimal stand-in for a requests.Response from Meta Graph."""

    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text or str(payload or "")

    def json(self):
        return self._payload


def _make_owner(client, app, slug, email):
    """Create a gym + gym_owner and return (gym_id, auth headers)."""
    with app.app_context():
        gym = Gym(
            name=f"WA Signup {slug}",
            slug=slug,
            country="India",
            currency="INR",
            phone="+919871112233",
            whatsapp_enabled=False,
        )
        db.session.add(gym)
        db.session.flush()
        owner = User(
            gym_id=gym.id,
            email=email,
            full_name="WA Owner",
            role="gym_owner",
        )
        owner.set_password("password123")
        db.session.add(owner)
        db.session.commit()
        gym_id = gym.id
    login = client.post(
        "/api/mobile/v1/auth/login",
        json={"email": email, "password": "password123"},
    )
    assert login.status_code == 200, login.get_json()
    token = login.get_json()["data"]["access_token"]
    return gym_id, {"Authorization": f"Bearer {token}"}


def _make_connected_gym(client, app, slug, email, templates_provisioned=False):
    """A gym already in the post-connect state (as if Flow 1 committed)."""
    gym_id, headers = _make_owner(client, app, slug, email)
    with app.app_context():
        gym = db.session.get(Gym, gym_id)
        gym.whatsapp_business_account_id = "waba_12345"
        gym.phone_number_id = "phone_id_9988"
        gym.business_phone_number = "+91 98765 43210"
        gym.whatsapp_meta_business_id = "biz_001"
        gym.set_whatsapp_token("gym_bisu_token_xyz")
        gym.whatsapp_enabled = True
        gym.whatsapp_connection_status = "CONNECTED"
        gym.whatsapp_connection_error = None
        gym.whatsapp_templates_provisioned = templates_provisioned
        db.session.commit()
    return gym_id, headers


def _meta_config(app):
    app.config["META_APP_ID"] = "1234567890123456"
    app.config["META_CONFIG_ID"] = "test_meta_config_id"
    app.config["WHATSAPP_APP_SECRET"] = "test_app_secret"
    app.config["WHATSAPP_ACCESS_TOKEN"] = ""  # force the per-gym token path


def _graph_dispatch(exchange_status=200, exchange_payload=None):
    """Per-URL fake for the embedded-signup Graph chain.

    exchange_status/exchange_payload control ONLY the oauth/access_token
    call; every other leg succeeds.
    """
    def _get(url, *args, **kwargs):
        if "oauth/access_token" in url:
            if exchange_status == 200:
                return _GraphResp(200, exchange_payload or {"access_token": "gym_bisu_token_xyz"})
            return _GraphResp(exchange_status, {"error": {"message": "Invalid code"}}, text="Invalid code")
        if "debug_token" in url:
            return _GraphResp(200, {
                "data": {
                    "profile_id": "biz_001",
                    "granular_scopes": [
                        {"scope": "whatsapp_business_management", "target_ids": ["waba_12345"]},
                    ],
                }
            })
        if url.rstrip("/").endswith("/waba_12345/phone_numbers"):
            return _GraphResp(200, {"data": [{
                "id": "phone_id_9988",
                "display_phone_number": "+91 98765 43210",
                "verified_name": "WA Signup Gym",
            }]})
        return _GraphResp(404, {}, text="not found")

    def _post(url, *args, **kwargs):
        if url.rstrip("/").endswith("/phone_id_9988/register"):
            return _GraphResp(200, {"success": True})
        if url.rstrip("/").endswith("/waba_12345/subscribed_apps"):
            return _GraphResp(200, {"success": True})
        return _GraphResp(404, {}, text="not found")

    return _get, _post


def _patch_graph(monkeypatch, exchange_status=200, exchange_payload=None):
    """Install the per-URL Graph fake on the embedded-signup service."""
    import app.services.embedded_signup_service as svc

    get_fn, post_fn = _graph_dispatch(exchange_status, exchange_payload)
    monkeypatch.setattr(svc.requests, "get", get_fn)
    monkeypatch.setattr(svc.requests, "post", post_fn)
    return svc


def _patch_schedule_stub(monkeypatch):
    """Replace the background-provisioning spawn with a recording stub.

    Returns the list of gym_ids it was asked to provision for. No real
    thread (and no real Graph call) escapes a test that uses this.
    """
    import app.services.template_provisioning_service as tps

    calls: list[int] = []

    def _stub(app_obj, gym_id, *args, **kwargs):
        calls.append(gym_id)
        return True

    monkeypatch.setattr(tps, "schedule_template_provisioning", _stub)
    return calls


def _patch_template_graph(monkeypatch, existing_names=(), create_status=200):
    """Fake the template-provisioning Graph calls (list + creates)."""
    import app.services.template_provisioning_service as tps

    def _get(url, *args, **kwargs):
        if "message_templates" in url:
            return _GraphResp(200, {"data": [{"name": n} for n in existing_names]})
        return _GraphResp(404, {}, text="not found")

    def _post(url, *args, **kwargs):
        if "message_templates" in url:
            if create_status == 200:
                return _GraphResp(200, {"id": "tpl_123"})
            return _GraphResp(400, {"error": {"message": "rejected"}}, text="rejected")
        return _GraphResp(404, {}, text="not found")

    monkeypatch.setattr(tps.requests, "get", _get)
    monkeypatch.setattr(tps.requests, "post", _post)


def _mint_handshake(app, user_id, gym_id, expired=False):
    """Mint a whatsapp_embedded_signup handshake; expired=True backdates
    it 31 minutes at mint time so its 30-minute TTL has already lapsed
    (backend crew extended the TTL 10 -> 30 min, review section 6.5)."""
    import app.mobile_api.token_service as ts

    if not expired:
        with app.app_context():
            return ts.create_handshake_token(user_id, gym_id, "whatsapp_embedded_signup")

    class _FrozenTime:
        @staticmethod
        def time():
            return int(time.time()) - 31 * 60

    original_time = ts.time
    ts.time = _FrozenTime
    try:
        with app.app_context():
            return ts.create_handshake_token(user_id, gym_id, "whatsapp_embedded_signup")
    finally:
        ts.time = original_time


def _fetch_signup_page(client, app, gym_id, owner_id, expired=False):
    handshake = _mint_handshake(app, owner_id, gym_id, expired=expired)
    return client.get(
        "/api/mobile/v1/whatsapp/embedded-signup-page"
        "?meta_app_id=1234567890123456&config_id=test_meta_config_id"
        f"&handshake={handshake}"
    )


def _gym(app, gym_id):
    with app.app_context():
        return db.session.get(Gym, gym_id)


def _wait_for_templates_flag(app, gym_id, timeout_s=5.0):
    """Poll until the background provisioning thread sets the flag."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if _gym(app, gym_id).whatsapp_templates_provisioned:
            return True
        time.sleep(0.2)
    return _gym(app, gym_id).whatsapp_templates_provisioned


# ── 1. Flow 1 happy path (T1) ───────────────────────────────────────────

def test_flow1_happy_path_code_exchange_connects(client, app, monkeypatch):
    """POST {code} runs the full chain and connects the gym.

    Proves the exact path the incident owner took: code exchange ->
    WABA discovery -> phone fetch -> register -> subscribe -> gym saved
    (encrypted per-gym token) -> COMMIT, with template provisioning
    scheduled in the background (``provisioning: "pending"`` at connect
    time, NOT a templates_provisioned step — provisioning never runs
    in-request any more).
    """
    gym_id, headers = _make_owner(client, app, "wa-flow1-happy", "flow1.happy@example.com")
    _meta_config(app)
    _patch_graph(monkeypatch)
    scheduled = _patch_schedule_stub(monkeypatch)

    resp = client.post(
        "/api/mobile/v1/whatsapp/connect-waba",
        json={"code": "meta_auth_code_abc", "business_id": "biz_001"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()["data"]
    assert data["status"] == "CONNECTED"
    assert data["waba_id"] == "waba_12345"
    assert data["phone_number_id"] == "phone_id_9988"
    assert data["business_phone_number"] == "+91 98765 43210"
    assert data["business_id"] == "biz_001"
    for step in ("code_exchange", "gym_saved"):
        assert step in data["steps_completed"]
    assert "templates_provisioned" not in data["steps_completed"]
    assert data["warnings"] == []
    assert data["templates_provisioned"] is False
    assert data["provisioning"] == "pending"
    assert scheduled == [gym_id]

    gym = _gym(app, gym_id)
    assert gym.whatsapp_connection_status == "CONNECTED"
    assert gym.whatsapp_enabled is True
    assert gym.whatsapp_business_account_id == "waba_12345"
    assert gym.phone_number_id == "phone_id_9988"
    assert gym.business_phone_number == "+91 98765 43210"
    assert gym.whatsapp_meta_business_id == "biz_001"
    assert gym.get_whatsapp_token() == "gym_bisu_token_xyz"
    # Templates are NOT provisioned at connect time — the background
    # thread does that (see the provision_templates_for_gym tests below).
    assert gym.whatsapp_templates_provisioned is False


# ── 2. Code-exchange failure (T1) ───────────────────────────────────────

def test_flow1_code_exchange_400_returns_409_and_stays_not_connected(client, app, monkeypatch):
    """Graph rejecting the code -> clean 409 JSON with a machine-readable
    reason, gym stays NOT_CONNECTED."""
    gym_id, headers = _make_owner(client, app, "wa-flow1-badcode", "flow1.badcode@example.com")
    _meta_config(app)
    _patch_graph(monkeypatch, exchange_status=400)

    resp = client.post(
        "/api/mobile/v1/whatsapp/connect-waba",
        json={"code": "bad-or-reused-code"},
        headers=headers,
    )
    assert resp.status_code == 409, resp.get_json()
    body = resp.get_json()
    assert body["success"] is False
    assert body["error"]["code"] == "EMBEDDED_SIGNUP_FAILED"
    assert body["error"]["details"]["reason"] == "code_exchange_failed"
    assert "expired" in body["error"]["message"].lower() or "already been used" in body["error"]["message"]
    assert "application/json" in resp.headers["Content-Type"]

    gym = _gym(app, gym_id)
    assert gym.whatsapp_connection_status == "NOT_CONNECTED"
    assert gym.whatsapp_enabled is False
    assert gym.get_whatsapp_token() is None


def test_flow1_code_exchange_timeout_returns_409(client, app, monkeypatch):
    """A Timeout on oauth/access_token is a clean 409, not a hang or 500."""
    gym_id, headers = _make_owner(client, app, "wa-flow1-timeout", "flow1.timeout@example.com")
    _meta_config(app)
    import app.services.embedded_signup_service as svc

    def _get_timeout(url, *args, **kwargs):
        if "oauth/access_token" in url:
            raise requests.Timeout("graph timed out")
        return _GraphResp(404, {}, text="not found")

    monkeypatch.setattr(svc.requests, "get", _get_timeout)
    monkeypatch.setattr(svc.requests, "post", lambda *a, **k: _GraphResp(404, {}, text="not found"))

    resp = client.post(
        "/api/mobile/v1/whatsapp/connect-waba",
        json={"code": "meta_auth_code_abc"},
        headers=headers,
    )
    assert resp.status_code == 409, resp.get_json()
    assert resp.get_json()["error"]["code"] == "EMBEDDED_SIGNUP_FAILED"
    assert resp.get_json()["error"]["details"]["reason"] == "code_exchange_failed"

    gym = _gym(app, gym_id)
    assert gym.whatsapp_connection_status == "NOT_CONNECTED"
    assert gym.whatsapp_enabled is False


# ── 3. Unexpected raise -> JSON 500, no half-save (T3) ──────────────────

def test_flow1_unexpected_raise_returns_json_500_and_no_half_save(client, app, monkeypatch):
    """A process_signup raise must surface as JSON INTERNAL_ERROR, and the
    gym row must not be half-mutated (route try/except + rollback).

    PROPAGATE_EXCEPTIONS is False here on purpose: the test client would
    otherwise re-raise instead of exercising the production 500 path for
    any raise that escapes the route handler.
    """
    gym_id, headers = _make_owner(client, app, "wa-flow1-boom", "flow1.boom@example.com")
    _meta_config(app)
    monkeypatch.setitem(app.config, "PROPAGATE_EXCEPTIONS", False)

    from app.services.embedded_signup_service import EmbeddedSignupService

    def _boom(self, **kwargs):
        raise Exception("boom")

    monkeypatch.setattr(EmbeddedSignupService, "process_signup", _boom)

    resp = client.post(
        "/api/mobile/v1/whatsapp/connect-waba",
        json={"code": "meta_auth_code_abc"},
        headers=headers,
    )
    assert resp.status_code == 500, resp.get_data(as_text=True)
    assert "application/json" in resp.headers["Content-Type"]
    body = resp.get_json()
    assert body is not None
    assert body["success"] is False
    assert body["error"]["code"] == "INTERNAL_ERROR"

    gym = _gym(app, gym_id)
    assert gym.whatsapp_connection_status == "NOT_CONNECTED"
    assert gym.whatsapp_enabled is False
    assert gym.whatsapp_business_account_id is None
    assert gym.phone_number_id is None
    assert gym.get_whatsapp_token() is None


# ── 4. Background provisioning (T6, as implemented) ─────────────────────

def test_background_provisioning_all_exist_marks_done(client, app, monkeypatch):
    """Background run with every template already in Meta: returns True,
    flag set, no warning left."""
    gym_id, _headers = _make_connected_gym(client, app, "wa-prov-exists", "prov.exists@example.com")
    _patch_template_graph(monkeypatch, existing_names=TEMPLATE_NAMES)

    from app.services.template_provisioning_service import provision_templates_for_gym

    assert provision_templates_for_gym(app, gym_id, max_attempts=1, retry_delay_s=0) is True
    gym = _gym(app, gym_id)
    assert gym.whatsapp_templates_provisioned is True
    assert gym.whatsapp_connection_status == "CONNECTED"
    assert gym.whatsapp_enabled is True


def test_background_provisioning_all_failed_keeps_connected_flag_false(client, app, monkeypatch):
    """Background run where Meta rejects every template create: returns
    False, the gym STAYS CONNECTED, the flag stays False and the reason
    is stored as a visible warning (never a silent success, W-L10)."""
    gym_id, _headers = _make_connected_gym(client, app, "wa-prov-allfail", "prov.allfail@example.com")
    _patch_template_graph(monkeypatch, existing_names=(), create_status=400)

    from app.services.template_provisioning_service import provision_templates_for_gym

    assert provision_templates_for_gym(app, gym_id, max_attempts=1, retry_delay_s=0) is False
    gym = _gym(app, gym_id)
    assert gym.whatsapp_connection_status == "CONNECTED"
    assert gym.whatsapp_enabled is True
    assert gym.whatsapp_templates_provisioned is False
    assert gym.whatsapp_connection_error is not None
    assert "Templates not provisioned" in gym.whatsapp_connection_error


def test_background_provisioning_raise_keeps_connected_flag_false(client, app, monkeypatch):
    """Background run where provision_templates itself raises: no
    exception escapes, the gym STAYS CONNECTED, flag stays False and a
    retryable warning is stored."""
    gym_id, _headers = _make_connected_gym(client, app, "wa-prov-raise", "prov.raise@example.com")
    import app.services.template_provisioning_service as tps

    def _provision_raises(**kwargs):
        raise RuntimeError("template service down")

    monkeypatch.setattr(tps, "provision_templates", _provision_raises)

    from app.services.template_provisioning_service import provision_templates_for_gym

    assert provision_templates_for_gym(app, gym_id, max_attempts=1, retry_delay_s=0) is False
    gym = _gym(app, gym_id)
    assert gym.whatsapp_connection_status == "CONNECTED"
    assert gym.whatsapp_enabled is True
    assert gym.whatsapp_templates_provisioned is False
    assert gym.whatsapp_connection_error is not None
    assert "Templates not provisioned" in gym.whatsapp_connection_error


def test_background_provisioning_slow_but_completing_still_marks_done(client, app, monkeypatch):
    """A slow (but completing) provisioning run still ends provisioned."""
    gym_id, _headers = _make_connected_gym(client, app, "wa-prov-slow", "prov.slow@example.com")
    import app.services.template_provisioning_service as tps

    def _provision_slow(**kwargs):
        time.sleep(0.2)
        return {name: "exists" for name in TEMPLATE_NAMES}

    monkeypatch.setattr(tps, "provision_templates", _provision_slow)

    from app.services.template_provisioning_service import provision_templates_for_gym

    assert provision_templates_for_gym(app, gym_id, max_attempts=1, retry_delay_s=0) is True
    assert _gym(app, gym_id).whatsapp_templates_provisioned is True


# ── 4b. Retry-templates endpoint ────────────────────────────────────────

def test_retry_templates_not_connected_returns_409(client, app):
    """Retry is only for a CONNECTED gym."""
    _gym_id, headers = _make_owner(client, app, "wa-retry-noconn", "retry.noconn@example.com")
    resp = client.post("/api/mobile/v1/whatsapp/retry-templates", headers=headers)
    assert resp.status_code == 409
    assert resp.get_json()["error"]["code"] == "WHATSAPP_NOT_CONFIGURED"


def test_retry_templates_already_provisioned_returns_done(client, app):
    """A gym whose templates are already provisioned gets 200, no thread."""
    _gym_id, headers = _make_connected_gym(
        client, app, "wa-retry-done", "retry.done@example.com", templates_provisioned=True
    )
    resp = client.post("/api/mobile/v1/whatsapp/retry-templates", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["templates_provisioned"] is True
    assert data["provisioning"] == "done"


def test_retry_templates_pending_runs_background_thread_to_done(client, app, monkeypatch):
    """POST retry-templates -> 202 at once; the spawned background thread
    provisions (mocked Graph) and the flag flips to True shortly after."""
    gym_id, headers = _make_connected_gym(client, app, "wa-retry-pending", "retry.pending@example.com")
    _patch_template_graph(monkeypatch, existing_names=TEMPLATE_NAMES)

    resp = client.post("/api/mobile/v1/whatsapp/retry-templates", headers=headers)
    assert resp.status_code == 202, resp.get_json()
    data = resp.get_json()["data"]
    assert data["templates_provisioned"] is False
    assert data["provisioning"] == "pending"

    assert _wait_for_templates_flag(app, gym_id, timeout_s=5.0), (
        "background provisioning thread did not set the flag"
    )
    gym = _gym(app, gym_id)
    assert gym.whatsapp_connection_status == "CONNECTED"


# ── 5. Slow-chain tolerance (T5) ────────────────────────────────────────

def test_slow_chain_timeouts_do_not_roll_back_saved_connect(client, app, monkeypatch):
    """Timeouts on register / subscribe must not roll back a connect that
    was otherwise complete — the gym stays CONNECTED, and the partial
    failure is recorded as a visible warning (W-M1), not swallowed."""
    gym_id, headers = _make_owner(client, app, "wa-slow-chain", "slow.chain@example.com")
    _meta_config(app)
    import app.services.embedded_signup_service as svc

    get_fn, _ = _graph_dispatch()
    monkeypatch.setattr(svc.requests, "get", get_fn)

    def _post_timeout(url, *args, **kwargs):
        raise requests.Timeout("graph timed out")

    monkeypatch.setattr(svc.requests, "post", _post_timeout)
    scheduled = _patch_schedule_stub(monkeypatch)

    resp = client.post(
        "/api/mobile/v1/whatsapp/connect-waba",
        json={"code": "meta_auth_code_abc", "business_id": "biz_001"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()["data"]
    assert data["status"] == "CONNECTED"
    assert data["warnings"], "register/subscribe timeouts must surface as warnings"
    assert data["provisioning"] == "pending"
    assert scheduled == [gym_id]

    gym = _gym(app, gym_id)
    assert gym.whatsapp_connection_status == "CONNECTED"
    assert gym.whatsapp_enabled is True
    assert gym.phone_number_id == "phone_id_9988"
    assert gym.get_whatsapp_token() == "gym_bisu_token_xyz"
    # The partial failure is recorded honestly, not hidden.
    assert gym.whatsapp_connection_error is not None
    assert "Messaging may not work" in gym.whatsapp_connection_error
    assert gym.whatsapp_templates_provisioned is False

    # And the warning is surfaced by connection-status (not just stored).
    status = client.get("/api/mobile/v1/whatsapp/connection-status", headers=headers)
    assert status.status_code == 200
    assert status.get_json()["data"]["warning"] is not None
    assert "Messaging may not work" in status.get_json()["data"]["warning"]


# ── 6. Handshake expiry at HTTP level (T4) ─────────────────────────────

def test_expired_handshake_connect_waba_returns_401_json(client, app, monkeypatch):
    """An expired handshake presented to connect-waba -> 401 JSON, and the
    gym is untouched (no connect attempted)."""
    gym_id, headers = _make_owner(client, app, "wa-hs-expired", "hs.expired@example.com")
    _meta_config(app)
    with app.app_context():
        owner = User.query.filter_by(email="hs.expired@example.com").first()
        owner_id = owner.id
    expired = _mint_handshake(app, owner_id, gym_id, expired=True)

    resp = client.post(
        "/api/mobile/v1/whatsapp/connect-waba",
        json={"code": "meta_auth_code_abc"},
        headers={"Authorization": f"Bearer {expired}"},
    )
    assert resp.status_code == 401, resp.get_json()
    assert "application/json" in resp.headers["Content-Type"]
    assert resp.get_json()["error"]["code"] in ("TOKEN_EXPIRED", "UNAUTHORIZED")

    gym = _gym(app, gym_id)
    assert gym.whatsapp_connection_status == "NOT_CONNECTED"
    assert gym.whatsapp_enabled is False


def test_expired_handshake_page_rejected(client, app):
    """A page served with an expired handshake is rejected at serve time
    (401 'Signup link expired') — the owner never reaches a page that
    can only fail at the final save (W-H7)."""
    gym_id, _headers = _make_owner(client, app, "wa-hs-page", "hs.page@example.com")
    with app.app_context():
        owner = User.query.filter_by(email="hs.page@example.com").first()
        owner_id = owner.id
    resp = _fetch_signup_page(client, app, gym_id, owner_id, expired=True)
    assert resp.status_code == 401, resp.get_data(as_text=True)
    body = resp.get_data(as_text=True)
    assert "expired" in body.lower()
    # A rejected page must not also contain the working signup flow.
    assert "FB.login" not in body


# ── 7. Page JS behaviour, asserted on literals (T2) ─────────────────────

def _page_body(client, app):
    gym_id, _headers = _make_owner(client, app, "wa-page-body", "page.body@example.com")
    with app.app_context():
        owner = User.query.filter_by(email="page.body@example.com").first()
        owner_id = owner.id
    resp = _fetch_signup_page(client, app, gym_id, owner_id)
    assert resp.status_code == 200
    return resp.get_data(as_text=True)


def test_page_signup_fetch_has_60s_timeout(client, app):
    """The code-exchange fetch must have a 60s AbortController timeout —
    the incident freeze was a fetch with no timeout at all (W-C1)."""
    body = _page_body(client, app)
    assert "AbortController" in body
    assert "CONNECT_TIMEOUT_MS = 60000" in body
    assert "controller.abort()" in body


def test_page_signup_failure_shows_error_and_offers_retry(client, app):
    """A failed code exchange must surface the backend's error visibly,
    re-enable Connect, and offer a retry — never a silent console.warn.

    Implemented as ``failSignup``: clears the watchdog, frees the
    exchange guard, re-enables Connect, and shows ``signupErrorText``,
    which surfaces the backend's own error message.
    """
    body = _page_body(client, app)
    # Shared failure landing exists and is wired to both save paths.
    assert "function failSignup(result, err)" in body
    assert body.count("failSignup(") >= 4  # def + both .then/.catch call sites
    # Failure re-enables Connect and shows a visible error status.
    assert "function enableConnectButton()" in body
    assert "enableConnectButton();" in body
    assert "setStatus(signupErrorText(result, err), true)" in body
    # The backend's error text reaches the owner, not just the console.
    assert "result.error" in body
    assert "error.message" in body
    # Every failure branch ends with a retry prompt.
    assert "tap Connect to try again" in body
    # The old misleading terminal text is gone entirely.
    assert "Verifying Meta connection" not in body


def test_page_verifying_branch_shows_error(client, app):
    """The 'Verifying...' branch (any JSON failure) must show the error
    instead of freezing on a misleading progress string (W-H2/W-L8).

    Implemented by removing the branch: every JSON failure goes through
    failSignup, which shows the real error.
    """
    body = _page_body(client, app)
    assert "Verifying Meta connection" not in body
    assert "function failSignup(result, err)" in body
    assert "result.error" in body


def test_page_missing_code_errors_instead_of_freezing(client, app):
    """FB.login returning authResponse without a code must show an error
    instead of freezing on 'Retrieving...' with no fetch ever attempted
    (W-M3)."""
    body = _page_body(client, app)
    assert "Meta didn't return a sign-in code" in body
    # The error branch re-enables Connect (retry is possible).
    idx = body.find("didn't return a sign-in code")
    window = body[max(0, idx - 200):idx + 200]
    assert "enableConnectButton()" in window
    # And "Retrieving..." is only claimed once a code actually exists.
    assert "only claim" in body or body.find("Retrieving WhatsApp Business details") > body.find("if (code)")


# ── 8. Idempotency / dedup (W-H6) ───────────────────────────────────────

def test_connect_waba_same_waba_phone_returns_success_without_rerun(client, app, monkeypatch):
    """A re-POST with the same waba+phone for an already-CONNECTED gym
    returns success at once — the Meta chain is NOT re-run (the code
    exchange is called exactly once across both POSTs)."""
    gym_id, headers = _make_owner(client, app, "wa-dedup-ids", "dedup.ids@example.com")
    _meta_config(app)
    import app.services.embedded_signup_service as svc

    calls = {"exchange": 0}
    get_fn, post_fn = _graph_dispatch()

    def _get_counting(url, *args, **kwargs):
        if "oauth/access_token" in url:
            calls["exchange"] += 1
        return get_fn(url, *args, **kwargs)

    monkeypatch.setattr(svc.requests, "get", _get_counting)
    monkeypatch.setattr(svc.requests, "post", post_fn)
    scheduled = _patch_schedule_stub(monkeypatch)

    payload = {
        "code": "meta_auth_code_abc",
        "waba_id": "waba_12345",
        "phone_number_id": "phone_id_9988",
        "business_id": "biz_001",
    }
    first = client.post("/api/mobile/v1/whatsapp/connect-waba", json=payload, headers=headers)
    assert first.status_code == 200, first.get_json()
    assert first.get_json()["data"]["status"] == "CONNECTED"
    assert calls["exchange"] == 1

    second = client.post("/api/mobile/v1/whatsapp/connect-waba", json=payload, headers=headers)
    assert second.status_code == 200, second.get_json()
    assert second.get_json()["data"]["status"] == "CONNECTED"
    assert calls["exchange"] == 1, "second POST re-ran the code exchange"
    # Templates still pending -> the dedup re-triggers background provisioning.
    assert second.get_json()["data"]["provisioning"] == "pending"
    assert scheduled == [gym_id, gym_id]

    gym = _gym(app, gym_id)
    assert gym.whatsapp_connection_status == "CONNECTED"
    assert gym.whatsapp_enabled is True


def test_connect_waba_same_code_twice_returns_stored_success(client, app, monkeypatch):
    """Posting the same code twice (page + app firing one single-use code)
    must not flip a CONNECTED gym to FAILED: the second POST fails code
    exchange, but the route returns the stored success instead of a 409."""
    gym_id, headers = _make_owner(client, app, "wa-dedup-code", "dedup.code@example.com")
    _meta_config(app)
    import app.services.embedded_signup_service as svc

    calls = {"exchange": 0}

    def _get_stateful(url, *args, **kwargs):
        if "oauth/access_token" in url:
            calls["exchange"] += 1
            if calls["exchange"] == 1:
                return _GraphResp(200, {"access_token": "gym_bisu_token_xyz"})
            return _GraphResp(400, {"error": {"message": "code already used"}}, text="code already used")
        get_fn, _ = _graph_dispatch()
        return get_fn(url, *args, **kwargs)

    _, post_fn = _graph_dispatch()
    monkeypatch.setattr(svc.requests, "get", _get_stateful)
    monkeypatch.setattr(svc.requests, "post", post_fn)
    _patch_schedule_stub(monkeypatch)

    first = client.post(
        "/api/mobile/v1/whatsapp/connect-waba",
        json={"code": "meta_auth_code_abc", "business_id": "biz_001"},
        headers=headers,
    )
    assert first.status_code == 200, first.get_json()
    assert first.get_json()["data"]["status"] == "CONNECTED"

    second = client.post(
        "/api/mobile/v1/whatsapp/connect-waba",
        json={"code": "meta_auth_code_abc", "business_id": "biz_001"},
        headers=headers,
    )
    assert second.status_code == 200, second.get_json()
    assert second.get_json()["data"]["status"] == "CONNECTED"
    assert second.get_json()["data"]["waba_id"] == "waba_12345"
    assert second.get_json()["data"]["phone_number_id"] == "phone_id_9988"
    # The second attempt DID hit the single-use code failure — and the
    # route recovered by returning the stored success.
    assert calls["exchange"] == 2

    gym = _gym(app, gym_id)
    assert gym.whatsapp_connection_status == "CONNECTED"
    assert gym.whatsapp_enabled is True
    assert gym.whatsapp_business_account_id == "waba_12345"
    assert gym.phone_number_id == "phone_id_9988"


def test_flow2_same_waba_phone_dedup_skips_verification(client, app, monkeypatch):
    """A Flow 2 (no-code) re-POST with the same waba+phone for an
    already-CONNECTED gym returns success without re-verifying with
    Meta — connect_webhooks is never called."""
    gym_id, headers = _make_connected_gym(client, app, "wa-dedup-flow2", "dedup.flow2@example.com")
    _patch_schedule_stub(monkeypatch)

    from app.services.whatsapp_service import WhatsAppService

    def _must_not_run(self):
        raise AssertionError("connect_webhooks must not run for a deduped re-POST")

    monkeypatch.setattr(WhatsAppService, "connect_webhooks", _must_not_run)

    resp = client.post(
        "/api/mobile/v1/whatsapp/connect-waba",
        json={"waba_id": "waba_12345", "phone_number_id": "phone_id_9988"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["data"]["status"] == "CONNECTED"
    assert _gym(app, gym_id).whatsapp_connection_status == "CONNECTED"
