"""Explore: build visualisations from an explicit X / Y / series selection."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import ReadyDataset, load_dataset_frame
from app.schemas.explore import ExploreRequest, ExploreResponse
from app.services import widget_data

router = APIRouter(prefix="/datasets/{dataset_id}/explore", tags=["explore"])


@router.get("/fields")
def list_fields(dataset: ReadyDataset) -> dict:
    """Field catalogue the Explore UI binds its selectors to."""
    columns = []
    for col in dataset.profile["columns"]:
        columns.append(
            {
                "name": col["name"],
                "label": col["name"],
                "semantic_type": col["semantic_type"],
                "role": col["role"],
                "unique_count": col["unique_count"],
                "missing_ratio": col["missing_ratio"],
                "is_aggregatable": col["is_aggregatable"],
                "default_agg": (col.get("detail") or {}).get("default_agg"),
                "additive": (col.get("detail") or {}).get("additive"),
                "options": [
                    v["value"] for v in (col.get("stats") or {}).get("top_values", [])
                ][:50],
            }
        )
    analysis = dataset.analysis
    return {
        "columns": columns,
        "metrics": analysis["columns"]["metrics"],
        "dimensions": analysis["columns"]["dimensions"],
        "temporal": analysis["columns"]["temporal"],
        "chart_types": [
            "line", "area", "bar", "bar_horizontal", "stacked_bar", "scatter",
            "donut", "pie", "histogram", "box_plot", "heatmap", "treemap",
            "radar", "funnel", "table",
        ],
        "aggregations": ["sum", "mean", "median", "count", "min", "max", "nunique", "std"],
    }


@router.post("", response_model=ExploreResponse)
def run_explore(payload: ExploreRequest, dataset: ReadyDataset) -> ExploreResponse:
    frame = load_dataset_frame(dataset)
    suggested, rationale = widget_data.suggest_chart(
        dataset.profile, payload.x, payload.y, payload.series
    )
    encoding = {
        "x": payload.x,
        "y": payload.y,
        "series": payload.series,
        "agg": payload.agg,
        "time_grain": payload.time_grain,
        "limit": payload.limit,
        "sort": "desc" if payload.sort_desc else "asc",
    }
    result = widget_data.resolve(
        frame,
        dataset.profile,
        dataset.analysis,
        chart_type=payload.chart_type,
        encoding=encoding,
        filters=[f.model_dump() for f in payload.filters],
        limit=payload.limit,
    )
    return ExploreResponse(
        columns=result["columns"],
        rows=result["rows"],
        row_count=result["row_count"],
        truncated=result["truncated"],
        notes=result["notes"],
        suggested_chart=suggested,
        rationale=rationale,
    )
