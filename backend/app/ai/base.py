"""LLM provider abstraction.

The rest of the application depends only on this interface, so swapping model
vendors — or running with no vendor at all — never touches business logic.
"""
from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError as PydanticValidationError

T = TypeVar("T", bound=BaseModel)


@dataclass
class LLMResponse:
    text: str
    provider: str
    model: str
    raw: dict[str, Any] = field(default_factory=dict)
    usage: dict[str, int] = field(default_factory=dict)


class LLMUnavailable(RuntimeError):
    """Raised when no model backend can serve a request."""


class LLMProvider(ABC):
    """Minimal contract every model backend must satisfy."""

    name: str = "base"
    model: str = ""

    @property
    @abstractmethod
    def available(self) -> bool:
        """Whether this provider is configured and usable."""

    @abstractmethod
    async def complete(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int | None = None,
        temperature: float = 0.2,
    ) -> LLMResponse:
        """Return a single completion for the given prompt pair."""


_JSON_BLOCK = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.S)


def extract_json(text: str) -> dict[str, Any] | list[Any]:
    """Pull the first JSON document out of a model response.

    Models routinely wrap JSON in prose or fences, so this is tolerant — but it
    never evaluates the string, only parses it.
    """
    if not text or not text.strip():
        raise ValueError("Resposta vazia do modelo.")

    candidates: list[str] = []
    fenced = _JSON_BLOCK.search(text)
    if fenced:
        candidates.append(fenced.group(1))
    candidates.append(text.strip())

    # Fall back to the outermost balanced object/array in the raw text.
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start != -1 and end > start:
            candidates.append(text[start : end + 1])

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    raise ValueError("A resposta do modelo não continha JSON válido.")


def parse_structured(text: str, schema: type[T]) -> T:
    """Parse and validate a model response against a Pydantic schema.

    Anything the model returns that does not fit the schema is rejected, which
    is what stops a malformed or adversarial response from reaching the
    dashboard or the query engine.
    """
    payload = extract_json(text)
    try:
        return schema.model_validate(payload)
    except PydanticValidationError as exc:
        raise ValueError(f"Resposta do modelo fora do formato esperado: {exc}") from exc
