"""Renewal Desk Linux Connector — main command loop.

Replaces BridgeForm.cs:
    - CommandPollLoopAsync → poll_commands()
    - ProcessPendingCommandAsync → _process_command()
    - ExecuteCommand → _execute_command()
    - HeartbeatLoopAsync → heartbeat_loop()
    - RetryFlushLoopAsync → attendance_sync_loop()
"""

from __future__ import annotations

import hashlib
import logging
import signal
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from .cloud_api import CloudApiClient, PendingCommand
from .config import ConnectorConfig
from .device import DeviceConnection

logger = logging.getLogger(__name__)


# ── Local receipt store (in-memory, matches C# LocalOutbox) ──────────────────

_command_receipts: dict[str, dict] = {}
_receipt_lock = threading.Lock()


def _get_receipt(command_id: str) -> Optional[dict]:
    with _receipt_lock:
        return _command_receipts.get(command_id)


def _save_receipt(command_id: str, receipt: dict) -> None:
    with _receipt_lock:
        _command_receipts[command_id] = receipt


# ── Command execution ────────────────────────────────────────────────────────

def _execute_command(device: DeviceConnection, cmd: PendingCommand) -> tuple[bool, str]:
    """Execute a single command on the device. Returns (success, message).

    Original C# commands:
        enable_user  → set_user_enabled(enroll, True)
        disable_user → set_user_enabled(enroll, False)
        create_user  → set_user(enroll, name, True)
        delete_user  → delete_user(enroll)
        unlock_door  → unlock_door(delay)

    Advanced commands (REA-cracked):
        set_valid_date → set_user_valid_date(enroll, from, to)
        sync_users     → get_all_users_with_details() → return as JSON
        device_info    → get_device_info() → return as JSON
        restart        → restart_device()
        clear_log      → clear_log()
    """
    import json

    cmd_type = cmd.command_type
    enroll = cmd.enroll_number

    if cmd_type == "enable_user":
        ok = device.set_user_enabled(enroll, enabled=True)
        return ok, "User enabled." if ok else _device_error("enable")

    elif cmd_type == "disable_user":
        ok = device.set_user_enabled(enroll, enabled=False)
        return ok, "User disabled." if ok else _device_error("disable")

    elif cmd_type == "create_user":
        name = cmd.member_name or "Member"
        ok = device.set_user(enroll, name, enabled=True)
        return ok, "User created/updated." if ok else _device_error("create")

    elif cmd_type == "delete_user":
        ok = device.delete_user(enroll)
        return ok, "User deleted." if ok else _device_error("delete")

    elif cmd_type == "unlock_door":
        delay = cmd.delay_seconds or 5
        ok = device.unlock_door(delay)
        return ok, f"Door unlocked for {delay}s." if ok else _device_error("unlock")

    elif cmd_type == "set_valid_date":
        if not cmd.valid_from or not cmd.valid_to:
            return False, "Missing valid_from or valid_to date."
        ok = device.set_user_valid_date(enroll, cmd.valid_from, cmd.valid_to)
        return ok, (
            f"Validity set: {cmd.valid_from} to {cmd.valid_to}"
            if ok else _device_error("set_valid_date")
        )

    elif cmd_type == "sync_users":
        users = device.get_all_users_with_details()
        return True, json.dumps({"users": users, "count": len(users)})

    elif cmd_type == "device_info":
        info = device.get_device_info()
        return True, json.dumps(info)

    elif cmd_type == "restart":
        ok = device.restart_device()
        return ok, "Device restarting." if ok else _device_error("restart")

    elif cmd_type == "clear_log":
        ok = device.clear_log()
        return ok, "Attendance logs cleared." if ok else _device_error("clear_log")

    else:
        return False, f"Unknown command type: {cmd_type}"


def _device_error(action: str) -> str:
    return f"The biometric device rejected the {action} command."


# ── Main loops ───────────────────────────────────────────────────────────────

