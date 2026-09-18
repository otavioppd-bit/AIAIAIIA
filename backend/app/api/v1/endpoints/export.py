"""Export endpoints: filtered CSV and the insights report."""
from __future__ import annotations

import csv
import io
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, ReadyDataset, load_dataset_frame
from app.core.errors import NotFoundError
from app.models import Report
from app.services import semantics as sem

router = APIRouter(tags=["export"])

# Excel and Sheets execute a leading =, +, - or @ as a formula. Every exported
# cell that starts with one is prefixed so the file cannot run anything.
_FORMULA_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")


def _sanitise_cell(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    if text.startswith(_FORMULA_TRIGGERS):
        return "'" + text
    return text


@router.get("/datasets/{dataset_id}/export/csv")
def export_csv(
    dataset: ReadyDataset,
    limit: Annotated[int, Query(ge=1, le=1_000_000)] = 100_000,
) -> StreamingResponse:
    """Stream the typed dataset back as CSV, formula-injection safe."""
    frame = load_dataset_frame(dataset).head(limit)

    def generate():
        buffer = io.StringIO()
        writer = csv.writer(buffer, quoting=csv.QUOTE_MINIMAL)
        writer.writerow([_sanitise_cell(c) for c in frame.columns])
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)

        for start in range(0, len(frame), 5000):
            chunk = frame.iloc[start : start + 5000]
            for record in chunk.itertuples(index=False, name=None):
                writer.writerow([_sanitise_cell(v) for v in record])
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)

    safe_name = sem.slugify(dataset.name) or "dataset"
    return StreamingResponse(
        generate(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.csv"'},
    )


_AGG_LABELS: dict[str, str] = {
    "sum": "soma",
    "mean": "média",
    "median": "mediana",
    "count": "contagem",
    "min": "mínimo",
    "max": "máximo",
}

_DIRECTION_LABELS: dict[str, str] = {
    "up": "alta",
    "down": "queda",
    "flat": "estável",
}

_SEVERITY_LABELS: dict[str, str] = {
    "critical": "Crítico",
    "high": "Alto",
    "medium": "Médio",
    "low": "Baixo",
}


def build_report_markdown(dataset) -> str:
    """Compose the insights report from computed analysis only."""
    profile = dataset.profile
    analysis = dataset.analysis
    overview = profile["overview"]
    quality = analysis["quality"]
    generated_at = datetime.now(UTC).strftime("%d/%m/%Y %H:%M UTC")

    lines: list[str] = [
        f"# Relatório de insights — {dataset.name}",
        "",
        f"*Gerado em {generated_at}*",
        "",
        "## Visão geral",
        "",
        f"- **Registros:** {overview['row_count']:,}".replace(",", "."),
        f"- **Colunas:** {overview['column_count']}",
        f"- **Domínio identificado:** {analysis['domain']['label']}",
        f"- **Qualidade dos dados:** {quality['score']}/100 ({quality['label']})",
        f"- **Valores ausentes:** {overview['missing_ratio']:.2%}",
        f"- **Linhas duplicadas:** {overview['duplicate_rows']:,}".replace(",", "."),
        "",
    ]

    insights = analysis.get("insights", [])
    insight_titles = {str(item["title"]).strip() for item in insights}

    narrative = _primary_narrative(dataset)
    if narrative:
        lines += ["## Resumo executivo", "", narrative.get("summary", ""), ""]
        for section in narrative.get("sections", []):
            # The narrative is composed from the same findings listed below, so
            # printing both restated every anomaly twice, word for word.
            if str(section["heading"]).strip() in insight_titles:
                continue
            lines += [f"### {section['heading']}", "", section["body"], ""]

    if insights:
        lines += ["## Principais achados", ""]
        for item in insights:
            lines += [f"### {item['title']}", "", item["description"], ""]
            evidence = item.get("evidence") or {}
            if evidence.get("method"):
                lines += [f"> Método: {evidence['method']}", ""]

    trends = analysis.get("trends", [])
    if trends:
        lines += ["## Tendências", "", "| Métrica | Agregação | Período | Variação | Direção |",
                  "| --- | --- | --- | --- | --- |"]
        for trend in trends:
            change = (
                f"{trend['change_pct']:+.1f}%" if trend["change_pct"] is not None else "—"
            )
            lines.append(
                f"| {sem.humanize(trend['metric_column'])} | "
                f"{_AGG_LABELS.get(trend.get('agg', 'sum'), trend.get('agg', 'sum'))} | "
                f"{trend['points'][0]['label']} – {trend['points'][-1]['label']} | "
                f"{change} | {_DIRECTION_LABELS.get(trend['direction'], trend['direction'])} |"
            )
        lines.append("")

    correlations = analysis.get("correlations", {}).get("pairs", [])
    if correlations:
        lines += ["## Correlações", "", "| Variável A | Variável B | Coeficiente | Método | Força |",
                  "| --- | --- | --- | --- | --- |"]
        for pair in correlations[:10]:
            lines.append(
                f"| {sem.humanize(pair['x'])} | {sem.humanize(pair['y'])} | "
                f"{pair['coefficient']:+.2f} | {pair['method']} | {pair['strength']} |"
            )
        lines += ["", "> Correlação não implica causalidade.", ""]

    if quality["issues"]:
        lines += ["## Qualidade dos dados", ""]
        for issue in quality["issues"]:
            lines += [
                f"### {_SEVERITY_LABELS.get(issue['severity'], issue['severity'])} · {issue['title']}",
                "",
                issue["description"],
                "",
                f"**Recomendação:** {issue['recommendation']}",
                "",
            ]

    lines += [
        "---",
        "",
        "*Todos os números deste relatório foram calculados diretamente a partir do "
        "arquivo enviado. Nenhum valor foi estimado ou gerado por modelo de linguagem.*",
    ]
    return "\n".join(lines)


def _primary_narrative(dataset) -> dict | None:
    for dashboard in dataset.dashboards:
        narrative = (dashboard.spec or {}).get("narrative")
        if narrative:
            return narrative
    return None


@router.get("/datasets/{dataset_id}/export/report")
def export_report(
    dataset: ReadyDataset,
    user: CurrentUser,
    db: DbSession,
    persist: Annotated[bool, Query()] = False,
) -> StreamingResponse:
    content = build_report_markdown(dataset)
    if persist:
        db.add(
            Report(
                user_id=user.id,
                dataset_id=dataset.id,
                title=f"Relatório — {dataset.name}",
                format="markdown",
                content=content,
            )
        )
        db.commit()

    safe_name = sem.slugify(dataset.name) or "relatorio"
    return StreamingResponse(
        iter([content.encode("utf-8")]),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}-insights.md"'},
    )


@router.get("/datasets/{dataset_id}/report")
def report_json(dataset: ReadyDataset) -> dict:
    """The same report as structured data, for in-app rendering."""
    return {
        "title": f"Relatório de insights — {dataset.name}",
        "markdown": build_report_markdown(dataset),
        "generated_at": datetime.now(UTC).isoformat(),
        "insights": dataset.analysis.get("insights", []),
        "quality": dataset.analysis.get("quality", {}),
    }


@router.get("/reports")
def list_reports(user: CurrentUser, db: DbSession) -> list[dict]:
    rows = db.scalars(
        select(Report).where(Report.user_id == user.id).order_by(Report.created_at.desc()).limit(50)
    ).all()
    return [
        {
            "id": r.id,
            "dataset_id": r.dataset_id,
            "title": r.title,
            "format": r.format,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/reports/{report_id}")
def get_report(report_id: str, user: CurrentUser, db: DbSession) -> dict:
    report = db.get(Report, report_id)
    if report is None or report.user_id != user.id:
        raise NotFoundError("Relatório não encontrado.")
    return {
        "id": report.id,
        "dataset_id": report.dataset_id,
        "title": report.title,
        "format": report.format,
        "content": report.content,
        "created_at": report.created_at.isoformat(),
    }
