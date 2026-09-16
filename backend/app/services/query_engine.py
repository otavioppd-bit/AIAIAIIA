"""Safe, declarative query execution over a dataset.

A QueryPlan is a whitelisted description of an aggregation. It is validated
against the dataset's real schema and then translated into pandas operations.
No expression from the user, the CSV, or the LLM is ever evaluated as code.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field, field_validator

from app.core.errors import ValidationError
from app.services import semantics as sem
from app.services import statistics as stats

AggFunc = Literal["sum", "mean", "median", "count", "min", "max", "nunique", "std"]
FilterOp = Literal[
    "eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in",
    "contains", "not_contains", "between", "is_null", "not_null",
]
TimeGrain = Literal["hour", "day", "week", "month", "quarter", "year"]

_ALLOWED_AGGS: set[str] = {"sum", "mean", "median", "count", "min", "max", "nunique", "std"}
_MAX_LIMIT = 5000
_MAX_GROUPS = 2


class Filter(BaseModel):
    column: str
    op: FilterOp = "eq"
    value: Any = None

    @field_validator("column")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        if not v or not str(v).strip():
            raise ValueError("Filtro sem coluna")
        return str(v).strip()


class MetricSpec(BaseModel):
    column: str | None = None
    agg: AggFunc = "sum"
    alias: str | None = None

    @property
    def output_name(self) -> str:
        if self.alias:
            return self.alias
        if self.column is None or self.agg == "count":
            return "contagem"
        return f"{self.column}"


class QueryPlan(BaseModel):
    """A declarative aggregation request."""

    group_by: list[str] = Field(default_factory=list)
    metrics: list[MetricSpec] = Field(default_factory=list)
    filters: list[Filter] = Field(default_factory=list)
    time_grain: TimeGrain | None = None
    sort_by: str | None = None
    sort_desc: bool = True
    limit: int = 100
    include_others: bool = False

    @field_validator("limit")
    @classmethod
    def _clamp_limit(cls, v: int) -> int:
        return max(1, min(int(v), _MAX_LIMIT))

    @field_validator("group_by")
    @classmethod
    def _clamp_groups(cls, v: list[str]) -> list[str]:
        return [str(c).strip() for c in v if str(c).strip()][:_MAX_GROUPS]


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    truncated: bool
    plan: dict[str, Any]
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "columns": self.columns,
            "rows": self.rows,
            "row_count": self.row_count,
            "truncated": self.truncated,
            "plan": self.plan,
            "notes": self.notes,
        }


class SchemaGuard:
    """Validates every column reference against the dataset's real schema."""

    def __init__(self, column_semantics: list[dict[str, Any]]):
        self._by_name = {c["name"]: c for c in column_semantics}
        self._by_slug = {sem.slugify(c["name"]): c["name"] for c in column_semantics}

    @property
    def names(self) -> list[str]:
        return list(self._by_name.keys())

    def resolve(self, name: str | None) -> str | None:
        """Map a (possibly loosely spelled) column reference to a real column."""
        if name is None:
            return None
        candidate = str(name).strip()
        if candidate in self._by_name:
            return candidate
        slug = sem.slugify(candidate)
        if slug in self._by_slug:
            return self._by_slug[slug]
        # Case-insensitive exact match.
        for real in self._by_name:
            if real.casefold() == candidate.casefold():
                return real
        return None

    def require(self, name: str | None, *, what: str = "coluna") -> str:
        resolved = self.resolve(name)
        if resolved is None:
            raise ValidationError(
                f"A {what} “{name}” não existe neste conjunto de dados.",
                details={"available_columns": self.names[:60]},
            )
        return resolved

    def meta(self, name: str) -> dict[str, Any]:
        return self._by_name[name]

    def is_temporal(self, name: str) -> bool:
        return self._by_name[name]["role"] == sem.TEMPORAL

    def is_aggregatable(self, name: str) -> bool:
        return bool(self._by_name[name].get("is_aggregatable"))


