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
# One pen for every single-series chart. Cycling a hue per widget made each
# card look like it belonged to a different chart library; in this system
# variety comes from the form a chart takes, never from tinting it differently.
_DEFAULT_ACCENT = "primary"


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

    # The page states one figure at full size above the grid. Leaving a second
    # copy of it in the grid says the same thing twice and — because the grid
    # packs by row — leaves the row it came from short once the page drops it.
    headline_kpi = _pick_headline_kpi(kpis)
    for index, kpi in enumerate(k for k in kpis if k is not headline_kpi):
        widgets.append(_kpi_widget(kpi, index, cursor))

    # The narrative and the ranked insights are promoted to the page's hero
    # band rather than repeated as widgets: stating the same finding twice on
    # one screen is what made the old dashboard read as a wall of cards. The
    # spec still carries the narrative payload, and the frontend still renders
    # both widget types for dashboards saved before this change.
    for index, rec in enumerate(recommendations):
        widgets.append(_chart_widget(rec, index, cursor))

    widgets.append(_table_widget(profile, cursor))
    _justify_layout(widgets)

    return {
        "version": SPEC_VERSION,
        "title": title or "Dashboard analítico",
        "subtitle": subtitle or "",
        "theme": theme,
        "grid": {"columns": GRID_COLUMNS, "rowHeight": 132, "gap": 16},
        "filters": _default_filters(profile, analysis),
        "widgets": widgets,
        "headline_kpi": headline_kpi,
        "narrative": narrative or {},
        "meta": {
            "generated": True,
            "domain": analysis["domain"]["key"],
            "quality_score": analysis["quality"]["score"],
            "chart_count": len(recommendations),
        },
    }


# How wide a form may grow when a row is stretched. A bar or a line gains from
# every extra column; a donut does not — past a point the circle stops growing
# and the card just gets emptier around it.
_MAX_JUSTIFIED_WIDTH: dict[str, int] = {
    "kpi": 6,
    "donut": 6,
    "pie": 6,
    "radar": 6,
    "funnel": 6,
    # Brazil is close to square, so a full-width map is mostly margin.
    "map": 8,
}


def _widget_width_cap(widget: dict[str, Any]) -> int:
    if widget["type"] == "kpi":
        return _MAX_JUSTIFIED_WIDTH["kpi"]
    chart_type = (widget.get("config") or {}).get("chart_type", "")
    return _MAX_JUSTIFIED_WIDTH.get(chart_type, GRID_COLUMNS)


def _pick_headline_kpi(kpis: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The figure the page leads with: the first that carries a comparison,
    because a number with a direction says more than a number alone."""
    if not kpis:
        return None
    return next((kpi for kpi in kpis if kpi.get("delta")), kpis[0])


def _justify_layout(widgets: list[dict[str, Any]]) -> None:
    """Re-pack the grid so no row ends ragged.

    Placing widgets left to right at their natural widths reliably ends a row
    short — a six-column map beside a four-column donut leaves two columns of
    dead space — and pairs a three-row chart with a two-row one, so the row
    bottoms out unevenly with a hole under the shorter card. Neither reads as a
    composition; they read as whatever fell out of the loop.

    Rows are rebuilt in order, then stretched to the full grid and levelled to
    their tallest member. Spare columns go to the narrowest cards first and
    never past the point where a form stops getting easier to read, so a donut
    is not inflated into a banner to close a gap.
    """
    if not widgets:
        return

    rows: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    used = 0

    for widget in widgets:
        width = max(1, min(int(widget["layout"]["w"]), GRID_COLUMNS))
        widget["layout"]["w"] = width
        if current and used + width > GRID_COLUMNS:
            rows.append(current)
            current, used = [], 0
        current.append(widget)
        used += width
    if current:
        rows.append(current)

    y = 0
    for row in rows:
        spare = GRID_COLUMNS - sum(w["layout"]["w"] for w in row)
        order = sorted(row, key=lambda w: w["layout"]["w"])
        index = 0
        while spare > 0 and any(w["layout"]["w"] < _widget_width_cap(w) for w in order):
            widget = order[index % len(order)]
            index += 1
            if widget["layout"]["w"] >= _widget_width_cap(widget):
                continue
            widget["layout"]["w"] += 1
            spare -= 1

        # A row that still cannot be filled — one capped card on its own — is
        # centred rather than left hanging against the left margin.
        offset = spare // 2 if spare > 0 else 0

        tallest = max(w["layout"]["h"] for w in row)
        cursor_x = offset
        for widget in row:
            widget["layout"]["h"] = tallest
            widget["layout"]["x"] = cursor_x
            widget["layout"]["y"] = y
            cursor_x += widget["layout"]["w"]
        y += tallest


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


def _style(**overrides: Any) -> dict[str, Any]:
    style = dict(_DEFAULT_STYLE)
    style["accent"] = _DEFAULT_ACCENT
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
            # The card renders entirely from this payload, so it carries the
            # label and provenance rather than relying on the widget title.
            "kpi": {
                "id": kpi.get("id", ""),
                "label": kpi["label"],
                "value": kpi["value"],
                "format": kpi["format"],
                "column": kpi.get("column"),
                "agg": kpi.get("agg", "count"),
                "delta": kpi.get("delta"),
                "rationale": kpi.get("rationale", ""),
                "icon": _kpi_icon(kpi),
            },
            "style": _style(shadow="none", showLegend=False, showGrid=False),
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
            "style": _style(),
        },
        "rationale": rec.get("rationale", ""),
        "principle": rec.get("principle", ""),
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
            "style": _style(showLegend=False, showGrid=True),
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


def default_widget_style() -> dict[str, Any]:
    return _style()
