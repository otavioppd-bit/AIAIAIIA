"""Dashboard assembly.

Turns curated recommendations into a concrete, editable widget layout. The spec
this produces is the single source of truth the frontend renders and the user
customises — every visual property is a value here, not a hard-coded style.
"""
from __future__ import annotations

import uuid
from typing import Any

from app.services import semantics as sem

SPEC_VERSION = 2
GRID_COLUMNS = 12

_DEFAULT_STYLE: dict[str, Any] = {
    "accent": "primary",
    "background": "surface",
    "border": True,
    "shadow": "sm",
    "radius": "lg",
    "padding": "md",
    "showLegend": True,
    "showGrid": True,
    "showDataLabels": False,
    "titleSize": "md",
    "fontFamily": "sans",
    "colorScheme": "default",
}

# Accent rotation keeps a generated dashboard from looking monochrome without
# assigning colour randomly.
_ACCENT_CYCLE = ["primary", "violet", "teal", "amber", "rose", "sky"]


def _widget_id() -> str:
    return f"w_{uuid.uuid4().hex[:10]}"


def build_dashboard_spec(
    *,
    profile: dict[str, Any],
    analysis: dict[str, Any],
    recommendations: list[dict[str, Any]],
    kpis: list[dict[str, Any]],
    narrative: dict[str, Any] | None = None,
    title: str | None = None,
    subtitle: str | None = None,
    theme: str = "dark",
) -> dict[str, Any]:
    """Compose the full dashboard specification."""
    widgets: list[dict[str, Any]] = []
    cursor = _LayoutCursor()

    for index, kpi in enumerate(kpis):
        widgets.append(_kpi_widget(kpi, index, cursor))

    if narrative and narrative.get("summary"):
        widgets.append(_narrative_widget(narrative, cursor))

    for index, rec in enumerate(recommendations):
        widgets.append(_chart_widget(rec, index, cursor))

    insights = analysis.get("insights", [])
    if insights:
        widgets.append(_insights_widget(insights, cursor))

    widgets.append(_table_widget(profile, cursor))

    return {
        "version": SPEC_VERSION,
        "title": title or "Dashboard analítico",
        "subtitle": subtitle or "",
        "theme": theme,
        "grid": {"columns": GRID_COLUMNS, "rowHeight": 132, "gap": 16},
        "filters": _default_filters(profile, analysis),
        "widgets": widgets,
        "narrative": narrative or {},
        "meta": {
            "generated": True,
            "domain": analysis["domain"]["key"],
            "quality_score": analysis["quality"]["score"],
            "chart_count": len(recommendations),
        },
    }


class _LayoutCursor:
    """Packs widgets left-to-right across a 12-column grid."""

    def __init__(self) -> None:
        self.x = 0
        self.y = 0
        self._row_height = 0

    def place(self, width: int, height: int) -> dict[str, int]:
        width = max(1, min(int(width), GRID_COLUMNS))
        height = max(1, int(height))
        if self.x + width > GRID_COLUMNS:
            self.y += self._row_height or height
            self.x = 0
            self._row_height = 0
        position = {"x": self.x, "y": self.y, "w": width, "h": height}
        self.x += width
        self._row_height = max(self._row_height, height)
        if self.x >= GRID_COLUMNS:
            self.y += self._row_height
            self.x = 0
            self._row_height = 0
        return position

    def newline(self) -> None:
        if self.x != 0:
            self.y += self._row_height
            self.x = 0
            self._row_height = 0


def _style(index: int, **overrides: Any) -> dict[str, Any]:
    style = dict(_DEFAULT_STYLE)
    style["accent"] = _ACCENT_CYCLE[index % len(_ACCENT_CYCLE)]
    style.update(overrides)
    return style


def _kpi_widget(kpi: dict[str, Any], index: int, cursor: _LayoutCursor) -> dict[str, Any]:
    return {
        "id": _widget_id(),
        "type": "kpi",
        "title": kpi["label"],
        "subtitle": "",
        "layout": cursor.place(3, 1),
        "config": {
            "chart_type": "kpi",
            "encoding": {"y": kpi.get("column"), "agg": kpi.get("agg", "count")},
            "kpi": {
                "value": kpi["value"],
                "format": kpi["format"],
                "delta": kpi.get("delta"),
                "icon": _kpi_icon(kpi),
            },
            "style": _style(index, shadow="sm", showLegend=False, showGrid=False),
        },
        "rationale": kpi.get("rationale", ""),
        "principle": "Indicador único → cartão de KPI",
        "locked": False,
    }