def execute(frame: pd.DataFrame, plan: QueryPlan, guard: SchemaGuard) -> QueryResult:
    """Run a validated query plan against the dataset."""
    notes: list[str] = []
    working = frame

    # 1. Filters ---------------------------------------------------------
    for flt in plan.filters:
        column = guard.require(flt.column, what="coluna do filtro")
        mask = _build_mask(working, column, flt, guard)
        if mask is not None:
            working = working[mask]
    if working.empty:
        return QueryResult(
            columns=[], rows=[], row_count=0, truncated=False,
            plan=plan.model_dump(),
            notes=["Nenhum registro atende aos filtros aplicados."],
        )

    # 2. Resolve grouping -------------------------------------------------
    group_columns: list[str] = []
    group_frames: dict[str, pd.Series] = {}
    for raw in plan.group_by:
        column = guard.require(raw, what="coluna de agrupamento")
        if guard.is_temporal(column) and plan.time_grain:
            bucketed = _bucket_time(working[column], plan.time_grain)
            label = f"{column}"
            group_frames[label] = bucketed
            group_columns.append(label)
        else:
            group_frames[column] = working[column].astype("string").fillna("(vazio)")
            group_columns.append(column)

    # 3. Resolve metrics ---------------------------------------------------
    metrics = plan.metrics or [MetricSpec(column=None, agg="count")]
    resolved_metrics: list[tuple[str, str | None, str]] = []  # (output, column, agg)
    for metric in metrics:
        agg = metric.agg if metric.agg in _ALLOWED_AGGS else "sum"
        if metric.column is None or agg == "count":
            resolved_metrics.append((metric.alias or "contagem", None, "count"))
            continue
        column = guard.require(metric.column, what="métrica")
        if agg in {"sum", "mean", "median", "std"} and not guard.is_aggregatable(column):
            # Falling back keeps the query useful instead of failing outright.
            meta = guard.meta(column)
            if meta["semantic_type"] in sem.NUMERIC_TYPES:
                pass  # numeric but flagged as identity — still allow the maths
            else:
                notes.append(
                    f"“{column}” não é numérica; a agregação foi trocada por contagem "
                    "de valores distintos."
                )
                agg = "nunique"
        resolved_metrics.append((metric.alias or column, column, agg))

    # 4. Aggregate ---------------------------------------------------------
    if not group_columns:
        row: dict[str, Any] = {}
        for output, column, agg in resolved_metrics:
            row[output] = _scalar_agg(working, column, agg)
        return QueryResult(
            columns=[o for o, _, _ in resolved_metrics],
            rows=[row],
            row_count=1,
            truncated=False,
            plan=plan.model_dump(),
            notes=notes,
        )

    grouping = pd.DataFrame(group_frames, index=working.index)
    assembled = grouping.copy()
    agg_spec: dict[str, Any] = {}
    for output, column, agg in resolved_metrics:
        if column is None or agg == "count":
            assembled[output] = 1
            agg_spec[output] = "sum"
        else:
            source = working[column]
            if agg in {"sum", "mean", "median", "std", "min", "max"}:
                assembled[output] = pd.to_numeric(source, errors="coerce")
            else:
                assembled[output] = source
            agg_spec[output] = agg

    grouped = assembled.groupby(group_columns, dropna=False, observed=True).agg(agg_spec)
    grouped = grouped.reset_index()

    # 5. Sort --------------------------------------------------------------
    metric_outputs = [o for o, _, _ in resolved_metrics]
    sort_column = None
    if plan.sort_by:
        if plan.sort_by in grouped.columns:
            sort_column = plan.sort_by
        else:
            resolved_sort = guard.resolve(plan.sort_by)
            if resolved_sort in grouped.columns:
                sort_column = resolved_sort
    if sort_column is None:
        # Time series read chronologically; rankings read by magnitude.
        temporal_group = any(guard.resolve(g) and guard.is_temporal(guard.resolve(g)) for g in plan.group_by)
        sort_column = group_columns[0] if temporal_group else metric_outputs[0]
        ascending = temporal_group
    else:
        ascending = not plan.sort_desc
    grouped = grouped.sort_values(sort_column, ascending=ascending, kind="mergesort")

    # 6. Limit -------------------------------------------------------------
    total_rows = int(len(grouped))
    truncated = total_rows > plan.limit
    if truncated:
        head = grouped.head(plan.limit)
        if plan.include_others and len(group_columns) == 1:
            tail = grouped.iloc[plan.limit :]
            others: dict[str, Any] = {group_columns[0]: "Outros"}
            for output, _, agg in resolved_metrics:
                others[output] = (
                    float(pd.to_numeric(tail[output], errors="coerce").sum())
                    if agg in {"sum", "count"}
                    else None
                )
            grouped = pd.concat([head, pd.DataFrame([others])], ignore_index=True)
            notes.append(
                f"{total_rows - plan.limit} categorias adicionais foram somadas em “Outros”."
            )
        else:
            grouped = head
            notes.append(
                f"Exibindo {plan.limit} de {total_rows} grupos. Ajuste o limite para ver mais."
            )

    rows = [
        {col: _jsonable(value) for col, value in record.items()}
        for record in grouped.to_dict(orient="records")
    ]
    return QueryResult(
        columns=list(grouped.columns),
        rows=rows,
        row_count=total_rows,
        truncated=truncated,
        plan=plan.model_dump(),
        notes=notes,
    )


