from __future__ import annotations

from jinja2 import StrictUndefined, meta
from jinja2.sandbox import SandboxedEnvironment


SUPPORTED_TEMPLATE_VARIABLES = frozenset(
    {
        "member_name",
        "gym_name",
        "expiry_date",
        "days_left",
    }
)
_ENV = SandboxedEnvironment(undefined=StrictUndefined, autoescape=False)


def validate_message_template(message_template: str) -> None:
    try:
        parsed = _ENV.parse(message_template or "")
    except Exception as exc:
        raise ValueError(f"Template syntax error: {exc}") from exc

    unsupported = meta.find_undeclared_variables(parsed) - SUPPORTED_TEMPLATE_VARIABLES
    if unsupported:
        names = ", ".join(sorted(unsupported))
        raise ValueError(f"Unsupported template variable(s): {names}")


def render_message_template(
    message_template: str,
    *,
    gym_name: str,
    member_name: str,
    expiry_date: str,
    days_left: int,
) -> str:
    validate_message_template(message_template)
    return _ENV.from_string(message_template).render(
        gym_name=gym_name,
        member_name=member_name,
        expiry_date=expiry_date,
        days_left=days_left,
    )
