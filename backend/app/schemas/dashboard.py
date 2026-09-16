"""Dashboard API models."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class DashboardSummary(BaseModel):
    id: str
    dataset_id: str
    name: str
    description: str
    theme: str
    is_primary: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DashboardDetail(DashboardSummary):
    spec: dict[str, Any] = Field(default_factory=dict)


class DashboardVersionSummary(BaseModel):
    id: str
    version: int
    label: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateDashboardRequest(BaseModel):
    dataset_id: str
    name: str = Field(default="Novo dashboard", max_length=200)
    spec: dict[str, Any] | None = None


class UpdateDashboardRequest(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    theme: str | None = Field(default=None, max_length=32)
    spec: dict[str, Any] | None = None
    save_version: bool = False
    version_label: str = Field(default="", max_length=200)


class WidgetDataRequest(BaseModel):
    """Request the rows that back a single widget."""

    chart_type: str = Field(max_length=32)
    encoding: dict[str, Any] = Field(default_factory=dict)
    filters: list[dict[str, Any]] = Field(default_factory=list)
    limit: int = Field(default=200, ge=1, le=5000)


class WidgetDataResponse(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    truncated: bool
    notes: list[str] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)
