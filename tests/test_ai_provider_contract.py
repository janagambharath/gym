from __future__ import annotations

from unittest.mock import Mock, patch

from app.models.bot import BotConversation, BotLead
from app.services.ai_provider import OpenRouterProvider
from app.services.ai_router import AIRouter


def _provider_response(content: str) -> Mock:
    response = Mock()
    response.status_code = 200
    response.json.return_value = {
        "choices": [{"message": {"content": content}}],
    }
    return response


@patch("app.services.ai_provider.requests.post")
def test_provider_rejects_unstructured_model_output(mock_post, app):
    mock_post.return_value = _provider_response("Here is a casual unstructured answer.")
    provider = OpenRouterProvider(api_key="test-key")

    result = provider.generate(
        model="test-model",
        messages=[{"role": "user", "content": "Hello"}],
    )

    assert result.ok is False
    assert result.error_type == "MALFORMED_OUTPUT"


@patch("app.services.ai_provider.requests.post")
def test_provider_normalizes_only_valid_structured_output(mock_post, app):
    mock_post.return_value = _provider_response(
        '{"response":"Welcome to the gym!", "intent":"greeting", '
        '"confidence":"1.5", "handover":"false"}'
    )
    provider = OpenRouterProvider(api_key="test-key")

    result = provider.generate(
        model="test-model",
        messages=[{"role": "user", "content": "Hello"}],
    )

    assert result.ok is True
    assert result.text == "Welcome to the gym!"
    assert result.intent == "greeting"
    assert result.confidence == 1.0
    assert result.handover is False


def test_router_keeps_financial_booking_and_grounded_facts_out_of_the_llm(seed_gym):
    gym = seed_gym["gym"]
    router = AIRouter(gym)
    conversation = BotConversation(gym_id=gym.id, phone="919999955555")
    lead = BotLead(gym_id=gym.id, phone="919999955555")

    with patch.object(router.provider, "generate") as generate:
        payment, payment_intent, payment_handover = router.route_and_generate(
            conversation,
            lead,
            "Please mark my payment as paid.",
            [],
        )
        booking, booking_intent, booking_handover = router.route_and_generate(
            conversation,
            lead,
            "Book me at 5 PM today.",
            [],
        )
        pricing, pricing_intent, pricing_handover = router.route_and_generate(
            conversation,
            lead,
            "What are your membership prices?",
            [],
        )

    generate.assert_not_called()
    assert payment_intent == "payment_safety"
    assert payment_handover is True
    assert "cannot verify" in payment.lower()
    assert booking_intent == "booking_request"
    assert booking_handover is True
    assert "cannot confirm" in booking.lower()
    assert pricing_intent == "pricing"
    assert pricing_handover is False
    assert "Monthly Standard" in pricing