class ConnectorLoop:
    """The main connector loop — replaces BridgeForm.cs event loops."""

    def __init__(self, config: ConnectorConfig):
        self.config = config
        self.device = DeviceConnection(
            ip=config.device_ip,
            port=config.device_port,
            comm_key=config.device_comm_key,
            timeout=10,
        )
        self.api: Optional[CloudApiClient] = None
        self._stop_event = threading.Event()
        self._reconnect_attempt = 0

    def start(self) -> None:
        """Start all loops. Blocks until stopped."""
        logger.info("═" * 60)
        logger.info("  Renewal Desk Linux Connector starting")
        logger.info("  Device: %s:%s", self.config.device_ip, self.config.device_port)
        logger.info("  Backend: %s", self.config.api_base_url)
        logger.info("═" * 60)

        # Connect to device
        if not self._connect_device():
            logger.error("Initial device connection failed. Will retry...")

        # Init cloud API client
        self.api = CloudApiClient(
            base_url=self.config.api_base_url,
            api_key=self.config.api_key,
            gym_id=self.config.gym_id,
            device_serial=self.config.device_serial,
        )

        # Start threads
        heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop, daemon=True, name="heartbeat"
        )
        command_thread = threading.Thread(
            target=self._command_poll_loop, daemon=True, name="commands"
        )
        attendance_thread = threading.Thread(
            target=self._attendance_poll_loop, daemon=True, name="attendance"
        )
        liveness_thread = threading.Thread(
            target=self._liveness_loop, daemon=True, name="liveness"
        )

        heartbeat_thread.start()
        command_thread.start()
        attendance_thread.start()
        liveness_thread.start()

        # Block main thread until stop signal
        try:
            while not self._stop_event.is_set():
                self._stop_event.wait(timeout=1)
        except KeyboardInterrupt:
            logger.info("Interrupted — shutting down...")
        finally:
            self.stop()

    def stop(self) -> None:
        """Stop all loops and disconnect."""
        self._stop_event.set()
        self.device.disconnect()
        logger.info("Connector stopped.")

    def _connect_device(self) -> bool:
        """Connect to the biometric terminal with exponential backoff."""
        if self.device.is_connected:
            return True

        while not self._stop_event.is_set():
            if self.device.connect():
                self._reconnect_attempt = 0
                return True

            self._reconnect_attempt += 1
            backoff = min(
                self.config.reconnect_backoff_base * (2 ** (self._reconnect_attempt - 1)),
                self.config.reconnect_backoff_max,
            )
            logger.warning(
                "Device connection failed (attempt %d). Retrying in %ds...",
                self._reconnect_attempt, backoff,
            )
            self._stop_event.wait(timeout=backoff)

        return False

    def _heartbeat_loop(self) -> None:
        """Send periodic heartbeats to the Railway backend."""
        while not self._stop_event.is_set():
            try:
                if self.api:
                    status = "online" if self.device.is_connected else "disconnected"
                    ok = self.api.send_heartbeat(status)
                    if not ok:
                        logger.warning("Heartbeat failed: %s", self.api.last_error)
                    else:
                        logger.debug("Heartbeat sent: %s", status)
            except Exception as e:
                logger.error("Heartbeat loop error: %s", e)

            self._stop_event.wait(timeout=self.config.heartbeat_interval)

    def _command_poll_loop(self) -> None:
        """Poll the backend for pending commands and execute them.

        Matches C# CommandPollLoopAsync + ProcessPendingCommandAsync.
        """
        while not self._stop_event.is_set():
            try:
                if self.api and self.device.is_connected:
                    commands = self.api.get_pending_commands()
                    for cmd in commands:
                        self._process_command(cmd)
            except Exception as e:
                logger.error("Command poll error: %s", e)

            self._stop_event.wait(timeout=self.config.command_poll_interval)

    def _process_command(self, cmd: PendingCommand) -> None:
        """Process a single pending command.

        Matches C# ProcessPendingCommandAsync exactly:
        1. Check for redelivery (already-executed command)
        2. Execute on device
        3. Save local receipt
        4. ACK to backend
        """
        if not cmd.id or not cmd.lease_token:
            logger.warning("Skipping command with missing id or lease_token")
            return

        # Check for redelivery
        existing_receipt = _get_receipt(cmd.id)
        is_redelivery = existing_receipt is not None

        if not is_redelivery:
            # Execute the command on the device
            success, message = _execute_command(self.device, cmd)
            receipt = {
                "command_id": cmd.id,
                "command_type": cmd.command_type,
                "enroll_number": cmd.enroll_number,
                "status": "acked" if success else "failed",
                "message": message,
                "lease_token": cmd.lease_token,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
            _save_receipt(cmd.id, receipt)
        else:
            receipt = existing_receipt

        # ACK to the backend. For sync_users, the message IS the terminal user
        # list JSON — ship it as resultData so the backend can suggest
        # enroll-number matches ("which terminal user is which member?").
        result_data = None
        if cmd.command_type == "sync_users" and receipt["status"] == "acked":
            msg = receipt.get("message") or ""
            result_data = msg if msg.strip().startswith("{") else None
        acked = self.api.ack_command(
            command_id=cmd.id,
            status=receipt["status"],
            error_message=receipt["message"] if receipt["status"] == "failed" else None,
            lease_token=cmd.lease_token,
            result_data=result_data,
        )

        outcome = "OK" if receipt["status"] == "acked" else "FAILED"
        redelivery_note = " (redelivery — not re-executed)" if is_redelivery else ""
        ack_note = "ACK sent" if acked else "ACK failed — receipt saved for retry"

        logger.info(
            "Command %s %s for %s: %s — %s%s. %s",
            cmd.id[:8], cmd.command_type, cmd.enroll_number,
            outcome, receipt.get("message", ""), redelivery_note, ack_note,
        )

    def _liveness_loop(self) -> None:
        """Periodically check device connection and auto-reconnect.

        Matches C# CheckSessionAlive + ReconnectDeviceWithBackoffAsync.
        """
        while not self._stop_event.is_set():
            try:
                if self.device.is_connected:
                    if not self.device.check_session_alive():
                        logger.warning("Device session died — reconnecting...")
                        self.device.disconnect()
                        self._connect_device()
                else:
                    self._connect_device()
            except Exception as e:
                logger.error("Liveness check error: %s", e)

            self._stop_event.wait(timeout=30)

    def _attendance_poll_loop(self) -> None:
        """Poll the device for attendance punches and send them to the cloud.

        Matches C# AttendanceCaptureTask + ProcessAttendanceRecordAsync.
        Continuously pulls punches from the biometric terminal and streams them
        to the Railway cloud backend in real time.
        """
        synced_receipts: set[str] = set()
        while not self._stop_event.is_set():
            try:
                if self.api and self.device.is_connected:
                    records = self.device.get_attendance()
                    if records:
                        synced_count = 0
                        for rec in records:
                            ts_str = (
                                rec.timestamp.strftime("%Y%m%d%H%M%S")
                                if hasattr(rec.timestamp, "strftime")
                                else str(rec.timestamp)
                            )
                            event_id = f"{rec.user_id}_{ts_str}"
                            if event_id in synced_receipts:
                                continue

                            ok = self.api.send_attendance(
                                event_id=event_id,
                                enroll_number=str(rec.user_id),
                                event_time=rec.timestamp,
                                verify_method=getattr(rec, "verify_method", 1),
                                att_state=getattr(rec, "status", 0),
                                is_invalid=getattr(rec, "is_invalid", False),
                            )
                            if ok:
                                synced_receipts.add(event_id)
                                synced_count += 1
                                if len(synced_receipts) > 10000:
                                    synced_receipts = set(list(synced_receipts)[-5000:])
                        if synced_count > 0:
                            logger.info("Uploaded %d attendance punch(es) to cloud", synced_count)
            except Exception as e:
                logger.error("Attendance sync error: %s", e)

            flush_interval = getattr(self.config, "attendance_flush_interval", 15)
            self._stop_event.wait(timeout=max(5, flush_interval))

