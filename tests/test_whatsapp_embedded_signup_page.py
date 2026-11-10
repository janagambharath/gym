"""WhatsApp embedded-signup PAGE tests (W-C1, W-H1–W-H3, W-H7, W-H8, W-M3,
W-M8, W-M9, W-L3, W-L5, W-L6) — page + PWA crew.

The page JS is an inline template string, not an importable module, so
coverage here is literal: the served page body must contain the timeout /
visible-error / retry behaviour and must NOT contain the dead-end literals
that froze the incident owner on "Retrieving...". Behavioural coverage of
the PWA side lives in renewal-desk-pwa/src/screens/whatsapp-signup.test.js.
"""

from app.extensions import db
from app.models import Gym, User


def _page_html():
    from app.mobile_api.whatsapp import _EMBEDDED_SIGNUP_HTML

    # The template is JS source: apostrophes are escaped (\') and render
    # as plain ' at runtime. Normalise so assertions match runtime text.
    return _EMBEDDED_SIGNUP_HTML.replace("\\'", "'")


def test_signup_page_has_timeout_and_visible_error_recovery():
    """W-C1: both saves go through a 60 s AbortController fetch whose
    failures surface as a visible error + re-enabled Connect — never a
    console.warn-only catch."""
    html = _page_html()
    # 60 s timeout on the connect-waba save.
    assert "AbortController" in html
    assert "CONNECT_TIMEOUT_MS = 60000" in html
    assert "controller.abort()" in html
    assert "postConnectWaba" in html
    # Failure lands on screen with plain words + retry.
    assert "Couldn't reach the server — tap Connect to try again" in html
    assert "The connection timed out — tap Connect to try again" in html
    assert "failSignup" in html
    assert "enableConnectButton" in html
    # The incident's dead ends are gone.
    assert "Signed in. Verifying Meta connection..." not in html
    assert "console.warn('Backend code exchange failed'" not in html
    assert "console.warn('Direct connect save error'" not in html
    # Defensive JSON parse: no bare res.json() that throws on an HTML body.
    assert "return res.json();" not in html
    assert "JSON.parse(text)" in html


def test_signup_page_post_signin_watchdog_stays_armed():
    """W-H1: a post-signin watchdog is armed on login success, so the page
    always has a live recovery path after FB.login returns."""
    html = _page_html()
    assert "armPostSigninWatchdog" in html
    assert "clearPostSigninWatchdog" in html
    assert "_signupPending" in html
    assert "CONNECT_TIMEOUT_MS + 5000" in html


def test_signup_page_shows_real_error_not_verifying():
    """W-H2/W-L8: the JSON-failure branch reads result.error and shows it."""
    html = _page_html()
    assert "signupErrorText" in html
    assert "error.message" in html
    assert "Meta rejected the connection — tap Connect to try again" in html


def test_signup_page_missing_code_branch_errors_visibly():
    """W-M3: no code from FB.login shows an error; 'Retrieving...' is only
    set inside the `if (code)` branch."""
    html = _page_html()
    assert "Meta didn't return a sign-in code — tap Connect to try again" in html
    # The status set must come after the code guard in the source order.
    assert html.index("var code = response.authResponse.code;") < html.index(
        "setStatus('Signed in. Retrieving WhatsApp Business details...', false)"
    )


def test_signup_page_open_in_browser_keeps_the_page():
    """W-H3 (option a): Meta opens in a NEW tab; the page never navigates
    itself away (no return URL exists)."""
    html = _page_html()
    assert "window.open(directMetaUrl, '_blank')" in html
    assert "window.location.href = directMetaUrl" not in html
    assert "finish signup there, then return to this tab" in html
    assert "allow popups for this site" in html


def test_signup_page_cancel_works_in_a_browser_tab():
    """W-M9: Cancel in a browser tab closes the tab back to the app (with
    an app-home fallback); the WebView still posts the cancel message."""
    html = _page_html()
    assert "embedded_signup_cancel" in html
    assert "window.close()" in html
    assert "Setup cancelled. Returning to the app" in html


def test_signup_page_expired_handshake_error_contract():
    """W-H7 (page half, provisional contract — no backend-crew contract
    existed when this page was fixed): expired-handshake errors map to a
    clear restart-from-the-app message."""
    html = _page_html()
    assert "TOKEN_EXPIRED" in html
    assert "SUBSCRIPTION_REQUIRED" in html
    assert "This setup link expired — restart setup from the app." in html
    assert "Your trial has ended — renew your subscription" in html


def test_signup_page_single_owner_of_code_exchange():
    """W-H6 (page half): inside the app WebView the page posts the code and
    does NOT fire its own fetch; a guard stops a second save after the
    first fired."""
    html = _page_html()
    assert "_exchangeInFlight" in html
    assert "if (!window.ReactNativeWebView && !_exchangeInFlight)" in html
    assert "if (window.ReactNativeWebView || _exchangeInFlight) return;" in html


