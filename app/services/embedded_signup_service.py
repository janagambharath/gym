"""Embedded Signup Service — handles the full Meta WhatsApp Embedded Signup
post-onboarding flow for multi-tenant SaaS.

After a gym owner completes Meta's Embedded Signup UI, this service:
1. Exchanges the authorization code for a per-gym BISU access token
2. Discovers the WABA ID from debug_token granular scopes
3. Fetches phone numbers registered under the WABA
4. Registers the phone number for Cloud API
5. Subscribes the app to WABA webhooks
6. Auto-provisions standard Renewal Desk message templates
7. Stores everything per-gym (encrypted token, WABA ID, phone number, etc.)
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import requests
from flask import current_app

from app.extensions import db
from app.models import Gym
from app.services.template_provisioning_service import provision_templates

_logger = logging.getLogger(__name__)
_TIMEOUT = 15


@dataclass
class SignupResult:
    ok: bool
    waba_id: str = ""
    phone_number_id: str = ""
    display_phone_number: str = ""
    business_id: str = ""
    error: str = ""
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
        """Run the full post-onboarding flow. Returns a SignupResult."""
        result = SignupResult(ok=False, business_id=business_id)
        gym_token = ""

        # ── Step 1: Exchange authorization code for BISU token ──
        if code:
            gym_token = self._exchange_code(code, result)
            if gym_token:
                result.steps_completed.append("code_exchange")

        # ── Step 2: Discover WABA from debug_token if not provided ──
        if gym_token and not waba_id:
            waba_id = self._discover_waba(gym_token, result)
        if waba_id:
            result.waba_id = waba_id
            result.steps_completed.append("waba_discovered")

        # Use the best available token for subsequent API calls
        token = gym_token or self.global_token

        # ── Step 3: Fetch phone numbers if not provided ──
        if waba_id and not phone_number_id and token:
            phone_number_id, display_phone_number = self._fetch_phone_numbers(
                waba_id, token, result
            )

        if phone_number_id:
            result.phone_number_id = phone_number_id
            result.display_phone_number = display_phone_number or ""
            result.steps_completed.append("phone_fetched")

        # Also try fetching display number if we have phone_number_id but no display
        if phone_number_id and not display_phone_number and token:
            display_phone_number = self._fetch_display_number(phone_number_id, token)
            if display_phone_number:
                result.display_phone_number = display_phone_number

        if not phone_number_id:
            result.error = (
                "Could not determine phone_number_id. "
                "Please ensure you completed Meta's Embedded Signup flow."
            )
            return result

        # ── Step 4: Register phone number for Cloud API ──
        if token:
            self._register_phone(phone_number_id, token, result)

        # ── Step 5: Subscribe app to WABA webhooks ──
        if waba_id and token:
            self._subscribe_app(waba_id, token, result)

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
        self.gym.whatsapp_connection_error = None

        db.session.flush()
        result.steps_completed.append("gym_saved")

        # ── Step 7: Auto-provision templates ──
        if waba_id and token:
            try:
                provision_templates(waba_id=waba_id, access_token=token, api_version=self.api_ver)
                self.gym.whatsapp_templates_provisioned = True
                result.steps_completed.append("templates_provisioned")
            except Exception as exc:
                _logger.warning("Template provisioning failed for gym %s: %s", self.gym.id, exc)
                # Non-fatal — gym is still connected

        result.ok = True
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

    def _register_phone(self, phone_number_id: str, token: str, result: SignupResult) -> None:
        """Register a phone number for Cloud API messaging."""
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
            else:
                _logger.info(
                    "Phone register response for %s: %s %s",
                    phone_number_id, resp.status_code, resp.text[:200],
                )
                # Not fatal — phone might already be registered
                result.steps_completed.append("phone_register_attempted")
        except Exception as exc:
            _logger.warning("Phone registration failed for %s: %s", phone_number_id, exc)

    def _subscribe_app(self, waba_id: str, token: str, result: SignupResult) -> None:
        """Subscribe our app to the WABA for webhook events."""
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
            else:
                _logger.info(
                    "WABA subscribe response for %s: %s %s",
                    waba_id, resp.status_code, resp.text[:200],
                )
                result.steps_completed.append("webhook_subscribe_attempted")
        except Exception as exc:
            _logger.warning("WABA subscribe failed for %s: %s", waba_id, exc)
