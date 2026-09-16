"""Shared API response models."""
from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: Any = None


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class MessageResponse(BaseModel):
    message: str
    ok: bool = True


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    environment: str
    llm: dict[str, Any] = Field(default_factory=dict)
