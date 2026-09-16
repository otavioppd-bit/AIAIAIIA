"""Fact-sheet construction.

The LLM only ever sees these compact, pre-computed documents — never the raw
dataset. That bounds token cost, keeps user data exposure minimal, and makes
it structurally impossible for the model to "read" a number we did not compute.
"""
from __future__ import annotations

from typing import Any

from app.services import semantics as sem

_MAX_SAMPLE_VALUES = 6
_MAX_TREND_POINTS = 24
_MAX_ROWS_IN_FACTS = 40


def schema_context(profile: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    """Compact column catalogue used by the query planner."""
    columns = []
    for col in profile["columns"]:
        if col["role"] == sem.FREE_TEXT and col["unique_count"] > 100:
            continue
        entry: dict[str, Any] = {
            "name": col["name"],
            "type": col["semantic_type"],
            "role": col["role"],
            "unique": col["unique_count"],
        }
        detail = col.get("detail") or {}
        if col["role"] == sem.METRIC:
            entry["additive"] = detail.get("additive", True)
            entry["default_agg"] = detail.get("default_agg", "sum")
        if col["semantic_type"] in {sem.CATEGORICAL, sem.GEO} and col["unique_count"] <= 40:
            values = [v["value"] for v in (detail.get("top_values") or [])]
            if not values:
                values = [str(v) for v in col.get("sample_values", [])]
            entry["examples"] = values[:_MAX_SAMPLE_VALUES]
        if col["role"] == sem.TEMPORAL:
            col_stats = col.get("stats") or {}
            entry["range"] = [col_stats.get("min"), col_stats.get("max")]
            entry["suggested_grain"] = col_stats.get("suggested_grain")
        columns.append(entry)

    return {
        "row_count": profile["overview"]["row_count"],
        "domain": analysis["domain"]["label"],
        "columns": columns,
    }


def dataset_facts(profile: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    """The full fact sheet used for narration and curation."""
    overview = profile["overview"]
    quality = analysis["quality"]

    trends = []
    for trend in analysis.get("trends", [])[:4]:
        trends.append(
            {
                "metric": trend["metric_column"],
                "aggregation": trend.get("agg", "sum"),
                "grain": trend["grain"],
                "periods": trend["periods"],
                "from": {"period": trend["points"][0]["label"], "value": trend["first_value"]},
                "to": {"period": trend["points"][-1]["label"], "value": trend["last_value"]},
                "change_pct": trend["change_pct"],
                "direction": trend["direction"],
                "best_period": trend.get("best_period"),
                "worst_period": trend.get("worst_period"),
                "r_squared": trend.get("r_squared"),
                "excluded_periods": trend.get("notes", []),
            }
        )

    breakdowns = []
    for breakdown in analysis.get("breakdowns", [])[:5]:
        breakdowns.append(
            {
                "dimension": breakdown["dimension"],
                "metric": breakdown.get("metric"),
                "aggregation": breakdown.get("agg"),
                "distinct_values": breakdown["distinct"],
                "total": breakdown.get("total"),
                "top": breakdown["items"][:5],
                "top3_share": breakdown.get("top3_share"),
            }
        )

    return {
        "overview": {
            "rows": overview["row_count"],
            "columns": overview["column_count"],
            "missing_ratio": overview["missing_ratio"],
            "duplicate_rows": overview["duplicate_rows"],
        },
        "domain": analysis["domain"],
        "quality": {
            "score": quality["score"],
            "label": quality["label"],
            "top_issues": [
                {"severity": i["severity"], "title": i["title"]} for i in quality["issues"][:4]
            ],
        },
        "metrics": analysis["columns"]["metrics"],
        "dimensions": analysis["columns"]["dimensions"],
        "temporal": analysis["columns"]["temporal"],
        "trends": trends,
        "anomalies": analysis.get("anomalies", [])[:4],
        "breakdowns": breakdowns,
        "correlations": analysis.get("correlations", {}).get("pairs", [])[:5],
        "computed_insights": [
            {"title": i["title"], "detail": i["description"], "kind": i["kind"]}
            for i in analysis.get("insights", [])[:10]
        ],
    }


def answer_facts(
    question: str,
    plan: dict[str, Any],
    result: dict[str, Any],
    analysis: dict[str, Any],
) -> dict[str, Any]:
    """Facts for narrating one executed query — the rows and nothing else."""
    rows = result.get("rows", [])[:_MAX_ROWS_IN_FACTS]
    return {
        "question": question,
        "executed_plan": {
            "group_by": plan.get("group_by"),
            "metrics": plan.get("metrics"),
            "filters": plan.get("filters"),
            "time_grain": plan.get("time_grain"),
            "limit": plan.get("limit"),
        },
        "result": {
            "columns": result.get("columns"),
            "rows": rows,
            "total_groups": result.get("row_count"),
            "truncated": result.get("truncated"),
            "notes": result.get("notes", []),
        },
        "dataset_context": {
            "total_rows": analysis.get("meta", {}).get("analysed_rows"),
            "domain": analysis.get("domain", {}).get("label"),
        },
    }


def truncate_trend_points(trend: dict[str, Any]) -> dict[str, Any]:
    points = trend.get("points", [])
    if len(points) <= _MAX_TREND_POINTS:
        return trend
    step = len(points) // _MAX_TREND_POINTS + 1
    return {**trend, "points": points[::step] + [points[-1]]}
