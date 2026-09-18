"""Dataset profiling: per-column statistics plus dataset-level overview."""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.services import semantics as sem
from app.services import statistics as stats
from app.services.semantics import ColumnSemantics


def profile_dataset(
    frame: pd.DataFrame,
    column_semantics: list[ColumnSemantics],
    *,
    original_row_count: int | None = None,
    encoding: str = "utf-8",
    delimiter: str = ",",
) -> dict[str, Any]:
    """Build the complete Data Profiling document for a typed DataFrame."""
    row_count = int(len(frame))
    col_count = int(frame.shape[1])
    total_cells = row_count * col_count

    missing_cells = int(frame.isna().sum().sum())
    duplicate_mask = frame.duplicated(keep="first")
    duplicate_rows = int(duplicate_mask.sum())

    columns: list[dict[str, Any]] = []
    for meta in column_semantics:
        columns.append(_profile_column(frame[meta.name], meta, row_count))

    constant_columns = [c["name"] for c in columns if c["unique_count"] <= 1 and row_count > 1]
    high_missing = [c["name"] for c in columns if c["missing_ratio"] > 0.4]

    return {
        "overview": {
            "row_count": row_count,
            "original_row_count": original_row_count if original_row_count is not None else row_count,
            "column_count": col_count,
            "total_cells": total_cells,
            "memory_bytes": int(frame.memory_usage(deep=True).sum()),
            "missing_cells": missing_cells,
            "missing_ratio": round(missing_cells / total_cells, 6) if total_cells else 0.0,
            "duplicate_rows": duplicate_rows,
            "duplicate_ratio": round(duplicate_rows / row_count, 6) if row_count else 0.0,
            "complete_rows": int(row_count - frame.isna().any(axis=1).sum()),
            "encoding": encoding,
            "delimiter": delimiter,
            "constant_columns": constant_columns,
            "high_missing_columns": high_missing,
        },
        "columns": columns,
        "type_summary": _type_summary(columns),
    }


def _profile_column(series: pd.Series, meta: ColumnSemantics, row_count: int) -> dict[str, Any]:
    base: dict[str, Any] = {
        "name": meta.name,
        "semantic_type": meta.semantic_type,
        "role": meta.role,
        "pandas_dtype": meta.pandas_dtype,
        "unique_count": meta.unique_count,
        "missing_count": meta.missing_count,
        "missing_ratio": meta.missing_ratio,
        "cardinality_ratio": meta.cardinality_ratio,
        "is_aggregatable": meta.is_aggregatable,
        "sample_values": meta.sample_values,
        "detail": meta.detail,
    }

    if meta.semantic_type in sem.NUMERIC_TYPES:
        base["stats"] = stats.describe_numeric(series)
    elif meta.semantic_type == sem.DATETIME:
        base["stats"] = stats.describe_datetime(series)
    elif meta.semantic_type == sem.BOOLEAN:
        clean = series.dropna()
        true_count = int(clean.sum()) if clean.size else 0
        base["stats"] = {
            "count": int(clean.size),
            "true_count": true_count,
            "false_count": int(clean.size - true_count),
            "true_ratio": round(true_count / clean.size, 6) if clean.size else 0.0,
        }
    elif meta.semantic_type in {sem.CATEGORICAL, sem.GEO}:
        base["stats"] = stats.describe_categorical(series)
    else:
        clean = series.dropna().astype("string")
        base["stats"] = {
            "count": int(clean.size),
            "unique": meta.unique_count,
            "avg_length": stats.safe_float(clean.str.len().mean()) if clean.size else None,
            "max_length": int(clean.str.len().max()) if clean.size else 0,
        }
    return base


def _type_summary(columns: list[dict[str, Any]]) -> dict[str, int]:
    summary: dict[str, int] = {}
    for col in columns:
        key = col["semantic_type"]
        summary[key] = summary.get(key, 0) + 1
    return summary


def sample_rows(frame: pd.DataFrame, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    """Return JSON-safe rows for table previews."""
    window = frame.iloc[offset : offset + limit]
    return [
        {col: _cell(value) for col, value in row.items()}
        for row in window.to_dict(orient="records")
    ]


def _cell(value: Any) -> Any:
    if value is None or value is pd.NaT:
        return None
    if isinstance(value, float) and (np.isnan(value) or np.isinf(value)):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    # A plain `float` has to be listed alongside the numpy one: pandas' nullable
    # Float64 hands back the Python type, which fell through to `str(value)`
    # below — so every decimal reached the table as text and lost its currency
    # and thousands formatting.
    if isinstance(value, (np.floating, float)):
        return stats.safe_float(value)
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if pd.isna(value):
        return None
    return value if isinstance(value, (int, str)) else str(value)
