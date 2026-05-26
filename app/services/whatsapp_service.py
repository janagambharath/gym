from __future__ import annotations

import time
from dataclasses import dataclass

import requests
from flask import current_app


@dataclass
class WhatsAppResult:
    ok: bool
    provider_message_id: str | None = None
    error: str | None = None


class WhatsAppService:
    def __init__(self) -> None:
        self.enabled = current_app.config["WHATSAPP_ENABLED"]
        self.phone_number_id = current_app.config["WHATSAPP_PHONE_NUMBER_ID"]
        self.access_token = current_app.config["WHATSAPP_ACCESS_TOKEN"]
        self.api_version = current_app.config["WHATSAPP_API_VERSION"]

    def send_text(self, *, to: str, body: str) -> WhatsAppResult:
        if not self.enabled:
            current_app.logger.info("WhatsApp disabled; simulated message to %s", to)
            return WhatsAppResult(ok=True, provider_message_id="simulated")
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to.replace("+", ""),
            "type": "text",
            "text": {"preview_url": False, "body": body},
        }
        return self._post(payload)

    def send_image(self, *, to: str, image_url: str, caption: str) -> WhatsAppResult:
        if not self.enabled:
            current_app.logger.info("WhatsApp disabled; simulated image message to %s", to)
            return WhatsAppResult(ok=True, provider_message_id="simulated-image")
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to.replace("+", ""),
            "type": "image",
            "image": {"link": image_url, "caption": caption},
        }
        return self._post(payload)

    def _post(self, payload: dict, *, retries: int = 3) -> WhatsAppResult:
        if not self.phone_number_id or not self.access_token:
            return WhatsAppResult(ok=False, error="WhatsApp credentials are missing")

        url = (
            f"https://graph.facebook.com/{self.api_version}/"
            f"{self.phone_number_id}/messages"
        )
        last_error = "Unknown error"
        for attempt in range(1, retries + 1):
            try:
                response = requests.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {self.access_token}"},
                    timeout=20,
                )
            except requests.Timeout:
                last_error = "Request timed out"
                time.sleep(2 ** attempt)
                continue
            except requests.ConnectionError:
                last_error = "Connection error"
                time.sleep(2 ** attempt)
                continue

            if response.status_code == 429:
                wait = int(response.headers.get("Retry-After", 2 ** attempt))
                current_app.logger.warning("WhatsApp rate limited, waiting %ds", wait)
                time.sleep(min(wait, 30))
                last_error = "Rate limited"
                continue

            if response.status_code >= 500:
                last_error = f"HTTP {response.status_code}"
                time.sleep(2 ** attempt)
                continue

            if response.status_code >= 400:
                safe_error = f"HTTP {response.status_code}"
                try:
                    error_data = response.json()
                    safe_error = error_data.get("error", {}).get("message", safe_error)[:200]
                except Exception:
                    pass
                current_app.logger.warning(
                    "WhatsApp API error %s for phone_number_id %s",
                    response.status_code,
                    self.phone_number_id,
                )
                return WhatsAppResult(ok=False, error=safe_error)

            data = response.json()
            message_id = None
            if data.get("messages"):
                message_id = data["messages"][0].get("id")
            return WhatsAppResult(ok=True, provider_message_id=message_id)

        return WhatsAppResult(ok=False, error=f"Failed after {retries} attempts: {last_error}")
