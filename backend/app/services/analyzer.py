"""The analysis pipeline.

Turns raw CSV bytes into the full analytical document the product is built on:
profile → semantics → statistics → domain → insights → recommendations.
"""
from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pandas as pd

from app.core.config import settings
from app.services import domain as domain_mod
from app.services import ingestion, profiling, recommender
from app.services import insights as insights_mod
from app.services import quality as quality_mod
from app.services import semantics as sem
from app.services import statistics as stats

logger = logging.getLogger(__name__)

# Guard rails on how much analysis work a single dataset can trigger.
_MAX_TRENDS = 6
_MAX_BREAKDOWNS = 8
_MAX_BREAKDOWN_CARDINALITY = 200


StageCallback = Callable[[str], None]


def _stage_reporter(on_stage: StageCallback | None) -> StageCallback:
    """Progress reporting must never be able to fail an analysis."""
    if on_stage is None:
        return lambda _stage: None

    def report(stage: str) -> None:
        try:
            on_stage(stage)
        except Exception:  # pragma: no cover - a broken reporter is not fatal
            logger.debug("Falha ao reportar o estágio %s", stage, exc_info=True)

    return report


@dataclass
class AnalysisBundle:
    frame: pd.DataFrame
    profile: dict[str, Any]
    semantics: dict[str, Any]
    analysis: dict[str, Any]
    warnings: list[str]

    @property
    def quality_score(self) -> int:
        return int(self.analysis["quality"]["score"])

    @property
    def domain_key(self) -> str:
        return str(self.analysis["domain"]["key"])


def analyse_csv_bytes(
    raw: bytes,
    *,
    filename: str = "dataset.csv",
    on_stage: StageCallback | None = None,
) -> AnalysisBundle:
    """Full pipeline entry point for an uploaded file.

    `on_stage` is invoked as each phase begins, so the client can show what the
    server is really doing instead of animating a plausible sequence.
    """
    started = time.perf_counter()
    report = _stage_reporter(on_stage)

    report("read")
    read = ingestion.read_csv_bytes(raw, filename=filename)

    report("schema")
    typed_frame, column_semantics = sem.analyse_schema(read.frame)

    bundle = analyse_frame(
        typed_frame,
        column_semantics,
        original_row_count=read.original_row_count,
        encoding=read.encoding,
        delimiter=read.delimiter,
        warnings=list(read.warnings),
        on_stage=on_stage,
    )
    bundle.analysis["meta"]["duration_ms"] = int((time.perf_counter() - started) * 1000)
    return bundle


def analyse_frame(
    frame: pd.DataFrame,
    column_semantics: list[sem.ColumnSemantics],
    *,
    original_row_count: int | None = None,
    encoding: str = "utf-8",
    delimiter: str = ",",
    warnings: list[str] | None = None,
    on_stage: StageCallback | None = None,
) -> AnalysisBundle:
    """Run every analytical stage over an already-typed DataFrame."""
    warnings = list(warnings or [])
    report = _stage_reporter(on_stage)

    # Large datasets are profiled on a deterministic sample so the pipeline
    # stays responsive; the full frame is still what queries run against.
    analysis_frame = frame
    sampled = False
    if len(frame) > settings.sample_rows_for_analysis:
        analysis_frame = frame.sample(
            n=settings.sample_rows_for_analysis, random_state=42
        ).sort_index()
        sampled = True
        warnings.append(
            f"Estatísticas calculadas sobre uma amostra de "
            f"{settings.sample_rows_for_analysis:,} linhas.".replace(",", ".")
        )

    report("schema")
    profile = profiling.profile_dataset(
        analysis_frame,
        column_semantics,
        original_row_count=original_row_count,
        encoding=encoding,
        delimiter=delimiter,
    )
    # Row counts must always reflect the real dataset, not the sample.
    profile["overview"]["row_count"] = int(len(frame))
    profile["overview"]["sampled_for_stats"] = sampled

    report("patterns")
    domain_info = domain_mod.detect_domain([c["name"] for c in profile["columns"]])

    metric_columns = [c["name"] for c in profile["columns"] if c["role"] == sem.METRIC]
    dimension_columns = [c["name"] for c in profile["columns"] if c["role"] == sem.DIMENSION]
    temporal_columns = [c["name"] for c in profile["columns"] if c["role"] == sem.TEMPORAL]

    report("relations")
    correlations = stats.correlation_matrix(analysis_frame, metric_columns)
    trends, anomalies = _build_trends(analysis_frame, profile, temporal_columns, metric_columns, domain_info)
    breakdowns = _build_breakdowns(analysis_frame, profile, dimension_columns, metric_columns, domain_info)

    analysis: dict[str, Any] = {
        "domain": domain_info,
        "correlations": correlations,
        "trends": [t.to_dict() for t in trends],
        "anomalies": anomalies,
        "breakdowns": breakdowns,
        "columns": {
            "metrics": metric_columns,
            "dimensions": dimension_columns,
            "temporal": temporal_columns,
            "identifiers": [c["name"] for c in profile["columns"] if c["role"] == sem.IDENTITY],
        },
        "meta": {
            "sampled": sampled,
            "analysed_rows": int(len(analysis_frame)),
            "duration_ms": 0,
        },
    }

    report("insights")
    analysis["quality"] = quality_mod.score_dataset(profile)
    analysis["insights"] = insights_mod.generate_insights(
        analysis_frame, profile, analysis, analysis["quality"], domain_info
    )
    report("charts")
    analysis["recommendations"] = recommender.recommend(
        analysis_frame, profile, analysis, domain_info
    )
    analysis["kpis"] = recommender.recommend_kpis(
        analysis_frame, profile, analysis, domain_info
    )
    analysis["warnings"] = warnings

    semantics_doc = {
        "columns": [c.to_dict() for c in column_semantics],
        "domain": domain_info,
    }
    return AnalysisBundle(
        frame=frame,
        profile=profile,
        semantics=semantics_doc,
        analysis=analysis,
        warnings=warnings,
    )


