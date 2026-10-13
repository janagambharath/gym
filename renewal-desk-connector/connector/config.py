"""Renewal Desk Linux Connector — config module."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


@dataclass
class ConnectorConfig:
    """All config comes from environment variables or a .env file."""

    # ── Device ───────────────────────────────────────────────────────────
    device_ip: str = ""
    device_port: int = 4370
    device_comm_key: int = 0
    device_machine_number: int = 1

    # ── Cloud API ────────────────────────────────────────────────────────
    api_base_url: str = ""
    api_key: str = ""
    gym_id: str = ""          # public_id from BridgeInstallation
    device_serial: str = ""   # terminal serial number

    # ── Intervals (seconds) ──────────────────────────────────────────────
    heartbeat_interval: int = 30
    command_poll_interval: int = 5
    attendance_flush_interval: int = 60
    reconnect_backoff_base: int = 5
    reconnect_backoff_max: int = 300

    # ── Logging ──────────────────────────────────────────────────────────
    log_level: str = "INFO"
    log_file: str = ""

    @classmethod
    def from_env(cls, env_file: str | None = None) -> ConnectorConfig:
        """Load config from environment variables, with optional .env file."""
        if env_file:
            load_dotenv(env_file)
        else:
            # Try .env in the connector directory, then cwd
            for candidate in [Path(__file__).parent.parent / ".env", Path.cwd() / ".env"]:
                if candidate.exists():
                    load_dotenv(candidate)
                    break

        def _env(key: str, default: str = "") -> str:
            return os.environ.get(key, default).strip()

        def _int(key: str, default: int = 0) -> int:
            raw = _env(key, str(default))
            try:
                return int(raw)
            except ValueError:
                return default

        return cls(
            device_ip=_env("DEVICE_IP"),
            device_port=_int("DEVICE_PORT", 4370),
            device_comm_key=_int("DEVICE_COMM_KEY", 0),
            device_machine_number=_int("DEVICE_MACHINE_NUMBER", 1),
            api_base_url=_env("API_BASE_URL"),
            api_key=_env("API_KEY"),
            gym_id=_env("GYM_ID"),
            device_serial=_env("DEVICE_SERIAL"),
            heartbeat_interval=_int("HEARTBEAT_INTERVAL", 30),
            command_poll_interval=_int("COMMAND_POLL_INTERVAL", 5),
            attendance_flush_interval=_int("ATTENDANCE_FLUSH_INTERVAL", 60),
            reconnect_backoff_base=_int("RECONNECT_BACKOFF_BASE", 5),
            reconnect_backoff_max=_int("RECONNECT_BACKOFF_MAX", 300),
            log_level=_env("LOG_LEVEL", "INFO"),
            log_file=_env("LOG_FILE"),
        )

    def validate(self) -> list[str]:
        """Return a list of validation errors. Empty = valid."""
        errors = []
        if not self.device_ip:
            errors.append("DEVICE_IP is required")
        if not self.api_base_url:
            errors.append("API_BASE_URL is required")
        if not self.api_key:
            errors.append("API_KEY is required")
        if not self.gym_id:
            errors.append("GYM_ID is required")
        if not self.device_serial:
            errors.append("DEVICE_SERIAL is required")
        return errors
