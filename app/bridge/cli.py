from __future__ import annotations

from urllib.parse import urlparse

import click
from flask import Flask, current_app

from app.extensions import db
from app.models import BridgeInstallation, Gym
from app.services.bridge_service import queue_gym_reconciliation


def _resolve_gym(gym_id: int | None, gym_slug: str | None) -> Gym:
    if bool(gym_id) == bool(gym_slug):
        raise click.ClickException("Specify exactly one of --gym-id or --gym-slug.")
    gym = db.session.get(Gym, gym_id) if gym_id else Gym.query.filter_by(slug=gym_slug).first()
    if gym is None:
        label = f"ID {gym_id}" if gym_id else f"slug '{gym_slug}'"
        raise click.ClickException(f"Gym with {label} was not found.")
    return gym


def _gym_options(command):
    command = click.option("--gym-slug", help="Gym slug shown in the dashboard URL.")(command)
    return click.option("--gym-id", type=int, help="Internal Renewal Desk gym ID.")(command)


def _require_public_base_url() -> str:
    """Return the deployment URL used by new laptop credentials.

    Refuse to mint a one-time secret when the server cannot also tell the
    operator where the laptop should connect.  Otherwise the command can
    successfully create a key but print a placeholder URL, leaving the only
    copy of that key attached to an unusable setup.
    """

    base_url = current_app.config.get("PUBLIC_BASE_URL", "").rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise click.ClickException(
            "PUBLIC_BASE_URL must be an absolute URL (for example "
            "https://gym-production-910c.up.railway.app) before creating or rotating a bridge key."
        )
    return base_url


def _print_laptop_config(
    installation: BridgeInstallation, api_key: str, base_url: str
) -> None:
    click.echo("\nGym laptop appsettings.json values:")
    click.echo(f'  "ApiBaseUrl": "{base_url or "https://YOUR-RAILWAY-DOMAIN"}",')
    click.echo(f'  "GymId": "{installation.public_id}",')
    click.echo(f'  "ApiKey": "{api_key}"')


def register_bridge_commands(app: Flask) -> None:
    @app.cli.command("bridge-list")
    def bridge_list() -> None:
        """List gyms and whether each has a biometric bridge."""
        for gym in Gym.query.order_by(Gym.id.asc()).all():
            installation = BridgeInstallation.query.filter_by(gym_id=gym.id).first()
            bridge = installation.public_id if installation else "not configured"
            click.echo(f"{gym.id}\t{gym.slug}\t{gym.name}\t{bridge}")

    @app.cli.command("bridge-create")
    @_gym_options
    @click.option("--name", default="Gym biometric bridge", show_default=True)
    @click.option(
        "--device-serial",
        required=True,
        help="Exact serial logged by the connected Renewal Desk Bridge terminal.",
    )
    def bridge_create(
        gym_id: int | None, gym_slug: str | None, name: str, device_serial: str
    ) -> None:
        """Create a bridge credential and print the one-time laptop settings."""
        base_url = _require_public_base_url()
        gym = _resolve_gym(gym_id, gym_slug)
        if BridgeInstallation.query.filter_by(gym_id=gym.id).first():
            raise click.ClickException("This gym already has a bridge. Use bridge-rotate-key.")
        normalized_serial = (device_serial or "").strip()
        if not normalized_serial:
            raise click.ClickException("--device-serial cannot be blank.")
        if BridgeInstallation.query.filter_by(device_serial=normalized_serial).first():
            raise click.ClickException("That biometric terminal serial already belongs to another bridge.")
        installation, raw_key = BridgeInstallation.create_for_gym(gym.id, name, normalized_serial)
        db.session.add(installation)
        db.session.commit()
        click.echo(f"Bridge ID: {installation.public_id}")
        click.echo(f"API key (copy now; it cannot be shown again): {raw_key}")
        _print_laptop_config(installation, raw_key, base_url)

    @app.cli.command("bridge-rotate-key")
    @_gym_options
    def bridge_rotate_key(gym_id: int | None, gym_slug: str | None) -> None:
        """Rotate a bridge API key and print the new one-time value."""
        base_url = _require_public_base_url()
        gym = _resolve_gym(gym_id, gym_slug)
        installation = BridgeInstallation.query.filter_by(gym_id=gym.id).first()
        if installation is None:
            raise click.ClickException("No bridge is configured for this gym.")
        raw_key = installation.rotate_key()
        db.session.commit()
        click.echo(f"Bridge ID: {installation.public_id}")
        click.echo(f"New API key (copy now; it cannot be shown again): {raw_key}")
        _print_laptop_config(installation, raw_key, base_url)

    @app.cli.command("bridge-reconcile")
    @_gym_options
    def bridge_reconcile(gym_id: int | None, gym_slug: str | None) -> None:
        """Queue the current membership state for every enrolled member."""
        gym = _resolve_gym(gym_id, gym_slug)
        queued = queue_gym_reconciliation(gym.id)
        db.session.commit()
        click.echo(f"Queued/reconciled {queued} enrolled member(s).")
