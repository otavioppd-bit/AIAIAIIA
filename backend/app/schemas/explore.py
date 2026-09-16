"""Explore (ad-hoc query builder) models."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ExploreFilter(BaseModel):
    column: str
    op: Literal[
        "eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in",
        "contains", "not_contains", "between", "is_null", "not_null",
    ] = "eq"
    value: Any = None


class ExploreRequest(BaseModel):
    x: str | None = None
    y: str | None = None
    series: str | None = None
    agg: Literal["sum", "mean", "median", "count", "min", "max", "nunique", "std"] = "sum"
    time_grain: Literal["hour", "day", "week", "month", "quarter", "year"] | None = None
    filters: list[ExploreFilter] = Field(default_factory=list)
    sort_desc: bool = True
    limit: int = Field(default=100, ge=1, le=5000)
    chart_type: str = Field(default="bar", max_length=32)


class ExploreResponse(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    truncated: bool
    notes: list[str] = Field(default_factory=list)
    suggested_chart: str
    rationale: str = ""