def _scalar_agg(frame: pd.DataFrame, column: str | None, agg: str) -> Any:
    if column is None or agg == "count":
        return int(len(frame))
    series = frame[column]
    if agg == "nunique":
        return int(series.nunique())
    numeric = pd.to_numeric(series, errors="coerce")
    if agg == "sum":
        return stats.safe_float(numeric.sum())
    if agg == "mean":
        return stats.safe_float(numeric.mean())
    if agg == "median":
        return stats.safe_float(numeric.median())
    if agg == "std":
        return stats.safe_float(numeric.std())
    if agg == "min":
        return stats.safe_float(numeric.min())
    if agg == "max":
        return stats.safe_float(numeric.max())
    return None


def _bucket_time(series: pd.Series, grain: str) -> pd.Series:
    ts = pd.to_datetime(series, errors="coerce")
    if grain == "hour":
        return ts.dt.strftime("%Y-%m-%d %H:00")
    if grain == "day":
        return ts.dt.strftime("%Y-%m-%d")
    if grain == "week":
        return ts.dt.to_period("W").astype("string")
    if grain == "month":
        return ts.dt.strftime("%Y-%m")
    if grain == "quarter":
        return ts.dt.to_period("Q").astype("string")
    if grain == "year":
        return ts.dt.year.astype("Int64").astype("string")
    return ts.dt.strftime("%Y-%m-%d")


def _build_mask(
    frame: pd.DataFrame, column: str, flt: Filter, guard: SchemaGuard
) -> pd.Series | None:
    series = frame[column]
    op, value = flt.op, flt.value
    meta = guard.meta(column)
    is_numeric = meta["semantic_type"] in sem.NUMERIC_TYPES
    is_temporal = meta["role"] == sem.TEMPORAL

    if op == "is_null":
        return series.isna()
    if op == "not_null":
        return series.notna()

    def coerce(v: Any) -> Any:
        if is_numeric:
            return pd.to_numeric(pd.Series([v]), errors="coerce").iloc[0]
        if is_temporal:
            # ISO strings are unambiguous; only day-first parsing needs the hint.
            text = str(v).strip()
            iso_like = bool(re.match(r"^\d{4}-\d{2}(-\d{2})?", text))
            return pd.to_datetime(
                pd.Series([v]), errors="coerce", dayfirst=not iso_like
            ).iloc[0]
        return str(v)

    comparable = pd.to_datetime(series, errors="coerce") if is_temporal else (
        pd.to_numeric(series, errors="coerce") if is_numeric else series.astype("string")
    )

    if op in {"in", "not_in"}:
        values = value if isinstance(value, (list, tuple, set)) else [value]
        coerced = [coerce(v) for v in values]
        mask = comparable.isin(coerced)
        return ~mask if op == "not_in" else mask

    if op == "between":
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            raise ValidationError(
                f"O filtro “between” em “{column}” exige exatamente dois valores."
            )
        low, high = coerce(value[0]), coerce(value[1])
        return comparable.between(low, high)

    if op in {"contains", "not_contains"}:
        as_text = series.astype("string").str.casefold()
        needle = str(value).casefold()
        mask = as_text.str.contains(needle, regex=False, na=False)
        return ~mask if op == "not_contains" else mask

    target = coerce(value)
    if target is pd.NaT or (isinstance(target, float) and np.isnan(target)):
        # An uncoercible comparison value would silently drop every row.
        raise ValidationError(
            f"O valor “{value}” não é compatível com o tipo da coluna “{column}”."
        )

    ops = {
        "eq": lambda: comparable == target,
        "neq": lambda: comparable != target,
        "gt": lambda: comparable > target,
        "gte": lambda: comparable >= target,
        "lt": lambda: comparable < target,
        "lte": lambda: comparable <= target,
    }
    if op not in ops:
        raise ValidationError(f"Operador de filtro não suportado: {op}")
    return ops[op]()


def _jsonable(value: Any) -> Any:
    if value is None or value is pd.NaT:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return stats.safe_float(value)
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, float):
        return stats.safe_float(value)
    if isinstance(value, (int, str)):
        return value
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return str(value)