def _kpi_icon(kpi: dict[str, Any]) -> str:
    fmt = kpi.get("format")
    if fmt == "currency":
        return "currency"
    if fmt == "percent":
        return "percent"
    if kpi.get("agg") == "count":
        return "database"
    return "trending-up"


def _narrative_widget(narrative: dict[str, Any], cursor: _LayoutCursor) -> dict[str, Any]:
    cursor.newline()
    return {
        "id": _widget_id(),
        "type": "narrative",
        "title": narrative.get("headline", "Resumo executivo"),
        "subtitle": "",
        "layout": cursor.place(12, 1),
        "config": {
            "chart_type": "narrative",
            "encoding": {},
            "narrative": {
                "summary": narrative.get("summary", ""),
                "sections": narrative.get("sections", []),
                "watch_items": narrative.get("watch_items", []),
                "source": narrative.get("source", "deterministic"),
            },
            "style": _style(0, shadow="none", border=True, showLegend=False, showGrid=False),
        },
        "rationale": "Síntese textual dos achados calculados sobre o conjunto de dados.",
        "principle": "Narrativa → contexto antes dos números",
        "locked": False,
    }


def _chart_widget(rec: dict[str, Any], index: int, cursor: _LayoutCursor) -> dict[str, Any]:
    size = rec.get("size") or {"w": 6, "h": 2}
    return {
        "id": _widget_id(),
        "type": "chart",
        "title": rec["title"],
        "subtitle": rec.get("subtitle", ""),
        "layout": cursor.place(size.get("w", 6), size.get("h", 2)),
        "config": {
            "chart_type": rec["chart_type"],
            "encoding": rec["encoding"],
            "options": rec.get("options", {}),
            "style": _style(index + 1),
        },
        "rationale": rec.get("rationale", ""),
        "principle": rec.get("principle", ""),
        "locked": False,
    }


def _insights_widget(insights: list[dict[str, Any]], cursor: _LayoutCursor) -> dict[str, Any]:
    cursor.newline()
    return {
        "id": _widget_id(),
        "type": "insights",
        "title": "Insights automáticos",
        "subtitle": "Calculados a partir dos dados do arquivo",
        "layout": cursor.place(12, 2),
        "config": {
            "chart_type": "insights",
            "encoding": {},
            "insights": insights[:8],
            "style": _style(2, showLegend=False, showGrid=False),
        },
        "rationale": "Achados derivados de estatísticas descritivas, tendências, "
        "correlações e verificações de qualidade.",
        "principle": "Descobertas → lista priorizada",
        "locked": False,
    }


def _table_widget(profile: dict[str, Any], cursor: _LayoutCursor) -> dict[str, Any]:
    cursor.newline()
    columns = [c["name"] for c in profile["columns"]][:12]
    return {
        "id": _widget_id(),
        "type": "table",
        "title": "Dados detalhados",
        "subtitle": f"{profile['overview']['row_count']:,} registros".replace(",", "."),
        "layout": cursor.place(12, 3),
        "config": {
            "chart_type": "table",
            "encoding": {"columns": columns},
            "style": _style(3, showLegend=False, showGrid=True),
            "table": {"pageSize": 25, "virtualized": True},
        },
        "rationale": "Acesso aos registros individuais para verificar qualquer número "
        "exibido nos gráficos.",
        "principle": "Verificabilidade → tabela detalhada",
        "locked": False,
    }


def _default_filters(profile: dict[str, Any], analysis: dict[str, Any]) -> list[dict[str, Any]]:
    """Expose the most useful slicers as dashboard-level filters."""
    filters: list[dict[str, Any]] = []
    by_name = {c["name"]: c for c in profile["columns"]}

    for column in analysis["columns"]["temporal"][:1]:
        col_stats = by_name[column].get("stats") or {}
        filters.append(
            {
                "id": f"f_{sem.slugify(column)}",
                "column": column,
                "label": sem.humanize(column),
                "kind": "date_range",
                "value": None,
                "min": col_stats.get("min"),
                "max": col_stats.get("max"),
            }
        )

    candidates = [
        by_name[c] for c in analysis["columns"]["dimensions"]
        if 1 < by_name[c]["unique_count"] <= 40
    ]
    candidates.sort(key=lambda c: abs(c["unique_count"] - 6))
    for column in candidates[:3]:
        options = [v["value"] for v in (column.get("stats") or {}).get("top_values", [])][:40]
        filters.append(
            {
                "id": f"f_{sem.slugify(column['name'])}",
                "column": column["name"],
                "label": sem.humanize(column["name"]),
                "kind": "multi_select",
                "value": [],
                "options": options,
            }
        )
    return filters


def next_widget_id() -> str:
    return _widget_id()


def default_widget_style(index: int = 0) -> dict[str, Any]:
    return _style(index)
