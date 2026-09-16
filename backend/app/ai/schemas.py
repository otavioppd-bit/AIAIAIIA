"""Structured output contracts for the LLM.

Every model response is parsed into one of these schemas before it is used.
A response that does not validate is discarded and the deterministic path
takes over, so a hallucinated or malformed answer can never reach the user.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

Intent = Literal[
    "aggregate", "trend", "compare", "correlation",
    "outliers", "quality", "overview", "distribution", "unsupported",
]


class PlannedFilter(BaseModel):
    column: str
    op: Literal[
        "eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in",
        "contains", "not_contains", "between", "is_null", "not_null",
    ] = "eq"
    value: Any = None


class PlannedMetric(BaseModel):
    column: str | None = None
    agg: Literal["sum", "mean", "median", "count", "min", "max", "nunique", "std"] = "sum"


class AnalystPlan(BaseModel):
    """What the model proposes to compute in order to answer a question."""

    intent: Intent = "aggregate"
    group_by: list[str] = Field(default_factory=list, max_length=2)
    metrics: list[PlannedMetric] = Field(default_factory=list, max_length=3)
    filters: list[PlannedFilter] = Field(default_factory=list, max_length=6)
    time_grain: Literal["hour", "day", "week", "month", "quarter", "year"] | None = None
    sort_desc: bool = True
    limit: int = Field(default=20, ge=1, le=500)
    chart_type: (
        Literal[
            "line", "area", "bar", "bar_horizontal", "stacked_bar", "scatter",
            "donut", "pie", "histogram", "box_plot", "heatmap", "treemap",
            "radar", "funnel", "kpi", "table", "map", "none",
        ]
        | None
    ) = None
    chart_title: str | None = Field(default=None, max_length=120)
    reasoning: str = Field(default="", max_length=600)

    @field_validator("group_by", "metrics", "filters", mode="before")
    @classmethod
    def _coerce_list(cls, v: Any) -> Any:
        if v is None:
            return []
        return v


class NarrativeSection(BaseModel):
    heading: str = Field(max_length=120)
    body: str = Field(max_length=1500)


class DashboardNarrative(BaseModel):
    """Executive summary written from pre-computed facts."""

    headline: str = Field(max_length=160)
    summary: str = Field(max_length=1800)
    sections: list[NarrativeSection] = Field(default_factory=list, max_length=5)
    watch_items: list[str] = Field(default_factory=list, max_length=6)


class CuratedWidget(BaseModel):
    """The model's curation decision for one recommended chart."""

    index: int = Field(ge=0)
    keep: bool = True
    title: str | None = Field(default=None, max_length=120)
    subtitle: str | None = Field(default=None, max_length=160)
    priority: int = Field(default=50, ge=0, le=100)


class DashboardCuration(BaseModel):
    widgets: list[CuratedWidget] = Field(default_factory=list, max_length=30)
    dashboard_title: str | None = Field(default=None, max_length=120)
    dashboard_subtitle: str | None = Field(default=None, max_length=200)


class AnswerNarration(BaseModel):
    """A natural-language answer grounded in an executed query result."""

    answer: str = Field(max_length=1600)
    follow_up_questions: list[str] = Field(default_factory=list, max_length=3)