def test_signup_page_fb_init_throw_and_incomplete_signup_show_errors():
    """W-L3: an FB.init throw shows a visible error. W-M8: a
    business_id-only message shows the signup is incomplete."""
    html = _page_html()
    assert "Meta sign-in could not load. Check your internet connection" in html
    assert "Signup is incomplete — Meta didn't return a WhatsApp number" in html


def test_signup_page_no_manual_entry_promise():
    """W-L5: the recovery message must not promise a manual-entry path the
    PWA does not have."""
    html = _page_html()
    assert "enter your WhatsApp credentials directly" not in html
    assert "Ready. Tap Connect WhatsApp to try again." in html


def test_signup_page_token_guard_survives_replacement():
    """ROOT-CAUSE REGRESSION: the old guards compared AUTH_TOKEN /
    FEATURE_TYPE to the placeholder literal — but serve-time replacement
    rewrites the literal too, so the comparison was always false and
    neither save fetch ever fired in the served page (the incident freeze
    was 'Retrieving...' with NO request at all, not a hung request).
    Each placeholder must occur exactly once in the template (its var
    assignment) and never inside a comparison."""
    html = _page_html()
    assert "AUTH_TOKEN !== '{{AUTH_TOKEN}}'" not in html
    assert "FEATURE_TYPE !== '{{FEATURE_TYPE}}'" not in html
    for placeholder in ("{{META_APP_ID}}", "{{META_CONFIG_ID}}", "{{FEATURE_TYPE}}", "{{AUTH_TOKEN}}"):
        assert html.count(placeholder) == 1, f"{placeholder} must occur exactly once (its assignment)"
    assert "indexOf('{{') !== 0" in html


def test_signup_page_placeholders_and_validation_unchanged():
    """Placeholders stay intact for serve-time replacement, and the W-L6
    validation behaviour (HTML 400 for direct loads) is untouched."""
    html = _page_html()
    for placeholder in ("{{META_APP_ID}}", "{{META_CONFIG_ID}}", "{{FEATURE_TYPE}}", "{{AUTH_TOKEN}}"):
        assert placeholder in html
    # Allowlist/CSP behaviour lives in the route, not the template — but
    # the template must not have gained a new external fetch target.
    assert "connect.facebook.net" in html
    assert "https://business.facebook.com/messaging/whatsapp/onboard/" in html
    assert html.count("fetch(") == 1, "all saves must go through postConnectWaba's single fetch"


def test_served_signup_page_contains_fixed_js(client, app, monkeypatch):
    """End-to-end literal check on the page the route actually serves:
    placeholders replaced, fixed JS present, dead-end literals absent."""
    with app.app_context():
        gym = Gym(name="WA Page Gym", slug="wa-page-gym", country="India", currency="INR", phone="+919871112233", whatsapp_enabled=False)
        db.session.add(gym)
        db.session.flush()
        owner = User(gym_id=gym.id, email="wa.page@example.com", full_name="WA Page Owner", role="gym_owner")
        owner.set_password("password123")
        db.session.add(owner)
        db.session.commit()

    app.config["META_APP_ID"] = "1234567890123456"
    app.config["META_CONFIG_ID"] = "test_meta_config_id"
    login_resp = client.post(
        "/api/mobile/v1/auth/login",
        json={"email": "wa.page@example.com", "password": "password123"},
    )
    token = login_resp.get_json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    config_resp = client.get("/api/mobile/v1/whatsapp/onboarding-config", headers=headers)
    handshake = config_resp.get_json()["data"]["signup_handshake"]

    resp = client.get(
        "/api/mobile/v1/whatsapp/embedded-signup-page?meta_app_id=1234567890123456"
        f"&config_id=test_meta_config_id&handshake={handshake}"
    )
    assert resp.status_code == 200
    body = resp.get_data(as_text=True).replace("\\'", "'")
    # Placeholders replaced at serve time.
    assert "{{META_APP_ID}}" not in body
    assert "{{AUTH_TOKEN}}" not in body
    # Fixed behaviour shipped in the served page.
    assert "AbortController" in body
    assert "Couldn't reach the server — tap Connect to try again" in body
    assert "This setup link expired — restart setup from the app." in body
    # Dead-end literals gone from the served page.
    assert "Signed in. Verifying Meta connection..." not in body
    assert "window.location.href = directMetaUrl" not in body
    assert "enter your WhatsApp credentials directly" not in body
    # ROOT-CAUSE REGRESSION: the served guard must not compare the token
    # against itself (the old guard was always false — no fetch ever ran).
    assert f"AUTH_TOKEN !== '{handshake}'" not in body
    assert "indexOf('{{') !== 0" in body


def test_signup_page_validation_still_returns_html_400(client):
    """W-L6 verified-not-changed: a direct load without a handshake still
    gets the HTML 400 (validation failures are load-time only)."""
    resp = client.get(
        "/api/mobile/v1/whatsapp/embedded-signup-page?meta_app_id=1234567890123456&config_id=test_meta_config_id"
    )
    assert resp.status_code == 400
    assert "Configuration Error" in resp.get_data(as_text=True)