def _build_trends(
    frame: pd.DataFrame,
    profile: dict[str, Any],
    temporal_columns: list[str],
    metric_columns: list[str],
    domain_info: dict[str, Any],
) -> tuple[list[stats.TrendResult], list[dict[str, Any]]]:
    """Compute a time series per (best date column × ranked metric)."""
    if not temporal_columns:
        return [], []

    by_name = {c["name"]: c for c in profile["columns"]}
    # Prefer the date column with the widest coverage and most distinct days.
    def date_rank(name: str) -> tuple[float, int]:
        col_stats = by_name[name].get("stats") or {}
        return (-(1 - by_name[name]["missing_ratio"]), -int(col_stats.get("unique_days", 0)))

    primary_dates = sorted(temporal_columns, key=date_rank)[:2]
    ranked_metrics = domain_mod.rank_metric_columns(domain_info["key"], metric_columns)

    trends: list[stats.TrendResult] = []
    anomalies: list[dict[str, Any]] = []

    for date_col in primary_dates:
        col_stats = by_name[date_col].get("stats") or {}
        grain = col_stats.get("suggested_grain", "month")
        for metric in ranked_metrics:
            if len(trends) >= _MAX_TRENDS:
                break
            agg = (by_name[metric]["detail"] or {}).get("default_agg", "sum")
            trend = stats.analyse_trend(frame, date_col, metric, grain=grain, agg=agg)
            if trend is None:
                continue
            trends.append(trend)
            for anomaly in stats.detect_period_anomalies(trend):
                anomalies.append({**anomaly, "metric_column": metric, "date_column": date_col})
        # Only widen to a second date column when the first produced nothing.
        if trends:
            break

    anomalies.sort(key=lambda a: abs(a["z_score"]), reverse=True)
    return trends, anomalies[:6]


def _build_breakdowns(
    frame: pd.DataFrame,
    profile: dict[str, Any],
    dimension_columns: list[str],
    metric_columns: list[str],
    domain_info: dict[str, Any],
) -> list[dict[str, Any]]:
    """Aggregate the leading metric across every usable dimension."""
    by_name = {c["name"]: c for c in profile["columns"]}
    ranked_metrics = domain_mod.rank_metric_columns(domain_info["key"], metric_columns)
    primary_metric = ranked_metrics[0] if ranked_metrics else None

    usable = [
        d for d in dimension_columns
        if 1 < by_name[d]["unique_count"] <= _MAX_BREAKDOWN_CARDINALITY
    ]
    # Dimensions with a moderate number of values tell the clearest story.
    usable.sort(key=lambda d: abs(by_name[d]["unique_count"] - 8))

    primary_agg = (
        (by_name[primary_metric]["detail"] or {}).get("default_agg", "sum")
        if primary_metric
        else "count"
    )

    breakdowns: list[dict[str, Any]] = []
    for dim in usable[:_MAX_BREAKDOWNS]:
        result = stats.category_breakdown(frame, dim, primary_metric, agg=primary_agg)
        if result["items"]:
            breakdowns.append(result)

    # A second metric across the top dimension adds a genuinely new angle.
    if len(ranked_metrics) > 1 and usable:
        secondary_metric = ranked_metrics[1]
        secondary_agg = (by_name[secondary_metric]["detail"] or {}).get("default_agg", "mean")
        secondary = stats.category_breakdown(
            frame, usable[0], secondary_metric, agg=secondary_agg
        )
        if secondary["items"]:
            breakdowns.append(secondary)
    return breakdowns
