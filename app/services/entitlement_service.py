"""Server-side feature entitlement checks shared by protected capabilities."""
from __future__ import annotations

from app.extensions import db
from app.models.bot import FeatureEntitlement
from app.models.gym import Gym


WHATSAPP_BOT_FEATURE = "whatsapp_bot"


def is_feature_enabled(gym: Gym | int | None, feature: str) -> bool:
    """Return whether a tenant currently has an enabled feature entitlement.

    Missing, disabled, expired, suspended, and unknown gym records all deny
    access. Callers must invoke this immediately before privileged work rather
    than trusting a client-side feature flag.
    """

    if gym is None:
        return False
    if isinstance(gym, int):
        gym = db.session.get(Gym, gym)
    if gym is None or not gym.is_operational():
        return False

    entitlement = FeatureEntitlement.query.filter_by(
        gym_id=gym.id,
        feature=(feature or "").strip().lower(),
    ).one_or_none()
    return bool(entitlement and entitlement.is_active())
