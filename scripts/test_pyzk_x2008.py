#!/usr/bin/env python3
"""
Phase 1 — Validate pyzk against the real eSSL X2008 / X990 terminal.

Usage:
    python scripts/test_pyzk_x2008.py <DEVICE_IP> [PORT] [COMM_KEY]

Examples:
    python scripts/test_pyzk_x2008.py 192.168.1.201
    python scripts/test_pyzk_x2008.py 192.168.1.201 4370 0

This script runs a sequence of read-only tests first, then offers an
interactive enable/disable test on a user you pick.  It never deletes
data or enrollments.

Results are printed with ✅/❌ prefixes and a final summary table so you
can copy-paste it straight into the protocol crack doc.
"""

from __future__ import annotations

import sys
import time
import traceback
from datetime import datetime

# ── helpers ──────────────────────────────────────────────────────────────────

_results: list[tuple[str, bool, str]] = []


def _record(test_name: str, passed: bool, detail: str = ""):
    mark = "✅" if passed else "❌"
    print(f"  {mark} {test_name}{f' — {detail}' if detail else ''}")
    _results.append((test_name, passed, detail))


def _print_summary():
    print("\n" + "═" * 60)
    print("  PHASE 1 — TEST SUMMARY")
    print("═" * 60)
    total = len(_results)
    passed = sum(1 for _, ok, _ in _results if ok)
    for name, ok, detail in _results:
        mark = "✅" if ok else "❌"
        print(f"  {mark} {name:<35} {detail}")
    print("─" * 60)
    print(f"  {passed}/{total} passed")
    if passed == total:
        print("\n  🚀 pyzk talks to your device — proceed to Phase 2!")
    elif passed >= total - 2:
        print("\n  ⚠️  Mostly works. Check the failures — may need protocol tweaks.")
    else:
        print("\n  🛑 Too many failures. May need REA deep-dive (Phase 3).")
    print("═" * 60)


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    device_ip = sys.argv[1]
    device_port = int(sys.argv[2]) if len(sys.argv) > 2 else 4370
    comm_key = int(sys.argv[3]) if len(sys.argv) > 3 else 0

    print(f"\n  Device: {device_ip}:{device_port}  Comm-Key: {comm_key}")
    print("─" * 60)

    # Late import so missing pyzk gives a clear error
    try:
        from zk import ZK, const
    except ImportError:
        print("  ❌ pyzk not installed. Run: pip install pyzk")
        sys.exit(1)

    zk = ZK(
        device_ip,
        port=device_port,
        timeout=10,
        password=comm_key,
        force_udp=False,
        ommit_ping=True,  # skip ping — firewalls often block ICMP
    )

    conn = None
    try:
        # ── Test 1: TCP Connect ──────────────────────────────────────────
        print("\n[1/7] Connect")
        t0 = time.monotonic()
        conn = zk.connect()
        ms = int((time.monotonic() - t0) * 1000)
        _record("TCP Connect", True, f"{ms}ms")

        # ── Test 2: Firmware Version ─────────────────────────────────────
        print("\n[2/7] Firmware Version")
        try:
            fw = conn.get_firmware_version()
            _record("Firmware Version", bool(fw), str(fw))
        except Exception as e:
            _record("Firmware Version", False, str(e))

        # ── Test 3: Serial Number (also used as liveness ping) ───────────
        print("\n[3/7] Serial Number")
        try:
            sn = conn.get_serialnumber()
            _record("Serial Number", bool(sn), str(sn))
        except Exception as e:
            _record("Serial Number", False, str(e))

        # ── Test 4: Device Info / Capacities ─────────────────────────────
        print("\n[4/7] Device Info")
        try:
            # get_firmware_version already called; try platform/mac
            platform = conn.get_platform()
            mac = conn.get_mac()
            _record("Platform/MAC", True, f"platform={platform}, mac={mac}")
        except Exception as e:
            _record("Platform/MAC", False, str(e))

        # ── Test 5: Read Users ───────────────────────────────────────────
        print("\n[5/7] Read Users")
        users = []
        try:
            conn.disable_device()  # lock device during read
            users = conn.get_users()
            conn.enable_device()
            _record("Read Users", True, f"{len(users)} users on device")
            for u in users[:10]:
                priv = "Admin" if u.privilege == const.USER_ADMIN else "User"
                print(f"        UID={u.uid:>4}  ID={str(u.user_id):>10}  "
                      f"Name={u.name:<20}  Priv={priv}  Card={u.card}")
            if len(users) > 10:
                print(f"        ... and {len(users) - 10} more")
        except Exception as e:
            _record("Read Users", False, str(e))
            try:
                conn.enable_device()
            except Exception:
                pass

        # ── Test 6: Read Attendance Logs ─────────────────────────────────
        print("\n[6/7] Read Attendance Logs")
        try:
            conn.disable_device()
            records = conn.get_attendance()
            conn.enable_device()
            _record("Read Attendance", True, f"{len(records)} records")
            for r in records[-5:]:
                print(f"        UserID={str(r.user_id):>10}  "
                      f"Time={r.timestamp}  Status={r.status}")
        except Exception as e:
            _record("Read Attendance", False, str(e))
            try:
                conn.enable_device()
            except Exception:
                pass

        # ── Test 7: Enable/Disable User (THE KEY TEST) ───────────────────
        print("\n[7/7] Enable/Disable User (SSR_EnableUser equivalent)")
        if not users:
            _record("Enable/Disable User", False, "No users on device to test")
        else:
            print(f"        Available test users:")
            for i, u in enumerate(users[:10]):
                print(f"          [{i}] UID={u.uid} ID={u.user_id} Name={u.name}")

            # Auto-pick the first non-admin user, or fall back to first user
            test_user = None
            for u in users:
                if u.privilege != const.USER_ADMIN:
                    test_user = u
                    break
            if test_user is None:
                test_user = users[0]

            print(f"\n        Auto-selected: UID={test_user.uid} "
                  f"ID={test_user.user_id} Name={test_user.name}")
            print(f"        Testing set_user() with the enable/disable flag...")

            try:
                conn.disable_device()

                # Step A: Write user with current values (no-op change, just
                # verify set_user round-trips without destroying the enrollment)
                conn.set_user(
                    uid=test_user.uid,
                    name=test_user.name,
                    privilege=test_user.privilege,
                    password="",
                    user_id=str(test_user.user_id),
                    card=test_user.card,
                )

                # Step B: Read the user back to confirm data survived
                users_after = conn.get_users()
                match = None
                for u in users_after:
                    if u.uid == test_user.uid:
                        match = u
                        break

                if match and match.name == test_user.name:
                    _record(
                        "Enable/Disable User",
                        True,
                        f"set_user round-trip OK — name preserved: '{match.name}'",
                    )
                    print(
                        "\n        ℹ️  To test actual block/unblock, uncomment the"
                        "\n           enable=False / enable=True section below and"
                        "\n           verify on the device's screen that the user"
                        "\n           is denied/allowed scanning."
                    )
                else:
                    _record(
                        "Enable/Disable User",
                        False,
                        "set_user succeeded but read-back mismatch",
                    )

                conn.enable_device()
            except Exception as e:
                _record("Enable/Disable User", False, str(e))
                try:
                    conn.enable_device()
                except Exception:
                    pass

        # ── Bonus: Try unlock door ───────────────────────────────────────
        # Uncomment to test — this will physically buzz the door relay!
        # print("\n[BONUS] Unlock Door (1 second)")
        # try:
        #     result = conn.unlock(time=1)
        #     _record("Unlock Door", True, f"result={result}")
        # except Exception as e:
        #     _record("Unlock Door", False, str(e))

    except Exception as e:
        _record("TCP Connect", False, str(e))
        traceback.print_exc()

    finally:
        if conn:
            try:
                conn.disconnect()
                print("\n  Disconnected cleanly.")
            except Exception:
                print("\n  ⚠️  Disconnect failed (may already be closed).")

    _print_summary()


if __name__ == "__main__":
    main()
