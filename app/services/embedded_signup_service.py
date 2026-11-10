"""Embedded Signup Service — handles the full Meta WhatsApp Embedded Signup
post-onboarding flow for multi-tenant SaaS.

After a gym owner completes Meta's Embedded Signup UI, this service:
1. Exchanges the authorization code for a per-gym BISU access token
2. Discovers the WABA ID from debug_token granular scopes
3. Fetches phone numbers registered under the WABA
4. Registers the phone number for Cloud API
5. Subscribes the app to WABA webhooks
6. Saves the gym row (COMMITTED by the route) and schedules background
   template provisioning — provisioning never runs in-request any more
   (W-C1/W-H5: a slow Meta must not roll back a good connect).
7. Stores everything per-gym (encrypted token, WABA ID, phone number, etc.)
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

import requests
from flask import current_app

from app.extensions import db
from app.models import Gym

_logger = logging.getLogger(__name__)
# W-C1: 6 sequential Meta calls in the connect chain. 8s each bounds the
# worst case at ~48s + commit — inside the page's 60s fetch timeout.
# Meta Graph calls normally answer in ~1s; a timeout here means Meta is
# effectively down, and waiting longer only burns the page timeout.
_TIMEOUT = 8


# ── Non-blocking warning storage (W-M1 / W-C1) ──────────────────────────
# The gym row has no dedicated warning column, so the connect flow reuses
# ``Gym.whatsapp_connection_error`` as the last-WARNING store while the
# status is CONNECTED. It is ONLY read as a warning by the
# connection-status endpoint (surfaced as ``warning``); nothing treats a
# non-null value as a failure while status == "CONNECTED". Flow 2 still
# uses the same field for a real FAILED state. Two warning kinds share
# the field, each with a fixed prefix so they can be merged/cleared
# independently.
WARNING_MESSAGING_PREFIX = "Messaging may not work: "
WARNING_TEMPLATES_PREFIX = "Templates not provisioned: "


def merge_warning(existing: str | None, prefix: str, text: str) -> str:
    """Replace the ``prefix`` segment of a stored warning, or append it."""
    parts = [p.strip() for p in (existing or "").split(" | ") if p.strip()]
    parts = [p for p in parts if not p.startswith(prefix)]
    parts.append(f"{prefix}{text}")
    return " | ".join(parts)


def clear_warning_prefix(existing: str | None, prefix: str) -> str | None:
    """Remove the ``prefix`` segment of a stored warning (None if empty)."""
    parts = [p.strip() for p in (existing or "").split(" | ") if p.strip()]
    parts = [p for p in parts if not p.startswith(prefix)]
    return " | ".join(parts) or None


def has_messaging_warning(gym) -> bool:
    """True when the stored warning says registration/subscription failed."""
    return bool(
        gym.whatsapp_connection_error
        and WARNING_MESSAGING_PREFIX in gym.whatsapp_connection_error
    )


@dataclass
class SignupResult:
    ok: bool
    waba_id: str = ""
    phone_number_id: str = ""
    display_phone_number: str = ""
    business_id: str = ""
    error: str = ""
    # W-M4: machine-readable failure reason for the 409 body.
    # "code_exchange_failed" | "phone_not_found" | "" (no failure / n/a).
    failure_reason: str = ""
    # W-M1: non-blocking partial failures (register/subscribe did not
    # confirm). The gym is CONNECTED, but messaging may be degraded.
    warnings: list[str] = field(default_factory=list)
    # W-C1/W-H5: True when the connect committed and template
    # provisioning still has to run in the background.
    provisioning_pending: bool = False
    steps_completed: list[str] = field(default_factory=list)


class EmbeddedSignupService:
    """Orchestrates the full post-Embedded-Signup flow."""

    def __init__(self, gym: Gym) -> None:
        self.gym = gym
        self.api_ver = current_app.config.get("WHATSAPP_API_VERSION", "v20.0")
        self.app_id = (
            current_app.config.get("META_APP_ID")
            or current_app.config.get("WHATSAPP_APP_ID", "1711816793132513")
        )
        self.app_secret = (
            current_app.config.get("WHATSAPP_APP_SECRET")
            or current_app.config.get("WHATSAPP_WEBHOOK_SECRET", "")
        )
        self.global_token = current_app.config.get("WHATSAPP_ACCESS_TOKEN", "")

    def process_signup(
        self,
        *,
        code: str = "",
        waba_id: str = "",
        phone_number_id: str = "",
        display_phone_number: str = "",
        business_id: str = "",
    ) -> SignupResult:
        """Run the post-onboarding flow and save the gym row.

        W-C1/W-H5: this does the Meta chain + the gym save ONLY.
        Template provisioning is NOT run here — it runs in a background
        thread after the route commits (see
        ``template_provisioning_service.schedule_template_provisioning``),
        so a slow Meta can no longer roll back a good connect. The
        caller must commit after this returns, then schedule provisioning.
        """
        started = time.monotonic()
        result = SignupResult(ok=False, business_id=business_id)
        gym_token = ""

        def _elapsed_ms() -> int:
            return int((time.monotonic() - started) * 1000)

        def _step(name: str, step_started: float) -> None:
            # W-M10: one log line per step so the next hang is
            # localisable from logs (step + total elapsed).
            _logger.info(
                "Embedded signup gym=%s step=%s step_ms=%d total_ms=%d",
                self.gym.id, name,
                int((time.monotonic() - step_started) * 1000),
                _elapsed_ms(),
            )

        _logger.info("Embedded signup started gym=%s has_code=%s", self.gym.id, bool(code))

        # ── Step 1: Exchange authorization code for BISU token ──
        if code:
            step_started = time.monotonic()
            gym_token = self._exchange_code(code, result)
            _step("code_exchange", step_started)
            if gym_token:
                result.steps_completed.append("code_exchange")
            else:
                # W-M4: a failed exchange must fail fast with its own
                # reason. Falling through to the global token could
                # silently connect the WRONG WABA, and the generic
                # "could not determine phone_number_id" hid the cause.
                result.failure_reason = "code_exchange_failed"
                result.error = (
                    "Meta rejected the signup code — it may have expired "
                    "or already been used. Please start the WhatsApp "
                    "setup again from the app."
                )
                _logger.warning(
                    "Embedded signup gym=%s failed at code_exchange total_ms=%d",
                    self.gym.id, _elapsed_ms(),
                )
                return result

        # ── Step 2: Discover WABA from debug_token if not provided ──
        if gym_token and not waba_id:
            step_started = time.monotonic()
            waba_id = self._discover_waba(gym_token, result)
            _step("waba_discovery", step_started)
        if waba_id:
            result.waba_id = waba_id
            result.steps_completed.append("waba_discovered")

        # Use the best available token for subsequent API calls
        token = gym_token or self.global_token

        # ── Step 3: Fetch phone numbers if not provided ──
        if waba_id and not phone_number_id and token:
            step_started = time.monotonic()
            phone_number_id, display_phone_number = self._fetch_phone_numbers(
                waba_id, token, result
            )
            _step("phone_fetch", step_started)

        if phone_number_id:
            result.phone_number_id = phone_number_id
            result.display_phone_number = display_phone_number or ""
            result.steps_completed.append("phone_fetched")

        # Also try fetching display number if we have phone_number_id but no display
        if phone_number_id and not display_phone_number and token:
            step_started = time.monotonic()
            display_phone_number = self._fetch_display_number(phone_number_id, token)
            _step("display_fetch", step_started)
            if display_phone_number:
                result.display_phone_number = display_phone_number

        if not phone_number_id:
            result.failure_reason = "phone_not_found"
            result.error = (
                "We could not find a WhatsApp phone number on this Meta "
                "account. Please complete the business and number "
                "selection in Meta's setup, then try again."
            )
            _logger.warning(
                "Embedded signup gym=%s failed at phone_not_found total_ms=%d",
                self.gym.id, _elapsed_ms(),
            )
            return result

        # ── Step 4: Register phone number for Cloud API ──
        # W-M1: a failed register/subscribe is recorded as a warning,
        # never silently swallowed — the gym is CONNECTED, but the
        # status endpoint must report messaging as degraded.
        if token:
            step_started = time.monotonic()
            registered, register_detail = self._register_phone(phone_number_id, token, result)
            _step("phone_register", step_started)
            if not registered:
                result.warnings.append(
                    "Phone registration did not confirm with Meta "
                    f"({register_detail}). Sending may fail."
                )

        # ── Step 5: Subscribe app to WABA webhooks ──
        if waba_id and token:
            step_started = time.monotonic()
            subscribed, subscribe_detail = self._subscribe_app(waba_id, token, result)
            _step("webhook_subscribe", step_started)
            if not subscribed:
                result.warnings.append(
                    "Webhook subscription did not confirm with Meta "
                    f"({subscribe_detail}). Incoming messages and "
                    "delivery receipts may not arrive."
                )

        # ── Step 6: Save everything to the gym record ──
        self.gym.whatsapp_business_account_id = waba_id or self.gym.whatsapp_business_account_id
        self.gym.phone_number_id = phone_number_id
        if display_phone_number:
            self.gym.business_phone_number = display_phone_number
        if business_id:
            self.gym.whatsapp_meta_business_id = business_id
        if gym_token:
            self.gym.set_whatsapp_token(gym_token)

        self.gym.whatsapp_enabled = True
        self.gym.whatsapp_connection_status = "CONNECTED"
        # W-M1: a partial-failure warning lives here while CONNECTED
        # (see WARNING_*_PREFIX above); a clean connect clears it.
        if result.warnings:
            self.gym.whatsapp_connection_error = merge_warning(
                None, WARNING_MESSAGING_PREFIX, " ".join(result.warnings)
            )
        else:
            self.gym.whatsapp_connection_error = None
        # W-C1: templates are NOT provisioned in-request any more.
        # The background job sets this True when it finishes.
        self.gym.whatsapp_templates_provisioned = False

        db.session.flush()
        result.steps_completed.append("gym_saved")

        result.provisioning_pending = True
        result.ok = True
        _logger.info(
            "Embedded signup gym=%s succeeded total_ms=%d steps=%s warnings=%d",
            self.gym.id, _elapsed_ms(), ",".join(result.steps_completed),
            len(result.warnings),
        )
        return result

    # ── Private helpers ─────────────────────────────────────────────

    def _exchange_code(self, code: str, result: SignupResult) -> str:
        """Exchange short-lived auth code for a BISU access token."""
        try:
            resp = requests.get(
                f"https://graph.facebook.com/{self.api_ver}/oauth/access_token",
                params={
                    "client_id": self.app_id,
                    "client_secret": self.app_secret,
                    "code": code,
                },
                timeout=_TIMEOUT,
            )
            if resp.status_code == 200:
                token = resp.json().get("access_token", "")
                if token:
                    _logger.info("Code exchange succeeded for gym %s", self.gym.id)
                    return token
            _logger.warning(
                "Code exchange failed for gym %s: %s %s",
                self.gym.id, resp.status_code, resp.text[:200],
            )
        except Exception as exc:
            _logger.warning("Code exchange error for gym %s: %s", self.gym.id, exc)
        return ""

    def _discover_waba(self, token: str, result: SignupResult) -> str:
        """Use debug_token to extract WABA target_ids from granular scopes."""
        try:
            app_token = f"{self.app_id}|{self.app_secret}"
            resp = requests.get(
                f"https://graph.facebook.com/{self.api_ver}/debug_token",
                params={"input_token": token, "access_token": app_token},
                timeout=_TIMEOUT,
            )
            if resp.status_code == 200:
                data = resp.json().get("data", {})
                # Extract business_id if available
                if not result.business_id:
                    result.business_id = str(data.get("profile_id", ""))

                scopes = data.get("granular_scopes", [])
                for scope in scopes:
                    if scope.get("scope") in (
                        "whatsapp_business_management",
                        "whatsapp_business_messaging",
                    ):
                        targets = scope.get("target_ids", [])
                        if targets:
                            waba_id = str(targets[0])
                            _logger.info(
                                "Discovered WABA %s from debug_token for gym %s",
                                waba_id, self.gym.id,
                            )
                            return waba_id
        except Exception as exc:
            _logger.warning("debug_token failed for gym %s: %s", self.gym.id, exc)
        return ""

    def _fetch_phone_numbers(
        self, waba_id: str, token: str, result: SignupResult
    ) -> tuple[str, str]:
        """Fetch phone numbers registered under a WABA."""
        try:
            resp = requests.get(
                f"https://graph.facebook.com/{self.api_ver}/{waba_id}/phone_numbers",
                params={"fields": "id,display_phone_number,verified_name"},
                headers={"Authorization": f"Bearer {token}"},
                timeout=_TIMEOUT,
            )
            if resp.status_code == 200:
                numbers = resp.json().get("data", [])
                if numbers:
                    phone_id = str(numbers[0].get("id", ""))
                    display = str(numbers[0].get("display_phone_number", ""))
                    return phone_id, display
        except Exception as exc:
            _logger.warning("Fetch phone numbers failed for WABA %s: %s", waba_id, exc)
        return "", ""

    def _fetch_display_number(self, phone_number_id: str, token: str) -> str:
        """Fetch display phone number for a specific phone_number_id."""
        try:
            resp = requests.get(
                f"https://graph.facebook.com/{self.api_ver}/{phone_number_id}",
                params={"fields": "display_phone_number,verified_name"},
                headers={"Authorization": f"Bearer {token}"},
                timeout=_TIMEOUT,
            )
            if resp.status_code == 200:
                return str(resp.json().get("display_phone_number", ""))
        except Exception as exc:
            _logger.debug("Fetch display number failed for %s: %s", phone_number_id, exc)
        return ""

    def _register_phone(self, phone_number_id: str, token: str, result: SignupResult) -> tuple[bool, str]:
        """Register a phone number for Cloud API messaging.

        Returns ``(ok, detail)`` — W-M1: the caller records a failed
        registration as a warning instead of silently marking the gym
        CONNECTED. "Already registered" counts as ok.
        """
        try:
            resp = requests.post(
                f"https://graph.facebook.com/{self.api_ver}/{phone_number_id}/register",
                json={
                    "messaging_product": "whatsapp",
                    "pin": "000000",
                },
                headers={"Authorization": f"Bearer {token}"},
                timeout=_TIMEOUT,
            )
            if resp.status_code == 200 and resp.json().get("success"):
                result.steps_completed.append("phone_registered")
                _logger.info("Phone %s registered for Cloud API", phone_number_id)
                return True, "ok"
            body = resp.text[:200]
            if "already registered" in body.lower():
                result.steps_completed.append("phone_registered")
                _logger.info("Phone %s already registered for Cloud API", phone_number_id)
                return True, "already registered"
            _logger.info(
                "Phone register response for %s: %s %s",
                phone_number_id, resp.status_code, body,
            )
            # Not fatal — but NOT ok either; the caller warns.
            result.steps_completed.append("phone_register_attempted")
            return False, f"HTTP {resp.status_code}"
        except Exception as exc:
            _logger.warning("Phone registration failed for %s: %s", phone_number_id, exc)
            result.steps_completed.append("phone_register_attempted")
            return False, "request failed"

    def _subscribe_app(self, waba_id: str, token: str, result: SignupResult) -> tuple[bool, str]:
        """Subscribe our app to the WABA for webhook events.

        Returns ``(ok, detail)`` — see :meth:`_register_phone`.
        """
        public_base_url = current_app.config.get("PUBLIC_BASE_URL", "").rstrip("/")
        verify_token = current_app.config.get("WHATSAPP_VERIFY_TOKEN", "")
        try:
            payload = {}
            if public_base_url and verify_token:
                payload = {
                    "override_callback_uri": f"{public_base_url}/webhook/whatsapp",
                    "verify_token": verify_token,
                }
            resp = requests.post(
                f"https://graph.facebook.com/{self.api_ver}/{waba_id}/subscribed_apps",
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
                timeout=_TIMEOUT,
            )
            if resp.status_code == 200 and resp.json().get("success"):
                result.steps_completed.append("webhooks_subscribed")
                _logger.info("App subscribed to WABA %s webhooks", waba_id)
                return True, "ok"
            body = resp.text[:200]
            if "already subscribed" in body.lower():
                result.steps_completed.append("webhooks_subscribed")
                _logger.info("App already subscribed to WABA %s webhooks", waba_id)
                return True, "already subscribed"
            _logger.info(
                "WABA subscribe response for %s: %s %s",
                waba_id, resp.status_code, body,
            )
            result.steps_completed.append("webhook_subscribe_attempted")
            return False, f"HTTP {resp.status_code}"
        except Exception as exc:
            _logger.warning("WABA subscribe failed for %s: %s", waba_id, exc)
            result.steps_completed.append("webhook_subscribe_attempted")
            return False, "request failed"
