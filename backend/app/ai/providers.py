"""Concrete LLM backends: Anthropic, OpenAI-compatible, and a null provider."""
from __future__ import annotations

import logging

import httpx

from app.ai.base import LLMProvider, LLMResponse, LLMUnavailable
from app.core.config import settings

logger = logging.getLogger(__name__)


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: str | None = None, model: str | None = None):
        self._api_key = api_key or settings.anthropic_api_key
        self.model = model or settings.anthropic_model

    @property
    def available(self) -> bool:
        return bool(self._api_key)

    async def complete(
        self, *, system: str, user: str, max_tokens: int | None = None, temperature: float = 0.2
    ) -> LLMResponse:
        if not self.available:
            raise LLMUnavailable("ANTHROPIC_API_KEY não configurada.")

        payload = {
            "model": self.model,
            "max_tokens": max_tokens or settings.llm_max_tokens,
            "temperature": temperature,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        headers = {
            "x-api-key": self._api_key or "",
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages", json=payload, headers=headers
            )
            if response.status_code >= 400:
                raise LLMUnavailable(
                    f"Anthropic respondeu {response.status_code}: {response.text[:300]}"
                )
            data = response.json()

        blocks = data.get("content") or []
        text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
        usage = data.get("usage") or {}
        return LLMResponse(
            text=text,
            provider=self.name,
            model=self.model,
            raw=data,
            usage={
                "input_tokens": int(usage.get("input_tokens", 0)),
                "output_tokens": int(usage.get("output_tokens", 0)),
            },
        )


class OpenAIProvider(LLMProvider):
    """Works with OpenAI and any OpenAI-compatible endpoint."""

    name = "openai"

    def __init__(
        self, api_key: str | None = None, model: str | None = None, base_url: str | None = None
    ):
        self._api_key = api_key or settings.openai_api_key
        self.model = model or settings.openai_model
        self._base_url = (base_url or settings.openai_base_url).rstrip("/")

    @property
    def available(self) -> bool:
        return bool(self._api_key)

    async def complete(
        self, *, system: str, user: str, max_tokens: int | None = None, temperature: float = 0.2
    ) -> LLMResponse:
        if not self.available:
            raise LLMUnavailable("OPENAI_API_KEY não configurada.")

        payload = {
            "model": self.model,
            "max_tokens": max_tokens or settings.llm_max_tokens,
            "temperature": temperature,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            response = await client.post(
                f"{self._base_url}/chat/completions", json=payload, headers=headers
            )
            if response.status_code >= 400:
                raise LLMUnavailable(
                    f"OpenAI respondeu {response.status_code}: {response.text[:300]}"
                )
            data = response.json()

        choices = data.get("choices") or []
        text = choices[0]["message"]["content"] if choices else ""
        usage = data.get("usage") or {}
        return LLMResponse(
            text=text or "",
            provider=self.name,
            model=self.model,
            raw=data,
            usage={
                "input_tokens": int(usage.get("prompt_tokens", 0)),
                "output_tokens": int(usage.get("completion_tokens", 0)),
            },
        )


class NullProvider(LLMProvider):
    """Stand-in used when no API key is configured.

    The product is fully functional without a model: every number, insight and
    chart comes from the deterministic engine. Only the narrative polish and
    free-form question parsing degrade to rule-based behaviour.
    """

    name = "heuristic"
    model = "rule-based"

    @property
    def available(self) -> bool:
        return False

    async def complete(self, **_: object) -> LLMResponse:
        raise LLMUnavailable("Nenhum provedor de LLM configurado.")


def get_provider() -> LLMProvider:
    """Resolve the configured provider, honouring LLM_PROVIDER."""
    choice = (settings.llm_provider or "auto").lower()

    if choice == "anthropic":
        return AnthropicProvider()
    if choice == "openai":
        return OpenAIProvider()
    if choice == "heuristic":
        return NullProvider()

    anthropic = AnthropicProvider()
    if anthropic.available:
        return anthropic
    openai = OpenAIProvider()
    if openai.available:
        return openai
    return NullProvider()


def provider_status() -> dict[str, object]:
    provider = get_provider()
    return {
        "provider": provider.name,
        "model": provider.model,
        "available": provider.available,
        "mode": "llm" if provider.available else "deterministic",
    }
