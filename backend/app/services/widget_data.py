"""Resolve the data behind a single widget.

Each chart type declares what shape of data it needs; this module translates
an encoding into a safe QueryPlan (or a direct statistical computation) and
returns rows the frontend can render without further processing.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.core.errors import ValidationError
from app.services import query_engine as qe
from app.services import semantics as sem
from app.services import statistics as stats

_SCATTER_SAMPLE = 3000
_RAW_LIMIT = 500


def resolve(
    frame: pd.DataFrame,
    profile: dict[str, Any],
    analysis: dict[str, Any],
    *,
    chart_type: str,
    encoding: dict[str, Any],
    filters: list[dict[str, Any]] | None = None,
    limit: int = 200,
) -> dict[str, Any]:
    """Return {columns, rows, row_count, truncated, notes, meta} for a widget."""
    guard = qe.SchemaGuard(profile["columns"])
    filter_specs = _build_filters(filters or [], guard)

    if chart_type == "histogram":
        return _histogram(frame, profile, encoding, guard, filter_specs)
    if chart_type == "box_plot":
        return _box_plot(frame, profile, encoding, guard, filter_specs)
    if chart_type == "scatter":
        return _scatter(frame, encoding, guard, filter_specs)
    if chart_type == "heatmap" and encoding.get("matrix") == "correlation":
        return _correlation_matrix(analysis)
    if chart_type == "table":
        return _table(frame, encoding, guard, filter_specs, limit)

    return _aggregate(frame, encoding, guard, filter_specs, chart_type, limit)


def _build_filters(raw: list[dict[str, Any]], guard: qe.SchemaGuard) -> list[qe.Filter]:
    """Validate incoming filters, dropping the empty ones the UI sends."""
    specs: list[qe.Filter] = []
    for item in raw:
        column = item.get("column")
        if not column or guard.resolve(column) is None:
            continue
        op = item.get("op", "eq")
        value = item.get("value")
        if op in {"is_null", "not_null"}:
            specs.append(qe.Filter(column=column, op=op, value=None))
            continue
        if value is None or (isinstance(value, (list, tuple)) and len(value) == 0):
            continue
        if op == "between" and (not isinstance(value, (list, tuple)) or len(value) != 2):
            continue
        if op == "between" and any(v in (None, "") for v in value):
            continue
        specs.append(qe.Filter(column=column, op=op, value=value))
    return specs


def _apply_filters(
    frame: pd.DataFrame, filters: list[qe.Filter], guard: qe.SchemaGuard
) -> pd.DataFrame:
    working = frame
    for flt in filters:
        column = guard.require(flt.column)
        mask = qe._build_mask(working, column, flt, guard)
        if mask is not None:
            working = working[mask]
    return working


def _aggregate(
    frame: pd.DataFrame,
    encoding: dict[str, Any],
    guard: qe.SchemaGuard,
    filters: list[qe.Filter],
    chart_type: str,
    limit: int,
) -> dict[str, Any]:
    """Group-by aggregation used by line, bar, area, donut, treemap, map…"""
    x = encoding.get("x")
    y = encoding.get("y")
    series = encoding.get("series")
    agg = encoding.get("agg") or "sum"

    if agg == "none":
        agg = "sum"

    group_by: list[str] = []
    if x:
        group_by.append(guard.require(x, what="coluna do eixo X"))
    if series:
        group_by.append(guard.require(series, what="coluna de série"))

    metrics: list[qe.MetricSpec] = []
    if y and guard.resolve(y) is not None:
        metrics.append(qe.MetricSpec(column=guard.require(y), agg=agg))
    else:
        metrics.append(qe.MetricSpec(column=None, agg="count"))

    # A second measure on the same axis (dual-axis line charts).
    y2 = encoding.get("y2")
    if y2 and guard.resolve(y2) is not None:
        metrics.append(
            qe.MetricSpec(column=guard.require(y2), agg=encoding.get("agg2") or agg)
        )

    is_temporal = bool(group_by) and guard.is_temporal(group_by[0])
    plan = qe.QueryPlan(
        group_by=group_by,
        metrics=metrics,
        filters=filters,
        time_grain=encoding.get("time_grain") if is_temporal else None,
        sort_by=None if is_temporal else metrics[0].output_name,
        sort_desc=encoding.get("sort", "desc") != "asc",
        limit=min(int(encoding.get("limit") or limit), 5000),
        include_others=chart_type in {"donut", "pie", "treemap"},
    )
    result = qe.execute(frame, plan, guard)
    return {
        **result.to_dict(),
        "meta": {"chart_type": chart_type, "temporal": is_temporal, "agg": agg},
    }


def _histogram(
    frame: pd.DataFrame,
    profile: dict[str, Any],
    encoding: dict[str, Any],
    guard: qe.SchemaGuard,
    filters: list[qe.Filter],
) -> dict[str, Any]:
    column = guard.require(encoding.get("x") or encoding.get("y"), what="coluna do histograma")
    working = _apply_filters(frame, filters, guard)
    values = pd.to_numeric(working[column], errors="coerce").dropna()
    if values.empty:
        return _empty("histogram", ["label", "count"])

    bins = int(encoding.get("bins") or 24)
    histogram = stats.build_histogram(values, bins=bins)
    rows = [
        {
            "label": b["label"],
            "count": b["count"],
            "bin_start": b["bin_start"],
            "bin_end": b["bin_end"],
        }
        for b in histogram
    ]
    return {
        "columns": ["label", "count"],
        "rows": rows,
        "row_count": len(rows),
        "truncated": False,
        "notes": [],
        "meta": {
            "chart_type": "histogram",
            "column": column,
            "mean": stats.safe_float(values.mean()),
            "median": stats.safe_float(values.median()),
            "total_values": int(values.size),
        },
    }


def _box_plot(
    frame: pd.DataFrame,
    profile: dict[str, Any],
    encoding: dict[str, Any],
    guard: qe.SchemaGuard,
    filters: list[qe.Filter],
) -> dict[str, Any]:
    column = guard.require(encoding.get("y") or encoding.get("x"), what="coluna do box plot")
    working = _apply_filters(frame, filters, guard)
    group_column = encoding.get("x") if encoding.get("y") and encoding.get("x") else None

    def summarise(values: pd.Series, label: str) -> dict[str, Any] | None:
        clean = pd.to_numeric(values, errors="coerce").dropna()
        if clean.size < 4:
            return None
        q1, q2, q3 = (float(v) for v in np.percentile(clean, [25, 50, 75]))
        iqr = q3 - q1
        low = max(float(clean.min()), q1 - 1.5 * iqr)
        high = min(float(clean.max()), q3 + 1.5 * iqr)
        outliers = clean[(clean < low) | (clean > high)]
        return {
            "label": label,
            "min": stats.safe_float(low),
            "q1": stats.safe_float(q1),
            "median": stats.safe_float(q2),
            "q3": stats.safe_float(q3),
            "max": stats.safe_float(high),
            "outlier_count": int(outliers.size),
            "outliers": [stats.safe_float(v) for v in outliers.head(30)],
        }

    rows: list[dict[str, Any]] = []
    if group_column and guard.resolve(group_column):
        group_column = guard.require(group_column)
        labels = working[group_column].astype("string").fillna("(vazio)")
        for label, group in working.groupby(labels, observed=True):
            entry = summarise(group[column], str(label))
            if entry:
                rows.append(entry)
        rows = rows[:20]
    else:
        entry = summarise(working[column], sem.humanize(column))
        if entry:
            rows.append(entry)

    if not rows:
        return _empty("box_plot", ["label", "min", "q1", "median", "q3", "max"])
    return {
        "columns": ["label", "min", "q1", "median", "q3", "max"],
        "rows": rows,
        "row_count": len(rows),
        "truncated": False,
        "notes": [],
        "meta": {"chart_type": "box_plot", "column": column},
    }


def _scatter(
    frame: pd.DataFrame,
    encoding: dict[str, Any],
    guard: qe.SchemaGuard,
    filters: list[qe.Filter],
) -> dict[str, Any]:
    x = guard.require(encoding.get("x"), what="coluna do eixo X")
    y = guard.require(encoding.get("y"), what="coluna do eixo Y")
    working = _apply_filters(frame, filters, guard)

    data = pd.DataFrame(
        {
            x: pd.to_numeric(working[x], errors="coerce"),
            y: pd.to_numeric(working[y], errors="coerce"),
        }
    ).dropna()
    total = int(len(data))
    if total == 0:
        return _empty("scatter", [x, y])

    series_column = encoding.get("series")
    if series_column and guard.resolve(series_column):
        series_column = guard.require(series_column)
        data[series_column] = working.loc[data.index, series_column].astype("string")

    truncated = total > _SCATTER_SAMPLE
    if truncated:
        # A deterministic sample keeps the plot readable and the payload small
        # without changing the visible shape of the relationship.
        data = data.sample(n=_SCATTER_SAMPLE, random_state=42).sort_index()

    regression = None
    if total >= 3:
        xs = data[x].to_numpy(dtype="float64")
        ys = data[y].to_numpy(dtype="float64")
        if np.std(xs) > 0:
            slope, intercept = np.polyfit(xs, ys, 1)
            regression = {
                "slope": stats.safe_float(slope),
                "intercept": stats.safe_float(intercept),
                "x_min": stats.safe_float(xs.min()),
                "x_max": stats.safe_float(xs.max()),
            }

    rows = [
        {k: qe._jsonable(v) for k, v in record.items()}
        for record in data.to_dict(orient="records")
    ]
    return {
        "columns": list(data.columns),
        "rows": rows,
        "row_count": total,
        "truncated": truncated,
        "notes": (
            [f"Exibindo uma amostra de {_SCATTER_SAMPLE:,} de {total:,} pontos.".replace(",", ".")]
            if truncated
            else []
        ),
        "meta": {"chart_type": "scatter", "x": x, "y": y, "regression": regression},
    }


def _correlation_matrix(analysis: dict[str, Any]) -> dict[str, Any]:
    corr = analysis.get("correlations") or {}
    columns = corr.get("columns") or []
    matrix = corr.get("matrix") or []
    rows: list[dict[str, Any]] = []
    for i, row_name in enumerate(columns):
        for j, col_name in enumerate(columns):
            value = matrix[i][j] if i < len(matrix) and j < len(matrix[i]) else None
            rows.append({"x": col_name, "y": row_name, "value": value})
    return {
        "columns": ["x", "y", "value"],
        "rows": rows,
        "row_count": len(rows),
        "truncated": False,
        "notes": [],
        "meta": {"chart_type": "heatmap", "axis_labels": columns, "scale": "diverging"},
    }


def _table(
    frame: pd.DataFrame,
    encoding: dict[str, Any],
    guard: qe.SchemaGuard,
    filters: list[qe.Filter],
    limit: int,
) -> dict[str, Any]:
    from app.services import profiling

    working = _apply_filters(frame, filters, guard)
    requested = encoding.get("columns") or []
    columns = [c for c in (guard.resolve(r) for r in requested) if c] or list(frame.columns)
    offset = int(encoding.get("offset") or 0)
    page = min(int(limit), _RAW_LIMIT)

    subset = working[columns]
    rows = profiling.sample_rows(subset, limit=page, offset=offset)
    return {
        "columns": columns,
        "rows": rows,
        "row_count": int(len(working)),
        "truncated": int(len(working)) > offset + page,
        "notes": [],
        "meta": {"chart_type": "table", "offset": offset, "limit": page},
    }


def _empty(chart_type: str, columns: list[str]) -> dict[str, Any]:
    return {
        "columns": columns,
        "rows": [],
        "row_count": 0,
        "truncated": False,
        "notes": ["Nenhum dado disponível para esta configuração."],
        "meta": {"chart_type": chart_type},
    }


def suggest_chart(
    profile: dict[str, Any], x: str | None, y: str | None, series: str | None
) -> tuple[str, str]:
    """Recommend a chart type for an ad-hoc Explore selection."""
    by_name = {c["name"]: c for c in profile["columns"]}
    x_meta = by_name.get(x or "")
    y_meta = by_name.get(y or "")

    if x_meta is None:
        return "kpi", "Sem dimensão selecionada, o resultado é um valor agregado único."

    if x_meta["role"] == sem.TEMPORAL:
        return "line", (
            "O eixo X é uma coluna temporal: linhas representam a taxa de variação "
            "pela inclinação do traço."
        )
    if (
        y_meta is not None
        and y_meta["semantic_type"] in sem.NUMERIC_TYPES
        and x_meta["semantic_type"] in sem.NUMERIC_TYPES
    ):
        return "scatter", (
            "Ambos os eixos são contínuos: a dispersão mostra a relação ponto a ponto."
        )
    if series:
        return "stacked_bar", (
            "Com duas dimensões e uma medida, barras empilhadas mantêm o total "
            "por categoria e revelam a composição."
        )
    if x_meta["unique_count"] <= 6:
        return "donut", (
            f"“{x_meta['name']}” tem apenas {x_meta['unique_count']} categorias, "
            "poucas o suficiente para uma leitura de participação."
        )
    if x_meta["unique_count"] > 8:
        return "bar_horizontal", (
            f"Com {x_meta['unique_count']} categorias, a orientação horizontal evita "
            "rótulos rotacionados."
        )
    return "bar", "Comparação entre categorias é lida com precisão em barras."
