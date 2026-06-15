from __future__ import annotations

"""Translate known Meta WhatsApp errors into gym-owner-facing language."""


_CODE_MESSAGES: dict[str, str] = {
    "131047": (
        "This member has not messaged your WhatsApp number recently, so Meta blocked "
        "the normal message. The approved reminder template will be used when configured."
    ),
    "131042": (
        "Meta blocked this WhatsApp delivery because the WhatsApp Business Account billing "
        "or payment setup is not eligible yet."
    ),
    "131026": (
        "WhatsApp could not deliver this message. The number may not have WhatsApp installed, "
        "or the member may have blocked the business number."
    ),
    "131021": "This phone number appears to be invalid. Double-check the member profile.",
    "470": (
        "Meta blocked this normal message because the 24-hour customer-service window is "
        "closed. Configure an approved reminder template to reach this member."
    ),
    "131008": (
        "WhatsApp rejected this message due to missing required information. Contact "
        "platform support if this keeps happening."
    ),
    "133010": (
        "The WhatsApp Business Account is not fully set up on Meta's side. Contact "
        "platform support."
    ),
}


def friendly_error(raw_error: str | None) -> str | None:
    """Return a plain-language message for a raw WhatsApp API error, if known."""
    if not raw_error:
        return None
    for code, message in _CODE_MESSAGES.items():
        if f"code {code}" in raw_error or f"code {code}/" in raw_error:
            return message
    return None
