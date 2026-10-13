"""Renewal Desk Connector — Windows system tray application.

Dead-simple onboarding:
  1. Owner gets 6-digit pairing code from Renewal Desk mobile app (More -> Access Control)
  2. Downloads & double-clicks RenewalDeskConnector.exe on gym PC
  3. Quick setup window appears: enter Pairing Code + Device IP
  4. Done. Sits quietly in Windows System Tray with live status & mobile control.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
import webbrowser
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

try:
    import pystray
    from PIL import Image, ImageDraw
    HAS_TRAY = True
except ImportError:
    HAS_TRAY = False

from connector.command_loop import ConnectorLoop
from connector.config import ConnectorConfig


# ── Tray icons ───────────────────────────────────────────────────────────────

def _icon(color):
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([8, 8, 56, 56], fill=color)
    return img

def green_icon(): return _icon((34, 197, 94))
def red_icon(): return _icon((239, 68, 68))
def yellow_icon(): return _icon((234, 179, 8))


# ── Config directory ─────────────────────────────────────────────────────────

CONFIG_DIR = Path.home() / ".renewal-desk"
ENV_FILE = CONFIG_DIR / ".env"
LOG_FILE = CONFIG_DIR / "connector.log"


# ── Pairing (Dead simple onboarding) ─────────────────────────────────────────

def pair_with_code(pairing_code: str, device_ip: str, 
                   device_port: int = 4370, server_url: str = "") -> dict | None:
    """Exchange 6-digit pairing code for permanent credentials.
    
    Reads serial from device if available, otherwise generates identifier.
    """
    serial = None
    try:
        from connector.device import DeviceConnection
        dev = DeviceConnection(ip=device_ip, port=device_port, timeout=4)
        if dev.connect():
            serial = dev.get_serial_number()
            dev.disconnect()
    except Exception as e:
        logger.warning(f"Could not read serial from device {device_ip}: {e}")

    if not serial:
        serial = f"DEV-{device_ip.replace('.', '')}"

    servers = []
    if server_url and server_url.strip():
        servers.append(server_url.strip().rstrip("/"))
    servers.extend([
        "https://renewaldesk.up.railway.app",
        "https://app.renewaldesk.in",
        "http://localhost:5000",
    ])
    seen = set()
    unique_servers = []
    for s in servers:
        if s and s not in seen:
            seen.add(s)
            unique_servers.append(s)

    for base_url in unique_servers:
        try:
            resp = requests.post(
                f"{base_url}/api/bridge/v2/pair",
                json={
                    "pairingCode": pairing_code.strip(),
                    "deviceSerial": serial,
                    "deviceName": f"eSSL Terminal ({device_ip})",
                },
                timeout=10,
            )
            if resp.ok:
                data = resp.json()
                if data.get("ok") or data.get("success"):
                    res = data.get("data") if isinstance(data.get("data"), dict) else data
                    result = dict(res)
                    result["apiBaseUrl"] = base_url
                    result["deviceSerial"] = result.get("deviceSerial") or serial
                    return result
        except Exception as e:
            logger.debug(f"Pair attempt at {base_url} failed: {e}")
            continue

    return None


def save_config(device_ip: str, device_port: int, result: dict, serial: str) -> None:
    """Save paired config to ~/.renewal-desk/.env"""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.write(f"DEVICE_IP={device_ip}\n")
        f.write(f"DEVICE_PORT={device_port}\n")
        f.write(f"DEVICE_COMM_KEY=0\n")
        f.write(f"API_BASE_URL={result['apiBaseUrl']}\n")
        f.write(f"API_KEY={result.get('apiKey', '')}\n")
        f.write(f"GYM_ID={result.get('gymId', '')}\n")
        f.write(f"DEVICE_SERIAL={serial}\n")
        f.write(f"LOG_LEVEL=INFO\n")
        f.write(f"LOG_FILE={LOG_FILE}\n")


def first_run_setup_gui() -> ConnectorConfig | None:
    """Dead-simple GUI setup dialog using Tkinter.
    
    Perfect for double-clicking the .exe on Windows (no console needed).
    """
    try:
        import tkinter as tk
        from tkinter import messagebox
    except ImportError:
        return None

    paired_config = [None]

    root = tk.Tk()
    root.title("Renewal Desk — Biometric Connector Setup")
    root.geometry("460x380")
    root.resizable(False, False)

    # Center on screen
    root.eval('tk::PlaceWindow . center')

    # Styling
    bg_color = "#f8fafc"
    root.configure(bg=bg_color)

    title_frame = tk.Frame(root, bg=bg_color)
    title_frame.pack(fill="x", padx=24, pady=(20, 10))

    tk.Label(
        title_frame,
        text="Renewal Desk Connector",
        font=("Segoe UI", 15, "bold"),
        fg="#0f172a",
        bg=bg_color,
    ).pack(anchor="w")

    tk.Label(
        title_frame,
        text="Get your 6-digit code from the mobile app (Settings → Access Control).",
        font=("Segoe UI", 9),
        fg="#64748b",
        bg=bg_color,
    ).pack(anchor="w", pady=(2, 0))

    form_frame = tk.Frame(root, bg=bg_color)
    form_frame.pack(fill="both", expand=True, padx=24, pady=10)

    # Field 1: Pairing Code
    tk.Label(form_frame, text="6-Digit Pairing Code:", font=("Segoe UI", 10, "bold"), fg="#1e293b", bg=bg_color).pack(anchor="w", pady=(6, 2))
    code_entry = tk.Entry(form_frame, font=("Segoe UI", 13), width=24)
    code_entry.pack(anchor="w", ipady=3)
    code_entry.focus_set()

    # Field 2: Device IP
    tk.Label(form_frame, text="Biometric Device IP Address:", font=("Segoe UI", 10, "bold"), fg="#1e293b", bg=bg_color).pack(anchor="w", pady=(10, 2))
    ip_entry = tk.Entry(form_frame, font=("Segoe UI", 11), width=24)
    ip_entry.insert(0, "192.168.1.201")
    ip_entry.pack(anchor="w", ipady=3)

    # Status / Info Label
    status_label = tk.Label(form_frame, text="", font=("Segoe UI", 9), fg="#dc2626", bg=bg_color)
    status_label.pack(anchor="w", pady=(12, 0))

    def on_pair():
        code = code_entry.get().strip()
        ip = ip_entry.get().strip() or "192.168.1.201"

        if not code or len(code) < 6:
            status_label.config(text="Please enter a valid 6-digit pairing code.", fg="#dc2626")
            return

        status_label.config(text="Connecting to biometric device and pairing with cloud...", fg="#2563eb")
        root.update()

        result = pair_with_code(code, ip)
        if not result:
            status_label.config(text="Pairing failed. Check code or verify internet connection.", fg="#dc2626")
            return

        serial = result.get("deviceSerial", f"DEV-{ip.replace('.', '')}")
        save_config(ip, 4370, result, serial)
        paired_config[0] = ConnectorConfig.from_env(str(ENV_FILE))

        messagebox.showinfo(
            "Success!",
            f"Paired successfully with {result.get('gymName', 'Renewal Desk')}!\n\n"
            f"The connector will now run silently in your Windows System Tray.",
        )
        root.destroy()

    btn_frame = tk.Frame(root, bg=bg_color)
    btn_frame.pack(fill="x", padx=24, pady=(0, 20))

    pair_btn = tk.Button(
        btn_frame,
        text="Pair & Start Connector",
        font=("Segoe UI", 10, "bold"),
        bg="#16a34a",
        fg="white",
        activebackground="#15803d",
        activeforeground="white",
        relief="flat",
        padx=18,
        pady=8,
        cursor="hand2",
        command=on_pair,
    )
    pair_btn.pack(side="left")

    root.mainloop()
    return paired_config[0]


def first_run_setup_cli() -> ConnectorConfig:
    """CLI fallback when running from a console with stdin attached."""
    print()
    print("╔════════════════════════════════════════════════╗")
    print("║   Renewal Desk — Biometric Device Connector   ║")
    print("╚════════════════════════════════════════════════╝")
    print()
    print("  Open the Renewal Desk app on your phone:")
    print("  Settings → Access Control → Bridge Pairing Code")
    print()

    pairing_code = input("  Pairing code (6 digits): ").strip()
    if not pairing_code:
        print("\n  ❌ No pairing code entered.")
        sys.exit(1)

    device_ip = input("  Device IP [192.168.1.201]: ").strip() or "192.168.1.201"
    print("\n  Pairing...")

    result = pair_with_code(pairing_code, device_ip)
    if result is None:
        print("  ❌ Pairing failed. Check the code and try again.")
        sys.exit(1)

    serial = result.get("deviceSerial", f"DEV-{device_ip.replace('.', '')}")
    save_config(device_ip, 4370, result, serial)

    print()
    print(f"  ✅ Paired successfully with {result.get('gymName', 'Renewal Desk')}!")
    print(f"  Device: {device_ip} (serial: {serial})")
    print(f"  Config saved to: {ENV_FILE}")
    print()
    return ConnectorConfig.from_env(str(ENV_FILE))


def first_run_setup() -> ConnectorConfig:
    """Auto-detects environment: launches GUI dialog on Windows desktop, CLI otherwise."""
    # Try GUI dialog first (best for .exe double-click)
    try:
        config = first_run_setup_gui()
        if config:
            return config
    except Exception as e:
        logger.warning(f"GUI setup skipped or failed: {e}")

    # Fall back to CLI
    if sys.stdin and sys.stdin.isatty():
        return first_run_setup_cli()

    logger.error("No valid configuration found and no user interface could be initialized.")
    sys.exit(1)


# ── Tray App ─────────────────────────────────────────────────────────────────

class TrayApp:
    def __init__(self, config: ConnectorConfig):
        self.config = config
        self.loop = ConnectorLoop(config)
        self._thread: threading.Thread | None = None
        self._tray = None

    def start(self):
        self._thread = threading.Thread(target=self.loop.start, daemon=True)
        self._thread.start()

        if HAS_TRAY:
            self._run_tray()
        else:
            logger.info("Running headless (no tray). Ctrl+C to stop.")
            try:
                self._thread.join()
            except KeyboardInterrupt:
                self.loop.stop()

    def _run_tray(self):
        menu = pystray.Menu(
            pystray.MenuItem("Renewal Desk Connector", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(f"Device: {self.config.device_ip}", None, enabled=False),
            pystray.MenuItem(f"Cloud: {self.config.api_base_url}", None, enabled=False),
            pystray.MenuItem("Status: Active & Syncing", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open Renewal Desk App", self._open_dashboard),
            pystray.MenuItem("View Log File", self._open_logs),
            pystray.MenuItem("Reconfigure / Disconnect", self._reconfigure),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._quit),
        )

        self._tray = pystray.Icon(
            "renewal-desk",
            icon=green_icon(),
            title=f"Renewal Desk — {self.config.device_ip}",
            menu=menu,
        )
        self._tray.run()

    def _open_dashboard(self):
        webbrowser.open(self.config.api_base_url)

    def _open_logs(self):
        if LOG_FILE.exists():
            os.startfile(str(LOG_FILE))

    def _reconfigure(self):
        self.loop.stop()
        if self._tray:
            self._tray.stop()
        if ENV_FILE.exists():
            ENV_FILE.unlink()
        os._exit(0)

    def _quit(self):
        self.loop.stop()
        if self._tray:
            self._tray.stop()


# ── Main Entrypoint ──────────────────────────────────────────────────────────

def main():
    import signal

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    if ENV_FILE.exists():
        try:
            config = ConnectorConfig.from_env(str(ENV_FILE))
        except Exception:
            config = first_run_setup()
    else:
        config = first_run_setup()

    if not config:
        sys.exit(0)

    errors = config.validate()
    if errors:
        logger.error(f"Configuration errors: {errors}")
        if ENV_FILE.exists():
            ENV_FILE.unlink()
        sys.exit(1)

    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    fh = logging.FileHandler(str(LOG_FILE), encoding="utf-8")
    fh.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    logging.getLogger().addHandler(fh)

    app = TrayApp(config)
    signal.signal(signal.SIGTERM, lambda s, f: app._quit())
    signal.signal(signal.SIGINT, lambda s, f: app._quit())
    app.start()


if __name__ == "__main__":
    main()
