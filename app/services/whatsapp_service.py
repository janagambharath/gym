from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass

import requests
from flask import current_app
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.models import Gym


def _build_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(total=0, backoff_factor=0, status_forcelist=[])
    adapter = HTTPAdapter(pool_connections=2, pool_maxsize=10, max_retries=retry)
    session.mount("https://", adapter)
    return session


_SESSION = _build_session()


@dataclass
class WhatsAppResult:
    ok: bool
    provider_message_id: str | None = None
    error: str | None = None


class WhatsAppService:
    def __init__(self, gym: Gym) -> None:
        self.gym_id = gym.id
        self.gym_enabled = gym.whatsapp_enabled
        self.enabled = current_app.config["WHATSAPP_ENABLED"]
        self.whatsapp_business_account_id = gym.whatsapp_business_account_id
        self.phone_number_id = gym.phone_number_id
        self.access_token = current_app.config["WHATSAPP_ACCESS_TOKEN"]
        self.api_version = current_app.config["WHATSAPP_API_VERSION"]

    def connect_webhooks(self) -> WhatsAppResult:
        if not self.whatsapp_business_account_id:
            return WhatsAppResult(ok=False, error="Meta WhatsApp Business Account ID is missing")
        if not self.phone_number_id:
            return WhatsAppResult(ok=False, error="Gym WhatsApp phone number ID is missing")
        if not self.access_token:
            return WhatsAppResult(ok=False, error="WhatsApp access token is missing")
        public_base_url = current_app.config.get("PUBLIC_BASE_URL", "").rstrip("/")
        verify_token = current_app.config.get("WHATSAPP_VERIFY_TOKEN", "")
        if not public_base_url:
            return WhatsAppResult(ok=False, error="PUBLIC_BASE_URL is missing")
        if not verify_token:
            return WhatsAppResult(ok=False, error="WhatsApp verify token is missing")

        headers = {"Authorization": f"Bearer {self.access_token}"}
        phone_numbers_url = (
            f"https://graph.facebook.com/{self.api_version}/"
            f"{self.whatsapp_business_account_id}/phone_numbers"
        )
        try:
            response = _SESSION.get(
                phone_numbers_url,
                params={"fields": "id", "limit": 100},
                headers=headers,
                timeout=20,
            )
        except requests.RequestException as exc:
            return WhatsAppResult(ok=False, error=f"Could not validate phone number: {exc}")

        if response.status_code >= 400:
            self._handle_auth_failure(response.status_code)
            return WhatsAppResult(ok=False, error=self._response_error(response))

        phone_number_ids = {
            str(phone_number.get("id"))
            for phone_number in response.json().get("data", [])
            if phone_number.get("id")
        }
        if str(self.phone_number_id) not in phone_number_ids:
            return WhatsAppResult(
                ok=False,
                error="Phone number ID does not belong to that WhatsApp Business Account",
            )

        subscribed_apps_url = (
            f"https://graph.facebook.com/{self.api_version}/"
            f"{self.whatsapp_business_account_id}/subscribed_apps"
        )
        try:
            response = _SESSION.post(
                subscribed_apps_url,
                json={
                    "override_callback_uri": f"{public_base_url}/webhook/whatsapp",
                    "verify_token": verify_token,
                },
                headers=headers,
                timeout=20,
            )
        except requests.RequestException as exc:
            return WhatsAppResult(ok=False, error=f"Could not subscribe webhooks: {exc}")

        if response.status_code >= 400:
            self._handle_auth_failure(response.status_code)
            return WhatsAppResult(ok=False, error=self._response_error(response))
        if not response.json().get("success"):
            return WhatsAppResult(ok=False, error="Meta did not confirm webhook subscription")
        return WhatsAppResult(ok=True)

    def send_text(self, *, to: str, body: str) -> WhatsAppResult:
        configuration_error = self._configuration_error()
        if configuration_error:
            return WhatsAppResult(ok=False, error=configuration_error)
        if not self.enabled:
            current_app.logger.info(
                "WhatsApp disabled globally; simulated message for gym %s to %s",
                self.gym_id,
                to,
            )
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
        configuration_error = self._configuration_error()
        if configuration_error:
            return WhatsAppResult(ok=False, error=configuration_error)
        if not self.enabled:
            current_app.logger.info(
                "WhatsApp disabled globally; simulated image message for gym %s to %s",
                self.gym_id,
                to,
            )
            return WhatsAppResult(ok=True, provider_message_id="simulated-image")

        media_id = self._upload_media(image_url)
        if media_id:
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": to.replace("+", ""),
                "type": "image",
                "image": {"id": media_id, "caption": caption},
            }
        else:
            current_app.logger.warning("Falling back to WhatsApp image link for %s", to)
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": to.replace("+", ""),
                "type": "image",
                "image": {"link": image_url, "caption": caption},
            }
        return self._post(payload)

    def _upload_media(self, image_url: str) -> str | None:
        url_hash = hashlib.sha256(image_url.encode()).hexdigest()[:16]
        cache_key = f"wa_media_id:{self.phone_number_id}:{url_hash}"

        try:
            import redis as _redis

            redis_client = _redis.from_url(current_app.config["REDIS_URL"], socket_connect_timeout=2)
            cached = redis_client.get(cache_key)
            if cached:
                return cached.decode() if isinstance(cached, bytes) else cached
        except Exception:
            redis_client = None

        try:
            image_response = _SESSION.get(image_url, timeout=15)
            image_response.raise_for_status()
            content_type = image_response.headers.get("Content-Type", "image/png")
            upload_url = (
                f"https://graph.facebook.com/{self.api_version}/"
                f"{self.phone_number_id}/media"
            )
            response = _SESSION.post(
                upload_url,
                headers={"Authorization": f"Bearer {self.access_token}"},
                data={"messaging_product": "whatsapp"},
                files={"file": ("qr.png", image_response.content, content_type)},
                timeout=30,
            )
            if response.status_code in (401, 403):
                self._handle_auth_failure(response.status_code)
            if response.status_code != 200:
                current_app.logger.warning(
                    "WhatsApp media upload failed status=%s", response.status_code
                )
                return None
            media_id = response.json().get("id")
            if media_id and redis_client:
                try:
                    redis_client.setex(cache_key, 23 * 3600, media_id)
                except Exception:
                    current_app.logger.exception("Could not cache WhatsApp media id")
            return media_id
        except Exception as exc:
            current_app.logger.warning("WhatsApp media upload failed: %s", exc)
            return None

    def _handle_auth_failure(self, status_code: int) -> None:
        if status_code not in (401, 403):
            return
        try:
            import sentry_sdk

            sentry_sdk.capture_message(
                "WhatsApp access token rejected; rotate immediately",
                level="error",
            )
        except Exception:
            pass
        current_app.logger.error(
            "WHATSAPP_TOKEN_INVALID phone_number_id=%s status=%s",
            self.phone_number_id,
            status_code,
        )

    def _post(self, payload: dict, *, retries: int = 3) -> WhatsAppResult:
        if not self.access_token:
            return WhatsAppResult(ok=False, error="WhatsApp credentials are missing")

        url = (
            f"https://graph.facebook.com/{self.api_version}/"
            f"{self.phone_number_id}/messages"
        )
        last_error = "Unknown error"
        for attempt in range(1, retries + 1):
            try:
                response = _SESSION.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {self.access_token}"},
                    timeout=20,
                )
            except requests.Timeout:
                last_error = "Request timed out"
                time.sleep(2**attempt)
                continue
            except requests.ConnectionError:
                last_error = "Connection error"
                time.sleep(2**attempt)
                continue

            if response.status_code == 429:
                wait = int(response.headers.get("Retry-After", 2**attempt))
                current_app.logger.warning("WhatsApp rate limited, waiting %ds", wait)
                time.sleep(min(wait, 30))
                last_error = "Rate limited"
                continue

            if response.status_code >= 500:
                last_error = f"HTTP {response.status_code}"
                time.sleep(2**attempt)
                continue

            if response.status_code >= 400:
                self._handle_auth_failure(response.status_code)
                safe_error = self._response_error(response)
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

    def _configuration_error(self) -> str | None:
        if not self.gym_enabled:
            return "WhatsApp is not enabled for this gym"
        if not self.phone_number_id:
            return "Gym WhatsApp phone number ID is missing"
        return None

    @staticmethod
    def _response_error(response: requests.Response) -> str:
        safe_error = f"HTTP {response.status_code}"
        try:
            error_data = response.json()
            safe_error = error_data.get("error", {}).get("message", safe_error)[:200]
        except Exception:
            pass
        return safe_error
