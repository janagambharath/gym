"""AI Provider abstraction for WhatsApp AI Receptionist.

Supports OpenRouter (and OpenAI-compatible endpoints) with:
- Structured JSON output parsing
- Low-latency streaming/timeout guardrails
- Error categorization (rate limit, timeout, malformed output, network)
- Safe observability without credential leakage
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any

import requests
from flask import current_app


@dataclass
class AIProviderResult:
    ok: bool
    text: str | None = None
    intent: str | None = None
    confidence: float = 0.0
    lead_data: dict[str, Any] | None = None
    action: str | None = None
    handover: bool = False
    model_used: str | None = None
    latency_ms: int = 0
    error_type: str | None = None
    error_message: str | None = None


class OpenRouterProvider:
    """Invokes OpenRouter chat completions API."""

    def __init__(self, api_key: str | None = None, base_url: str | None = None, timeout: int = 10):
        self.api_key = api_key or current_app.config.get("BOT_AI_API_KEY", "")
        self.base_url = (base_url or current_app.config.get("BOT_AI_BASE_URL", "https://openrouter.ai/api/v1")).rstrip("/")
        self.timeout = timeout or current_app.config.get("BOT_AI_TIMEOUT_SECONDS", 10)

    def is_configured(self) -> bool:
        return bool(self.api_key and self.api_key.strip())

    def generate(
        self,
        model: str,
        messages: list[dict[str, str]],
        temperature: float = 0.3,
        max_tokens: int = 450,
    ) -> AIProviderResult:
        if not self.is_configured():
            return AIProviderResult(
                ok=False,
                error_type="NOT_CONFIGURED",
                error_message="OpenRouter API key is not configured.",
            )

        endpoint = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://renewaldesk.app",
            "X-Title": "Renewal Desk WhatsApp AI",
        }
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }

        start_time = time.time()
        try:
            resp = requests.post(endpoint, json=payload, headers=headers, timeout=self.timeout)
            latency_ms = int((time.time() - start_time) * 1000)

            if resp.status_code == 429:
                return AIProviderResult(
                    ok=False,
                    model_used=model,
                    latency_ms=latency_ms,
                    error_type="RATE_LIMIT",
                    error_message=f"Rate limit exceeded on model {model}",
                )

            if resp.status_code != 200:
                return AIProviderResult(
                    ok=False,
                    model_used=model,
                    latency_ms=latency_ms,
                    error_type="HTTP_ERROR",
                    error_message=f"HTTP {resp.status_code}: {resp.text[:200]}",
                )

            data = resp.json()
            choices = data.get("choices") or []
            if not choices:
                return AIProviderResult(
                    ok=False,
                    model_used=model,
                    latency_ms=latency_ms,
                    error_type="EMPTY_RESPONSE",
                    error_message="Model returned no choices.",
                )

            content = choices[0].get("message", {}).get("content", "").strip()
            parsed = self._parse_structured_json(content)
            if not parsed:
                # If JSON object extraction failed, wrap raw text if reasonable
                if content and len(content) > 5 and not content.startswith("{"):
                    return AIProviderResult(
                        ok=True,
                        text=content,
                        intent="general",
                        confidence=0.7,
                        model_used=model,
                        latency_ms=latency_ms,
                    )
                return AIProviderResult(
                    ok=False,
                    model_used=model,
                    latency_ms=latency_ms,
                    error_type="MALFORMED_OUTPUT",
                    error_message="Could not parse valid JSON from model response.",
                )

            return AIProviderResult(
                ok=True,
                text=parsed.get("response") or parsed.get("message") or parsed.get("text"),
                intent=parsed.get("intent", "general"),
                confidence=float(parsed.get("confidence", 0.9)),
                lead_data=parsed.get("lead_data") if isinstance(parsed.get("lead_data"), dict) else None,
                action=parsed.get("action"),
                handover=bool(parsed.get("handover", False)),
                model_used=model,
                latency_ms=latency_ms,
            )

        except requests.Timeout:
            latency_ms = int((time.time() - start_time) * 1000)
            return AIProviderResult(
                ok=False,
                model_used=model,
                latency_ms=latency_ms,
                error_type="TIMEOUT",
                error_message=f"Request to {model} timed out after {self.timeout}s.",
            )
        except requests.RequestException as e:
            latency_ms = int((time.time() - start_time) * 1000)
            return AIProviderResult(
                ok=False,
                model_used=model,
                latency_ms=latency_ms,
                error_type="NETWORK_ERROR",
                error_message=f"Network error during model call: {str(e)[:150]}",
            )
        except Exception as e:
            latency_ms = int((time.time() - start_time) * 1000)
            return AIProviderResult(
                ok=False,
                model_used=model,
                latency_ms=latency_ms,
                error_type="INTERNAL_ERROR",
                error_message=f"Unexpected error: {str(e)[:150]}",
            )

    @staticmethod
    def _parse_structured_json(text: str) -> dict[str, Any] | None:
        """Extracts and parses JSON object from LLM response text."""
        if not text:
            return None
        text = text.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Try regex search for ```json ... ``` or { ... }
        match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        match = re.search(r"(\{.*\})", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        return None
