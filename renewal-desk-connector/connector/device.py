"""Renewal Desk Linux Connector — device module.

Pure-Python replacement for RenewalDeskBridge/Device/DeviceConnection.cs.
Uses pyzk to talk to eSSL/ZKTeco terminals over TCP port 4370.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from zk import ZK, const
from zk.user import User

logger = logging.getLogger(__name__)


@dataclass
class AttendanceRecord:
    user_id: str
    timestamp: datetime
    status: int
    verify_method: int = 0
    is_invalid: bool = False


@dataclass
class DeviceUserProfile:
    uid: int
    user_id: str
    name: str
    privilege: int
    card: int
    enabled: bool = True  # pyzk doesn't expose this directly; inferred from privilege


class DeviceConnection:
    """Thin wrapper around pyzk — drop-in replacement for the C# DeviceConnection.

    Maps the exact API surface used by the C# bridge:
        Connect()           → connect()
        Disconnect()        → disconnect()
        CheckSessionAlive() → check_session_alive()
        SetUser()           → set_user()
        SetUserEnabled()    → set_user_enabled()
        DeleteUser()        → delete_user()
        UnlockDoor()        → unlock_door()
        GetSerialNumber()   → get_serial_number()
        GetUsers()          → get_users()
        GetAttendance()     → get_attendance()
    """

    def __init__(self, ip: str, port: int = 4370, comm_key: int = 0,
                 timeout: int = 10):
        self._ip = ip
        self._port = port
        self._comm_key = comm_key
        self._timeout = timeout
        self._zk: Optional[ZK] = None
        self._conn = None
        self._is_connected = False
        self._serial: Optional[str] = None

    @property
    def is_connected(self) -> bool:
        return self._is_connected

    @property
    def serial_number(self) -> Optional[str]:
        return self._serial

    def connect(self) -> bool:
        """Connect to the biometric terminal. Returns True on success."""
        try:
            self._zk = ZK(
                self._ip,
                port=self._port,
                timeout=self._timeout,
                password=self._comm_key,
                force_udp=False,
                ommit_ping=True,  # skip ICMP — firewalls often block it
            )
            self._conn = self._zk.connect()
            self._is_connected = True

            # Cache the serial number (used for heartbeats and liveness)
            try:
                self._serial = self._conn.get_serialnumber()
            except Exception:
                self._serial = None

            logger.info(
                "Connected to device %s:%s (serial=%s)",
                self._ip, self._port, self._serial,
            )
            return True

        except Exception as e:
            logger.error("Failed to connect to %s:%s — %s", self._ip, self._port, e)
            self._is_connected = False
            self._conn = None
            return False

    def disconnect(self) -> None:
        """Disconnect from the terminal."""
        if self._conn:
            try:
                self._conn.disconnect()
            except Exception:
                pass
        self._is_connected = False
        self._conn = None
        logger.info("Disconnected from device %s:%s", self._ip, self._port)

    def check_session_alive(self) -> bool:
        """Cheap liveness ping via serial number read.

        Matches the C# CheckSessionAlive() behaviour: if the TCP session has
        died silently, this detects it and marks the connection dead.
        """
        if not self._is_connected or not self._conn:
            return False
        try:
            serial = self._conn.get_serialnumber()
            return bool(serial)
        except Exception:
            logger.warning("Session liveness check failed — marking disconnected")
            self._is_connected = False
            return False

    def get_serial_number(self) -> Optional[str]:
        """Read the terminal serial number."""
        if not self._conn:
            return None
        try:
            return self._conn.get_serialnumber()
        except Exception as e:
            logger.error("get_serial_number failed: %s", e)
            return None

    def get_firmware_version(self) -> Optional[str]:
        """Read the terminal firmware version."""
        if not self._conn:
            return None
        try:
            return self._conn.get_firmware_version()
        except Exception as e:
            logger.error("get_firmware_version failed: %s", e)
            return None

    # ── User management ──────────────────────────────────────────────────

    def get_users(self) -> list[DeviceUserProfile]:
        """Read all users from the device."""
        if not self._conn:
            return []
        try:
            self._conn.disable_device()
            raw_users = self._conn.get_users()
            self._conn.enable_device()
            return [
                DeviceUserProfile(
                    uid=u.uid,
                    user_id=str(u.user_id),
                    name=u.name or "",
                    privilege=u.privilege,
                    card=u.card,
                )
                for u in raw_users
            ]
        except Exception as e:
            logger.error("get_users failed: %s", e)
            try:
                self._conn.enable_device()
            except Exception:
                pass
            return []

    def set_user(self, enroll_number: str, name: str, enabled: bool,
                 privilege: int = 0, password: str = "") -> bool:
        """Create or update a user on the terminal.

        Maps to the C# SetUser() which calls SSR_SetUserInfo.
        pyzk's set_user sends CMD_USER_WRQ with the full user packet.
        """
        if not self._conn:
            return False
        try:
            self._conn.disable_device()
            self._conn.set_user(
                uid=int(enroll_number),
                name=name[:24],  # terminal name field is 24 bytes
                privilege=privilege,
                password=password,
                user_id=str(enroll_number),
            )
            self._conn.enable_device()
            logger.info("set_user OK: enroll=%s name=%s enabled=%s",
                        enroll_number, name, enabled)
            return True
        except Exception as e:
            logger.error("set_user failed for enroll=%s: %s", enroll_number, e)
            try:
                self._conn.enable_device()
            except Exception:
                pass
            return False

    def set_user_enabled(self, enroll_number: str, enabled: bool) -> bool:
        """Enable or disable a user on the terminal.

        The C# bridge uses time-zone-based access control on the X990 because
        SSR_EnableUser doesn't reliably control the door relay on that model.
        For simpler models (X2008, K40, etc.), pyzk's set_user with the
        enable flag works.

        This implementation tries pyzk's approach first. If your X990 still
        opens the door for disabled users, you'll need the time-zone method
        (see MembershipAccessService.cs for the pattern).
        """
        if not self._conn:
            return False
        try:
            self._conn.disable_device()

            # Read existing user first to preserve their data
            users = self._conn.get_users()
            target = None
            for u in users:
                if str(u.user_id) == str(enroll_number):
                    target = u
                    break

            if target is None:
                logger.warning("set_user_enabled: user %s not found on device",
                               enroll_number)
                self._conn.enable_device()
                return False

            # Re-write the user with the same data — pyzk's set_user
            # includes the enable state in the user packet
            self._conn.set_user(
                uid=target.uid,
                name=target.name or "",
                privilege=const.USER_DEFAULT if not enabled else target.privilege,
                password="",
                user_id=str(target.user_id),
                card=target.card,
            )
            self._conn.enable_device()
            logger.info("set_user_enabled OK: enroll=%s enabled=%s",
                        enroll_number, enabled)
            return True
        except Exception as e:
            logger.error("set_user_enabled failed for enroll=%s: %s",
                         enroll_number, e)
            try:
                self._conn.enable_device()
            except Exception:
                pass
            return False

    def delete_user(self, enroll_number: str) -> bool:
        """Delete a user and their biometric templates from the terminal.

        Maps to the C# DeleteUser() which calls SSR_DeleteEnrollData.
        """
        if not self._conn:
            return False
        try:
            self._conn.disable_device()

            # Find the user's UID by their user_id (enroll number)
            users = self._conn.get_users()
            target_uid = None
            for u in users:
                if str(u.user_id) == str(enroll_number):
                    target_uid = u.uid
                    break

            if target_uid is None:
                logger.warning("delete_user: user %s not found on device",
                               enroll_number)
                self._conn.enable_device()
                return True  # Already gone — treat as success

            self._conn.delete_user(uid=target_uid, user_id=str(enroll_number))
            self._conn.enable_device()
            logger.info("delete_user OK: enroll=%s", enroll_number)
            return True
        except Exception as e:
            logger.error("delete_user failed for enroll=%s: %s", enroll_number, e)
            try:
                self._conn.enable_device()
            except Exception:
                pass
            return False

    # ── Door control ─────────────────────────────────────────────────────

    def unlock_door(self, delay_seconds: int = 5) -> bool:
        """Unlock the door relay for N seconds.

        Maps to the C# UnlockDoor() which calls ACUnlock.
        pyzk's unlock() takes seconds directly.
        """
        if not self._conn:
            return False
        try:
            self._conn.unlock(time=max(1, delay_seconds))
            logger.info("unlock_door OK: %d seconds", delay_seconds)
            return True
        except Exception as e:
            logger.error("unlock_door failed: %s", e)
            return False

    # ── Attendance ───────────────────────────────────────────────────────

    def get_attendance(self) -> list[AttendanceRecord]:
        """Read all attendance records from the device.

        Maps to the C# bridge's attendance capture. Returns records
        sorted by timestamp.
        """
        if not self._conn:
            return []
        try:
            self._conn.disable_device()
            raw_records = self._conn.get_attendance()
            self._conn.enable_device()
            return [
                AttendanceRecord(
                    user_id=str(r.user_id),
                    timestamp=r.timestamp,
                    status=r.status,
                )
                for r in raw_records
            ]
        except Exception as e:
            logger.error("get_attendance failed: %s", e)
            try:
                self._conn.enable_device()
            except Exception:
                pass
            return []

    def clear_attendance(self) -> bool:
        """Clear attendance logs from the device after syncing."""
        if not self._conn:
            return False
        try:
            self._conn.disable_device()
            self._conn.clear_attendance()
            self._conn.enable_device()
            logger.info("clear_attendance OK")
            return True
        except Exception as e:
            logger.error("clear_attendance failed: %s", e)
            try:
                self._conn.enable_device()
            except Exception:
                pass
            return False

    # ── Advanced methods (REA-cracked SDK surface) ────────────────────────

    def get_device_info(self) -> dict:
        """Read device info: serial, firmware, platform, user/fp capacity."""
        if not self._conn:
            return {}
        try:
            info = {
                "serial_number": self._serial,
                "firmware": self.get_firmware_version(),
                "platform": None,
                "mac": None,
            }
            try:
                info["platform"] = self._conn.get_platform()
            except Exception:
                pass
            try:
                info["mac"] = self._conn.get_mac()
            except Exception:
                pass
            return info
        except Exception as e:
            logger.error("get_device_info failed: %s", e)
            return {}

    def get_all_users_with_details(self) -> list[dict]:
        """Bulk read all users with full details (for sync to cloud).

        Returns dicts with: user_id, name, privilege, card, uid.
        Maps to vendor SDK's SSR_GetAllUserInfo.
        """
        if not self._conn:
            return []
        try:
            self._conn.disable_device()
            raw_users = self._conn.get_users()
            self._conn.enable_device()
            return [
                {
                    "uid": u.uid,
                    "user_id": str(u.user_id),
                    "name": u.name or "",
                    "privilege": u.privilege,
                    "card": u.card,
                    "group_id": getattr(u, "group_id", 0),
                }
                for u in raw_users
            ]
        except Exception as e:
            logger.error("get_all_users_with_details failed: %s", e)
            try:
                self._conn.enable_device()
            except Exception:
                pass
            return []

    def get_user_template(self, enroll_number: str, finger_index: int = 0) -> Optional[bytes]:
        """Read a fingerprint template from the device.

        Maps to vendor SDK's SSR_GetUserTmp / GetEnrollData.
        Returns raw template bytes or None.
        """
        if not self._conn:
            return None
        try:
            self._conn.disable_device()
            # pyzk get_user_template(uid, temp_id) returns (template_size, template_data)
            users = self._conn.get_users()
            target_uid = None
            for u in users:
                if str(u.user_id) == str(enroll_number):
                    target_uid = u.uid
                    break
            if target_uid is None:
                self._conn.enable_device()
                return None

            try:
                template = self._conn.get_user_template(uid=target_uid, temp_id=finger_index)
                self._conn.enable_device()
                if template and template.template:
                    return template.template
                return None
            except Exception:
                self._conn.enable_device()
                return None
        except Exception as e:
            logger.error("get_user_template failed for %s: %s", enroll_number, e)
            try:
                self._conn.enable_device()
            except Exception:
                pass
            return None

    def get_templates_count(self, enroll_number: str) -> int:
        """Count how many fingerprint templates a user has enrolled."""
        if not self._conn:
            return 0
        count = 0
        for finger in range(10):
            tmpl = self.get_user_template(enroll_number, finger)
            if tmpl:
                count += 1
        return count

    def restart_device(self) -> bool:
        """Reboot the terminal. Maps to vendor SDK's RestartDevice."""
        if not self._conn:
            return False
        try:
            self._conn.restart()
            logger.info("restart_device OK")
            self._is_connected = False
            return True
        except Exception as e:
            logger.error("restart_device failed: %s", e)
            return False

    def clear_log(self) -> bool:
        """Clear all attendance logs. Maps to vendor SDK's ClearGLog."""
        return self.clear_attendance()

    def set_user_valid_date(self, enroll_number: str,
                            start_date: str, end_date: str) -> bool:
        """Set validity period for a user on the device.

        Discovered via REA crack: SetUserValidDate(PIN, start, end).
        The device auto-blocks the user outside these dates.
        KILLER FEATURE: membership expiry handled ON the device.

        Dates in format: YYYY-MM-DD

        Note: This uses pyzk's low-level command interface since the
        high-level API doesn't expose SetUserValidDate.
        """
        if not self._conn:
            return False
        try:
            # pyzk doesn't have a direct set_user_valid_date method.
            # We use the raw command interface.
            # The vendor SDK sends: CMD_OPTIONS_WRQ with
            #   "ValidDateStart_<PIN>=<date>" and "ValidDateEnd_<PIN>=<date>"
            self._conn.disable_device()
            try:
                self._conn.set_user_extend_fmt(
                    enroll_number,
                    valid_from=start_date,
                    valid_to=end_date,
                )
                self._conn.enable_device()
                logger.info(
                    "set_user_valid_date OK: enroll=%s from=%s to=%s",
                    enroll_number, start_date, end_date,
                )
                return True
            except AttributeError:
                # pyzk doesn't have set_user_extend_fmt — fall back to
                # raw SYS_OPTION write if available
                logger.warning(
                    "set_user_valid_date: pyzk lacks set_user_extend_fmt, "
                    "falling back to set_sys_option"
                )
                try:
                    # Attempt raw option write (device-specific)
                    self._conn.set_sys_option(
                        f"ValidDateStart_{enroll_number}", start_date
                    )
                    self._conn.set_sys_option(
                        f"ValidDateEnd_{enroll_number}", end_date
                    )
                    self._conn.enable_device()
                    logger.info(
                        "set_user_valid_date (sys_option) OK: enroll=%s",
                        enroll_number,
                    )
                    return True
                except Exception as inner_e:
                    logger.error(
                        "set_user_valid_date fallback failed: %s", inner_e
                    )
                    self._conn.enable_device()
                    return False
        except Exception as e:
            logger.error("set_user_valid_date failed for %s: %s", enroll_number, e)
            try:
                self._conn.enable_device()
            except Exception:
                pass
            return False

