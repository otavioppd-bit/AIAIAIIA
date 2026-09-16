"""Dataset API models."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class DatasetSummary(BaseModel):
    id: str
    name: str
    original_filename: str
    status: str
    row_count: int
    column_count: int
    size_bytes: int
    quality_score: int
    domain: str
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DatasetDetail(DatasetSummary):
    profile: dict[str, Any] = Field(default_factory=dict)
    semantics: dict[str, Any] = Field(default_factory=dict)
    analysis: dict[str, Any] = Field(default_factory=dict)


class DatasetRowsResponse(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    total: int
    limit: int
    offset: int


class RenameDatasetRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class UploadResponse(BaseModel):
    dataset: DatasetDetail
    dashboard_id: str | None = None
    warnings: list[str] = Field(default_factory=list)
