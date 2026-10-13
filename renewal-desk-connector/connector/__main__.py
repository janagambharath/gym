"""Allow running as: python -m connector"""
from .command_loop import ConnectorLoop  # noqa: F401

# When run as `python -m connector`, execute main
import sys
if __name__ == "__main__" or (len(sys.argv) > 0 and sys.argv[0].endswith("__main__.py")):
    from connector.config import ConnectorConfig
    import logging
    import signal

    config = ConnectorConfig.from_env()
    errors = config.validate()
    if errors:
        print("❌ Configuration errors:")
        for err in errors:
            print(f"   - {err}")
        sys.exit(1)

    logging.basicConfig(
        level=getattr(logging, config.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    loop = ConnectorLoop(config)
    signal.signal(signal.SIGTERM, lambda s, f: loop.stop())
    signal.signal(signal.SIGINT, lambda s, f: loop.stop())
    loop.start()
