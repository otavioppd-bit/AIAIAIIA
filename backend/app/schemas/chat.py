"""AI Data Analyst chat models."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ConversationSummary(BaseModel):
    id: str
    dataset_id: str
    title: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    payload: dict[str, Any] | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationDetail(ConversationSummary):
    messages: list[MessageResponse] = Field(default_factory=list)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    conversation_id: str | None = None


class AskResponse(BaseModel):
    conversation_id: str
    message: MessageResponse
    answer: str
    intent: str
    chart: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    plan: dict[str, Any] = Field(default_factory=dict)
    follow_ups: list[str] = Field(default_factory=list)
    source: str = "deterministic"
