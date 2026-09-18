"""Descriptive statistics, outlier detection, correlation and trend analysis.

Every number that reaches the UI or the LLM originates here. The LLM is never
asked to compute — only to narrate values produced by these functions.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
import pandas as pd

from app.services import semantics as sem

Grain = Literal["hour", "day", "week", "month", "quarter", "year"]

_GRAIN_FREQ: dict[str, str] = {
    "hour": "h",
    "day": "D",
    "week": "W-MON",
    "month": "MS",
    "quarter": "QS",
    "year": "YS",
}


def safe_float(value: Any) -> float | None:
    """Convert to a JSON-safe float (NaN/Inf become None)."""
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if np.isnan(out) or np.isinf(out):
        return None
    return out


def describe_numeric(series: pd.Series) -> dict[str, Any]:
    """Full descriptive statistics for a numeric column."""
    values = pd.to_numeric(series, errors="coerce").dropna().astype("float64")
    if values.empty:
        return {"count": 0}

    q1, q2, q3 = (float(v) for v in np.percentile(values, [25, 50, 75]))
    iqr = q3 - q1
    mean = float(values.mean())
    std = float(values.std(ddof=1)) if len(values) > 1 else 0.0

    stats: dict[str, Any] = {
        "count": int(values.size),
        "mean": safe_float(mean),
        "median": safe_float(q2),
        "std": safe_float(std),
        "variance": safe_float(std**2),
        "min": safe_float(values.min()),
        "max": safe_float(values.max()),
        "sum": safe_float(values.sum()),
        "range": safe_float(values.max() - values.min()),
        "q1": safe_float(q1),
        "q3": safe_float(q3),
        "iqr": safe_float(iqr),
        "p05": safe_float(np.percentile(values, 5)),
        "p95": safe_float(np.percentile(values, 95)),
        "p99": safe_float(np.percentile(values, 99)),
        "cv": safe_float(std / mean) if mean not in (0, None) else None,
        "zeros": int((values == 0).sum()),
        "negatives": int((values < 0).sum()),
        "skewness": safe_float(values.skew()) if len(values) > 2 else None,
        "kurtosis": safe_float(values.kurtosis()) if len(values) > 3 else None,
    }
    stats["outliers"] = detect_outliers(values, q1=q1, q3=q3, iqr=iqr, mean=mean, std=std)
    stats["histogram"] = build_histogram(values)
    return stats


def detect_outliers(
    values: pd.Series, *, q1: float, q3: float, iqr: float, mean: float, std: float
) -> dict[str, Any]:
    """Flag outliers using Tukey fences, cross-checked with a z-score."""
    if iqr <= 0 or values.empty:
        return {"count": 0, "ratio": 0.0, "lower_bound": None, "upper_bound": None, "examples": []}

    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr
    mask = (values < lower) | (values > upper)
    outliers = values[mask]

    extreme_lower = q1 - 3.0 * iqr
    extreme_upper = q3 + 3.0 * iqr
    extreme_count = int(((values < extreme_lower) | (values > extreme_upper)).sum())

    examples = (
        outliers.reindex(outliers.abs().sort_values(ascending=False).index)
        .head(8)
        .tolist()
    )
    z_count = 0
    if std > 0:
        z_count = int((((values - mean) / std).abs() > 3).sum())

    return {
        "count": int(mask.sum()),
        "ratio": round(float(mask.mean()), 6),
        "lower_bound": safe_float(lower),
        "upper_bound": safe_float(upper),
        "extreme_count": extreme_count,
        "zscore_count": z_count,
        "examples": [safe_float(v) for v in examples],
    }


def build_histogram(values: pd.Series, bins: int = 24) -> list[dict[str, Any]]:
    """Bin a numeric series for a histogram chart."""
    clean = values.dropna()
    if clean.empty:
        return []
    unique = clean.nunique()
    if unique == 1:
        v = float(clean.iloc[0])
        return [{"bin_start": v, "bin_end": v, "label": _fmt_num(v), "count": int(clean.size)}]
    bins = int(min(bins, max(5, unique)))
    counts, edges = np.histogram(clean.to_numpy(), bins=bins)
    return [
        {
            "bin_start": safe_float(edges[i]),
            "bin_end": safe_float(edges[i + 1]),
            "label": f"{_fmt_num(edges[i])} – {_fmt_num(edges[i + 1])}",
            "count": int(counts[i]),
        }
        for i in range(len(counts))
    ]


def _fmt_num(value: float) -> str:
    v = float(value)
    if abs(v) >= 1_000_000:
        return f"{v / 1_000_000:.1f}M"
    if abs(v) >= 1_000:
        return f"{v / 1_000:.1f}k"
    if abs(v) >= 10:
        return f"{v:.0f}"
    return f"{v:.2f}"


def describe_categorical(series: pd.Series, top_n: int = 15) -> dict[str, Any]:
    """Frequency profile for a categorical / geo / boolean column."""
    clean = series.dropna()
    if clean.empty:
        return {"count": 0, "unique": 0, "top_values": []}
    counts = clean.astype("string").value_counts()
    total = int(counts.sum())
    top = counts.head(top_n)
    # Shannon entropy, normalised: 0 = one dominant value, 1 = perfectly even.
    probs = (counts / total).to_numpy()
    entropy = float(-(probs * np.log2(probs)).sum())
    max_entropy = float(np.log2(len(counts))) if len(counts) > 1 else 1.0

    return {
        "count": total,
        "unique": int(counts.size),
        "mode": str(counts.index[0]),
        "mode_count": int(counts.iloc[0]),
        "mode_ratio": round(float(counts.iloc[0] / total), 6),
        "entropy": round(entropy, 4),
        "balance": round(entropy / max_entropy, 4) if max_entropy > 0 else 0.0,
        "top_values": [
            {"value": str(k), "count": int(v), "ratio": round(float(v / total), 6)}
            for k, v in top.items()
        ],
        "rare_values": int((counts == 1).sum()),
    }


def describe_datetime(series: pd.Series) -> dict[str, Any]:
    clean = pd.to_datetime(series, errors="coerce").dropna()
    if clean.empty:
        return {"count": 0}
    span = clean.max() - clean.min()
    return {
        "count": int(clean.size),
        "min": clean.min().isoformat(),
        "max": clean.max().isoformat(),
        "span_days": int(span.days),
        "unique_days": int(clean.dt.normalize().nunique()),
        "suggested_grain": sem._suggest_grain(clean),
        "has_time_component": bool((clean.dt.time != pd.Timestamp("00:00:00").time()).any()),
    }


# --- Correlation ----------------------------------------------------------

def correlation_matrix(
    frame: pd.DataFrame, numeric_columns: list[str], min_abs: float = 0.3
) -> dict[str, Any]:
    """Pearson + Spearman correlations with the notable pairs extracted."""
    usable = [c for c in numeric_columns if c in frame.columns]
    if len(usable) < 2:
        return {"columns": [], "matrix": [], "pairs": []}

    numeric = frame[usable].apply(pd.to_numeric, errors="coerce").astype("float64")
    # Drop constant columns — correlation is undefined for them.
    numeric = numeric.loc[:, numeric.std(ddof=0) > 0]
    if numeric.shape[1] < 2:
        return {"columns": [], "matrix": [], "pairs": []}

    pearson = numeric.corr(method="pearson", min_periods=8)
    try:
        spearman = numeric.corr(method="spearman", min_periods=8)
    except Exception:  # pragma: no cover - scipy edge cases
        spearman = pearson

    cols = list(pearson.columns)
    matrix = [[safe_float(pearson.iloc[i, j]) for j in range(len(cols))] for i in range(len(cols))]

    pairs: list[dict[str, Any]] = []
    for i in range(len(cols)):
        for j in range(i + 1, len(cols)):
            r = safe_float(pearson.iloc[i, j])
            rho = safe_float(spearman.iloc[i, j])
            if r is None and rho is None:
                continue
            # Pearson collapses when a handful of extreme values dominate the
            # variance, so a pair qualifies on whichever coefficient is stronger.
            # Spearman is rank-based and therefore outlier-robust.
            strongest = max(abs(r or 0.0), abs(rho or 0.0))
            if strongest < min_abs:
                continue

            outlier_sensitive = bool(
                r is not None and rho is not None and abs(rho) - abs(r) > 0.2
            )
            primary = rho if (outlier_sensitive and rho is not None) else r
            if primary is None:
                primary = rho or 0.0

            n = int(numeric[[cols[i], cols[j]]].dropna().shape[0])
            pairs.append(
                {
                    "x": cols[i],
                    "y": cols[j],
                    "pearson": round(r, 4) if r is not None else None,
                    "spearman": round(rho, 4) if rho is not None else None,
                    "abs": round(strongest, 4),
                    "coefficient": round(primary, 4),
                    "method": "spearman" if outlier_sensitive else "pearson",
                    "sample_size": n,
                    "strength": _strength_label(strongest),
                    "direction": "positive" if primary > 0 else "negative",
                    # Monotonic but non-linear when Spearman clearly beats Pearson.
                    "non_linear": bool(rho is not None and r is not None and abs(rho) - abs(r) > 0.15),
                    "outlier_sensitive": outlier_sensitive,
                }
            )
    pairs.sort(key=lambda p: p["abs"], reverse=True)
    return {"columns": cols, "matrix": matrix, "pairs": pairs[:25]}


def _strength_label(value: float) -> str:
    if value >= 0.8:
        return "muito forte"
    if value >= 0.6:
        return "forte"
    if value >= 0.4:
        return "moderada"
    return "fraca"


# --- Time series ----------------------------------------------------------

@dataclass
class TrendResult:
    date_column: str
    metric_column: str
    grain: str
    agg: str
    points: list[dict[str, Any]]
    change_pct: float | None
    change_absolute: float | None
    direction: str
    slope: float | None
    r_squared: float | None
    first_value: float | None
    last_value: float | None
    periods: int
    best_period: dict[str, Any] | None
    worst_period: dict[str, Any] | None
    volatility: float | None
    notes: list[str] = None  # type: ignore[assignment]

    def to_dict(self) -> dict[str, Any]:
        return {
            "date_column": self.date_column,
            "metric_column": self.metric_column,
            "grain": self.grain,
            "agg": self.agg,
            "points": self.points,
            "change_pct": self.change_pct,
            "change_absolute": self.change_absolute,
            "direction": self.direction,
            "slope": self.slope,
            "r_squared": self.r_squared,
            "first_value": self.first_value,
            "last_value": self.last_value,
            "periods": self.periods,
            "best_period": self.best_period,
            "worst_period": self.worst_period,
            "volatility": self.volatility,
            "notes": self.notes or [],
        }


def resample_series(
    frame: pd.DataFrame,
    date_column: str,
    metric_column: str,
    grain: str,
    agg: str = "sum",
    trim_partial: bool = True,
) -> tuple[pd.Series, list[str]]:
    """Aggregate a metric over time at the requested grain.

    The first and last buckets are dropped when the data does not span them
    fully. A half-finished month otherwise looks like a collapse and would make
    the trend engine report a decline that never happened.
    """
    freq = _GRAIN_FREQ.get(grain, "MS")
    working = pd.DataFrame(
        {
            "_ts": pd.to_datetime(frame[date_column], errors="coerce"),
            "_value": pd.to_numeric(frame[metric_column], errors="coerce"),
        }
    ).dropna(subset=["_ts"])
    if working.empty:
        return pd.Series(dtype="float64"), []

    grouped = working.set_index("_ts")["_value"].resample(freq)
    result = getattr(grouped, agg)() if hasattr(grouped, agg) else grouped.sum()
    result = result.dropna()
    if not trim_partial or result.size < 3:
        return result, []

    ts_min, ts_max = working["_ts"].min(), working["_ts"].max()
    return _trim_partial_periods(result, ts_min, ts_max, freq)


def _bucket_end(start: pd.Timestamp, freq: str) -> pd.Timestamp:
    """Exclusive end of the bucket that begins at `start`."""
    return start + pd.tseries.frequencies.to_offset(freq)


def _bucket_coverage(
    start: pd.Timestamp, ts_min: pd.Timestamp, ts_max: pd.Timestamp, freq: str
) -> float:
    """How much of the bucket beginning at `start` the data actually spans."""
    end = _bucket_end(start, freq)
    span = (end - start).total_seconds()
    if span <= 0:
        return 1.0
    # Date-only data stamps every record at midnight, so a single-day bucket
    # would otherwise measure zero coverage.
    if span <= 86400:
        return 1.0
    covered = (min(end, ts_max) - max(start, ts_min)).total_seconds()
    return max(0.0, covered / span)


def partial_boundary_periods(timestamps: pd.Series, grain: str) -> list[pd.Timestamp]:
    """The edge buckets of `timestamps` that the data does not fully span.

    The same rule `resample_series` trims by, exposed so that *any* time-grain
    aggregation can drop a half-finished month rather than draw it as a
    collapse. Returns bucket start timestamps, never more than the two edges,
    and nothing at all unless enough buckets remain to still be a series.
    """
    parsed = pd.to_datetime(timestamps, errors="coerce").dropna()
    if parsed.empty:
        return []

    freq = _GRAIN_FREQ.get(grain, "MS")
    occupied = pd.Series(1, index=pd.DatetimeIndex(parsed)).resample(freq).sum()
    occupied = occupied[occupied > 0]
    if occupied.size < 4:
        return []

    ts_min, ts_max = parsed.min(), parsed.max()
    edges = [occupied.index[0], occupied.index[-1]]
    return [start for start in edges if _bucket_coverage(start, ts_min, ts_max, freq) < 0.9]


def _trim_partial_periods(
    series: pd.Series, ts_min: pd.Timestamp, ts_max: pd.Timestamp, freq: str
) -> tuple[pd.Series, list[str]]:
    """Drop boundary buckets covered by less than 90% of their calendar span."""
    notes: list[str] = []
    if series.size < 3:
        return series, notes

    def coverage(start: pd.Timestamp) -> float:
        return _bucket_coverage(start, ts_min, ts_max, freq)

    drop_first = coverage(series.index[0]) < 0.9
    drop_last = coverage(series.index[-1]) < 0.9

    trimmed = series
    if drop_last and trimmed.size > 3:
        notes.append(
            f"Período final ({trimmed.index[-1].date().isoformat()}) excluído por estar incompleto."
        )
        trimmed = trimmed.iloc[:-1]
    if drop_first and trimmed.size > 3:
        notes.append(
            f"Período inicial ({trimmed.index[0].date().isoformat()}) excluído por estar incompleto."
        )
        trimmed = trimmed.iloc[1:]
    return trimmed, notes


def analyse_trend(
    frame: pd.DataFrame,
    date_column: str,
    metric_column: str,
    grain: str = "month",
    agg: str = "sum",
    max_points: int = 400,
) -> TrendResult | None:
    """Compute a time series plus its trend statistics."""
    series, trim_notes = resample_series(frame, date_column, metric_column, grain, agg)
    if series.size < 3:
        return None
    if series.size > max_points:
        series = series.iloc[-max_points:]

    values = series.to_numpy(dtype="float64")
    x = np.arange(len(values), dtype="float64")

    slope = r2 = None
    if len(values) > 2 and np.std(values) > 0:
        slope_val, intercept = np.polyfit(x, values, 1)
        predicted = slope_val * x + intercept
        ss_res = float(((values - predicted) ** 2).sum())
        ss_tot = float(((values - values.mean()) ** 2).sum())
        slope = safe_float(slope_val)
        r2 = safe_float(1 - ss_res / ss_tot) if ss_tot > 0 else None

    first, last = float(values[0]), float(values[-1])
    change_abs = last - first
    change_pct = (change_abs / abs(first) * 100) if first != 0 else None

    if change_pct is None:
        direction = "flat"
    elif change_pct > 3:
        direction = "up"
    elif change_pct < -3:
        direction = "down"
    else:
        direction = "flat"

    idx_max, idx_min = int(np.argmax(values)), int(np.argmin(values))
    mean_val = float(values.mean())
    volatility = safe_float(float(values.std(ddof=0)) / abs(mean_val)) if mean_val else None

    points = [
        {"period": ts.isoformat(), "label": _period_label(ts, grain), "value": safe_float(v)}
        for ts, v in zip(series.index, values, strict=True)
    ]

    return TrendResult(
        date_column=date_column,
        metric_column=metric_column,
        grain=grain,
        agg=agg,
        points=points,
        change_pct=round(change_pct, 2) if change_pct is not None else None,
        change_absolute=safe_float(change_abs),
        direction=direction,
        slope=slope,
        r_squared=round(r2, 4) if r2 is not None else None,
        first_value=safe_float(first),
        last_value=safe_float(last),
        periods=len(values),
        best_period={"label": points[idx_max]["label"], "value": safe_float(values[idx_max])},
        worst_period={"label": points[idx_min]["label"], "value": safe_float(values[idx_min])},
        volatility=round(volatility, 4) if volatility is not None else None,
        notes=trim_notes,
    )


def _period_label(ts: pd.Timestamp, grain: str) -> str:
    if grain == "hour":
        return ts.strftime("%d/%m %Hh")
    if grain == "day":
        return ts.strftime("%d/%m/%Y")
    if grain == "week":
        return f"Sem. {ts.strftime('%d/%m/%Y')}"
    if grain == "month":
        return ts.strftime("%m/%Y")
    if grain == "quarter":
        return f"T{(ts.month - 1) // 3 + 1}/{ts.year}"
    return str(ts.year)


def detect_period_anomalies(trend: TrendResult, z_threshold: float = 2.0) -> list[dict[str, Any]]:
    """Find periods whose period-over-period change is statistically unusual."""
    values = np.array([p["value"] for p in trend.points if p["value"] is not None], dtype="float64")
    labels = [p["label"] for p in trend.points if p["value"] is not None]
    if values.size < 5:
        return []

    deltas = np.diff(values)
    prev = values[:-1]
    with np.errstate(divide="ignore", invalid="ignore"):
        pct = np.where(prev != 0, deltas / np.abs(prev) * 100, np.nan)
    finite = pct[np.isfinite(pct)]
    if finite.size < 4:
        return []
    mu, sigma = float(finite.mean()), float(finite.std(ddof=0))
    if sigma <= 0:
        return []

    anomalies: list[dict[str, Any]] = []
    for i, change in enumerate(pct):
        if not np.isfinite(change):
            continue
        z = (change - mu) / sigma
        if abs(z) < z_threshold:
            continue
        anomalies.append(
            {
                "period": labels[i + 1],
                "previous_period": labels[i],
                "value": safe_float(values[i + 1]),
                "previous_value": safe_float(values[i]),
                "change_pct": round(float(change), 2),
                "z_score": round(float(z), 2),
                "direction": "queda" if change < 0 else "alta",
            }
        )
    anomalies.sort(key=lambda a: abs(a["z_score"]), reverse=True)
    return anomalies[:5]


# --- Category breakdown ---------------------------------------------------

def category_breakdown(
    frame: pd.DataFrame,
    dimension: str,
    metric: str | None,
    agg: str = "sum",
    top_n: int = 12,
) -> dict[str, Any]:
    """Aggregate a metric by a dimension, with concentration analysis."""
    if dimension not in frame.columns:
        return {"items": [], "total": None}

    dim_values = frame[dimension].astype("string").fillna("(vazio)")
    if metric is None or metric not in frame.columns or agg == "count":
        grouped = dim_values.value_counts()
        agg_used = "count"
    else:
        values = pd.to_numeric(frame[metric], errors="coerce")
        grouped = values.groupby(dim_values).agg(agg).dropna()
        grouped = grouped.sort_values(ascending=False)
        agg_used = agg

    if grouped.empty:
        return {"items": [], "total": None}

    total = float(grouped.sum())
    items = [
        {
            "label": str(label),
            "value": safe_float(value),
            "ratio": round(float(value / total), 6) if total else None,
        }
        for label, value in grouped.head(top_n).items()
    ]
    others_count = int(max(0, grouped.size - top_n))
    others_value = safe_float(float(grouped.iloc[top_n:].sum())) if others_count else None

    # Concentration: what share do the top 3 (or 20%) of categories hold?
    sorted_vals = grouped.sort_values(ascending=False).to_numpy(dtype="float64")
    top3_share = float(sorted_vals[:3].sum() / total) if total else 0.0
    cutoff = max(1, int(np.ceil(len(sorted_vals) * 0.2)))
    pareto_share = float(sorted_vals[:cutoff].sum() / total) if total else 0.0

    return {
        "dimension": dimension,
        "metric": metric if agg_used != "count" else None,
        "agg": agg_used,
        "items": items,
        "total": safe_float(total),
        "distinct": int(grouped.size),
        "others_count": others_count,
        "others_value": others_value,
        "top3_share": round(top3_share, 4),
        "pareto_share": round(pareto_share, 4),
        "leader": items[0] if items else None,
        "laggard": {
            "label": str(grouped.index[-1]),
            "value": safe_float(float(grouped.iloc[-1])),
        }
        if grouped.size > 1
        else None,
    }
