#!/usr/bin/env python3
"""
Renewal Desk Linux Connector — main entry point.

Pure-Python replacement for the C# RenewalDeskBridge. Talks to eSSL/ZKTeco
biometric terminals via pyzk and polls the Renewal Desk Railway backend for
membership commands (enable/disable/create/delete/unlock).

Usage:
    python -m connector                    # uses .env file
    python -m connector --env prod.env     # explicit env file
    python main.py                         # direct run

Environment variables (or .env file):
    DEVICE_IP           — biometric terminal IP address (required)
    DEVICE_PORT         — terminal port (default: 4370)
    DEVICE_COMM_KEY     — communication password (default: 0)
    API_BASE_URL        — Railway backend URL (required)
    API_KEY             — bridge API key from pairing (required)
    GYM_ID              — bridge public_id from pairing (required)
    DEVICE_SERIAL       — terminal serial number (required)
"""

from __future__ import annotations

import argparse
import logging
import signal
import sys

from connector.command_loop import ConnectorLoop
from connector.config import ConnectorConfig


def setup_logging(config: ConnectorConfig) -> None:
    """Configure logging to console and optionally a file."""
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]

    if config.log_file:
        handlers.append(logging.FileHandler(config.log_file, encoding="utf-8"))

    logging.basicConfig(
        level=getattr(logging, config.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=handlers,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Renewal Desk Linux Connector — biometric bridge"
    )
    parser.add_argument(
        "--env", "-e",
        help="Path to .env configuration file",
        default=None,
    )
    args = parser.parse_args()

    # Load config
    config = ConnectorConfig.from_env(args.env)
    errors = config.validate()
    if errors:
        print("❌ Configuration errors:")
        for err in errors:
            print(f"   - {err}")
        print("\nSet these in your .env file or as environment variables.")
        sys.exit(1)

    # Setup logging
    setup_logging(config)
    logger = logging.getLogger(__name__)

    # Create and start the connector
    loop = ConnectorLoop(config)

    # Graceful shutdown on SIGTERM (Docker/Railway) and SIGINT (Ctrl+C)
    def _shutdown(signum, frame):
        logger.info("Received signal %s — stopping...", signum)
        loop.stop()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    # Run (blocks until stopped)
    loop.start()


if __name__ == "__main__":
    main()
