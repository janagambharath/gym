"""Renewal Desk Linux Connector — cloud API client.

Pure-Python replacement for RenewalDeskBridge/CloudApi/RenewalDeskClient.cs.
Same 5-endpoint contract:
    POST /api/bridge/v1/heartbeat
    POST /api/bridge/v1/attendance
    GET  /api/bridge/v1/commands/pending?gymId=...
    POST /api/bridge/v1/commands/{id}/ack
    POST /api/bridge/v1/enrollment/confirm
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# Match the C# client's 15-second timeout
DEFAULT_TIMEOUT = 15


@dataclass
class PendingCommand:
    """Matches the C# PendingCommand DTO, extended with advanced fields."""
    id: str
    lease_token: str
    command_type: str       # enable_user, disable_user, create_user, delete_user,
                            # unlock_door, set_valid_date, sync_users, device_info,
                            # restart, clear_log
    enroll_number: str
    member_name: Optional[str] = None
    delay_seconds: Optional[int] = None
    valid_from: Optional[str] = None    # YYYY-MM-DD
    valid_to: Optional[str] = None      # YYYY-MM-DD


class CloudApiClient:
    """Talks to the Renewal Desk Railway backend.

    Sends the same headers the C# bridge sends:
        X-Api-Key: <bridge API key>
        X-RenewalDesk-Bridge-Protocol: 2
        X-Device-Serial: <terminal serial>
    """

    def __init__(self, base_url: str, api_key: str, gym_id: str,
                 device_serial: str):
        self._base_url = base_url.rstrip("/")
        self._gym_id = gym_id
        self._session = requests.Session()
        self._session.headers.update({
            "X-Api-Key": api_key,
            "X-RenewalDesk-Bridge-Protocol": "2",
            "X-Device-Serial": device_serial,
            "Content-Type": "application/json",
        })
        self.last_error: str = ""

    def send_heartbeat(self, status: str = "online") -> bool:
        """POST /api/bridge/v1/heartbeat"""
        payload = {
            "gymId": self._gym_id,
            "status": status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        return self._post("/api/bridge/v1/heartbeat", payload)

    def send_attendance(self, event_id: str, enroll_number: str,
                        event_time: datetime, verify_method: int = 1,
                        att_state: int = 0, is_invalid: bool = False) -> bool:
        """POST /api/bridge/v1/attendance"""
        payload = {
            "gymId": self._gym_id,
            "eventId": event_id,
            "deviceEnrollNumber": enroll_number,
            "eventTime": event_time.isoformat(),
            "verifyMethod": verify_method,
            "attState": att_state,
            "isInvalid": is_invalid,
        }
        return self._post("/api/bridge/v1/attendance", payload)

    def get_pending_commands(self) -> list[PendingCommand]:
        """GET /api/bridge/v1/commands/pending?gymId=..."""
        try:
            url = f"{self._base_url}/api/bridge/v1/commands/pending"
            resp = self._session.get(
                url,
                params={"gymId": self._gym_id},
                timeout=DEFAULT_TIMEOUT,
            )
            if not resp.ok:
                self.last_error = (
                    f"GET commands/pending returned {resp.status_code}: "
                    f"{resp.text[:500]}"
                )
                return []

            self.last_error = ""
            data = resp.json()
            if not isinstance(data, list):
                return []

            commands = []
            for item in data:
                if not isinstance(item, dict):
                    continue
                cmd = PendingCommand(
                    id=str(item.get("id", "")),
                    lease_token=str(item.get("leaseToken", "")),
                    command_type=str(item.get("commandType", "")),
                    enroll_number=str(item.get("enrollNumber", "")),
                    member_name=item.get("memberName"),
                    delay_seconds=item.get("delaySeconds"),
                    valid_from=item.get("validFrom"),
                    valid_to=item.get("validTo"),
                )
                commands.append(cmd)
            return commands

        except Exception as e:
            self.last_error = f"GET commands/pending error: {e}"
            logger.error(self.last_error)
            return []

    def ack_command(self, command_id: str, status: str, error_message: str | None,
                    lease_token: str) -> bool:
        """POST /api/bridge/v1/commands/{id}/ack"""
        payload = {
            "status": status,
            "errorMessage": error_message,
            "leaseToken": lease_token,
        }
        return self._post(f"/api/bridge/v1/commands/{command_id}/ack", payload)

    def confirm_enrollment(self, member_id: str, enroll_number: str,
                           terminal_user_name: str = "") -> bool:
        """POST /api/bridge/v1/enrollment/confirm"""
        payload = {
            "gymId": self._gym_id,
            "memberId": member_id,
            "deviceEnrollNumber": enroll_number,
            "terminalUserName": terminal_user_name,
        }
        return self._post("/api/bridge/v1/enrollment/confirm", payload)

    def _post(self, path: str, payload: dict) -> bool:
        """POST JSON to the backend. Returns True on 2xx."""
        try:
            url = f"{self._base_url}{path}"
            resp = self._session.post(url, json=payload, timeout=DEFAULT_TIMEOUT)
            if resp.ok:
                self.last_error = ""
                return True
            self.last_error = (
                f"POST {path} returned {resp.status_code}: {resp.text[:500]}"
            )
            logger.warning(self.last_error)
            return False
        except Exception as e:
            self.last_error = f"POST {path} error: {e}"
            logger.error(self.last_error)
            return False
