"""Insight generation.

Insights are derived exclusively from computed statistics. Each one carries the
evidence (numbers, columns, method) that produced it, so the UI — and the LLM
narrator — can only restate facts that already exist.
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from app.services import domain as domain_mod
from app.services import semantics as sem
from app.services import statistics as stats

# Insight kinds drive the icon and accent colour in the UI.
TREND = "trend"
ANOMALY = "anomaly"
CONCENTRATION = "concentration"
CORRELATION = "correlation"
QUALITY = "quality"
DISTRIBUTION = "distribution"
COMPOSITION = "composition"
RANKING = "ranking"

_SENTIMENT_POSITIVE = "positive"
_SENTIMENT_NEGATIVE = "negative"
_SENTIMENT_NEUTRAL = "neutral"


def _fmt(value: float | None, semantic_type: str = sem.FLOAT) -> str:
    """Format a number the way a Brazilian analyst would write it."""
    if value is None:
        return "—"
    if semantic_type == sem.PERCENTAGE:
        return f"{value:,.1f}%".replace(",", "X").replace(".", ",").replace("X", ".")
    prefix = "R$ " if semantic_type == sem.CURRENCY else ""
    abs_v = abs(value)
    if abs_v >= 1_000_000_000:
        body = f"{value / 1_000_000_000:,.2f} bi"
    elif abs_v >= 1_000_000:
        body = f"{value / 1_000_000:,.2f} mi"
    elif abs_v >= 1000:
        body = f"{value:,.0f}"
    elif semantic_type == sem.INTEGER:
        body = f"{value:,.0f}"
    else:
        body = f"{value:,.2f}"
    body = body.replace(",", "X").replace(".", ",").replace("X", ".")
    return prefix + body


def _pct(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value:,.1f}%".replace(",", "X").replace(".", ",").replace("X", ".")


def build_insight(
    *,
    kind: str,
    title: str,
    description: str,
    sentiment: str = _SENTIMENT_NEUTRAL,
    importance: float = 0.5,
    evidence: dict[str, Any] | None = None,
    columns: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "kind": kind,
        "title": title,
        "description": description,
        "sentiment": sentiment,
        "importance": round(float(max(0.0, min(1.0, importance))), 4),
        "evidence": evidence or {},
        "columns": columns or [],
    }


def generate_insights(
    frame: pd.DataFrame,
    profile: dict[str, Any],
    analysis: dict[str, Any],
    quality: dict[str, Any],
    domain_info: dict[str, Any],
    limit: int = 14,
) -> list[dict[str, Any]]:
    """Produce the ranked insight feed shown on the dashboard."""
    insights: list[dict[str, Any]] = []
    types = {c["name"]: c["semantic_type"] for c in profile["columns"]}

    insights += _trend_insights(analysis, types)
    insights += _anomaly_insights(analysis, types)
    insights += _concentration_insights(analysis, types)
    insights += _correlation_insights(analysis)
    insights += _distribution_insights(profile, types)
    insights += _quality_insights(profile, quality)
    insights += _volume_insight(profile, domain_info)

    insights.sort(key=lambda i: i["importance"], reverse=True)

    # Keep the feed varied: cap how many insights of one kind can dominate.
    selected: list[dict[str, Any]] = []
    per_kind: dict[str, int] = {}
    for insight in insights:
        cap = 4 if insight["kind"] in {TREND, CONCENTRATION} else 3
        count = per_kind.get(insight["kind"], 0)
        if count >= cap:
            continue
        per_kind[insight["kind"]] = count + 1
        selected.append(insight)
        if len(selected) >= limit:
            break
    return selected


def _trend_insights(analysis: dict[str, Any], types: dict[str, str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for trend in analysis.get("trends", []):
        change = trend.get("change_pct")
        if change is None or trend["periods"] < 3:
            continue
        metric = trend["metric_column"]
        stype = types.get(metric, sem.FLOAT)
        grain_label = _GRAIN_LABELS.get(trend["grain"], "períodos")
        magnitude = min(1.0, abs(change) / 60.0)
        consistent = (trend.get("r_squared") or 0) > 0.5

        if trend["direction"] == "up":
            icon, sentiment = "📈", _SENTIMENT_POSITIVE
            verb = "cresceu"
        elif trend["direction"] == "down":
            icon, sentiment = "📉", _SENTIMENT_NEGATIVE
            verb = "caiu"
        else:
            icon, sentiment = "➖", _SENTIMENT_NEUTRAL
            verb = "permaneceu estável"

        if trend["direction"] == "flat":
            description = (
                f"{metric} variou apenas {_pct(abs(change))} entre "
                f"{trend['points'][0]['label']} e {trend['points'][-1]['label']}, "
                f"mantendo-se em torno de {_fmt(trend['last_value'], stype)}."
            )
        else:
            description = (
                f"{metric} {verb} {_pct(abs(change))} ao longo de "
                f"{trend['periods']} {grain_label}, saindo de "
                f"{_fmt(trend['first_value'], stype)} em {trend['points'][0]['label']} "
                f"para {_fmt(trend['last_value'], stype)} em {trend['points'][-1]['label']}."
            )
            if consistent:
                description += " A tendência é consistente ao longo de todo o período."

        out.append(
            build_insight(
                kind=TREND,
                title=f"{icon} {metric} {verb} {_pct(abs(change))}" if trend["direction"] != "flat"
                else f"{icon} {metric} estável no período",
                description=description,
                sentiment=sentiment,
                importance=0.55 + 0.35 * magnitude + (0.1 if consistent else 0.0),
                evidence={
                    "metric": metric,
                    "date_column": trend["date_column"],
                    "grain": trend["grain"],
                    "change_pct": change,
                    "first_value": trend["first_value"],
                    "last_value": trend["last_value"],
                    "r_squared": trend.get("r_squared"),
                    "method": "regressão linear sobre a série agregada",
                },
                columns=[trend["date_column"], metric],
            )
        )

        best, worst = trend.get("best_period"), trend.get("worst_period")
        if best and worst and best["label"] != worst["label"] and trend["periods"] >= 4:
            spread = (
                (best["value"] - worst["value"]) / abs(worst["value"]) * 100
                if worst["value"]
                else None
            )
            if spread is not None and spread > 40:
                out.append(
                    build_insight(
                        kind=DISTRIBUTION,
                        title=f"🔺 Pico de {metric} em {best['label']}",
                        description=(
                            f"O melhor período ({best['label']}, "
                            f"{_fmt(best['value'], stype)}) foi {_pct(spread)} superior ao "
                            f"pior período ({worst['label']}, {_fmt(worst['value'], stype)}), "
                            "indicando forte sazonalidade ou eventos pontuais."
                        ),
                        sentiment=_SENTIMENT_NEUTRAL,
                        importance=0.45 + min(0.3, spread / 400),
                        evidence={"best": best, "worst": worst, "metric": metric},
                        columns=[trend["date_column"], metric],
                    )
                )
    return out


_GRAIN_LABELS = {
    "hour": "horas",
    "day": "dias",
    "week": "semanas",
    "month": "meses",
    "quarter": "trimestres",
    "year": "anos",
}


def _anomaly_insights(analysis: dict[str, Any], types: dict[str, str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for anomaly in analysis.get("anomalies", []):
        metric = anomaly["metric_column"]
        stype = types.get(metric, sem.FLOAT)
        change = anomaly["change_pct"]
        out.append(
            build_insight(
                kind=ANOMALY,
                title=f"⚠️ {anomaly['direction'].capitalize()} atípica de "
                f"{_pct(abs(change))} em {anomaly['period']}",
                description=(
                    f"{metric} passou de {_fmt(anomaly['previous_value'], stype)} em "
                    f"{anomaly['previous_period']} para {_fmt(anomaly['value'], stype)} em "
                    f"{anomaly['period']}. A variação está a "
                    f"{abs(anomaly['z_score']):.1f} desvios-padrão da variação típica "
                    "do período."
                ),
                sentiment=_SENTIMENT_NEGATIVE if change < 0 else _SENTIMENT_POSITIVE,
                importance=0.6 + min(0.35, abs(anomaly["z_score"]) / 12),
                evidence={**anomaly, "method": "z-score sobre variações período a período"},
                columns=[metric],
            )
        )
    return out


def _concentration_insights(analysis: dict[str, Any], types: dict[str, str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for breakdown in analysis.get("breakdowns", []):
        leader = breakdown.get("leader")
        if not leader or breakdown["distinct"] < 2:
            continue
        metric = breakdown.get("metric")
        stype = types.get(metric, sem.INTEGER if metric is None else sem.FLOAT)
        dimension = breakdown["dimension"]
        metric_label = metric or "registros"
        ratio = leader.get("ratio") or 0

        if ratio >= 0.35 and breakdown["distinct"] >= 3:
            out.append(
                build_insight(
                    kind=CONCENTRATION,
                    title=f"💡 {leader['label']} concentra {_pct(ratio * 100)} de {metric_label}",
                    description=(
                        f"Entre {breakdown['distinct']} valores de {dimension}, "
                        f"“{leader['label']}” responde por {_fmt(leader['value'], stype)} "
                        f"({_pct(ratio * 100)} do total de {_fmt(breakdown['total'], stype)}). "
                        "Alta dependência de um único segmento representa risco."
                    ),
                    sentiment=_SENTIMENT_NEUTRAL if ratio < 0.6 else _SENTIMENT_NEGATIVE,
                    importance=0.5 + min(0.35, ratio / 2),
                    evidence={
                        "dimension": dimension,
                        "metric": metric,
                        "leader": leader,
                        "total": breakdown["total"],
                        "distinct": breakdown["distinct"],
                        "method": "agregação por dimensão",
                    },
                    columns=[dimension] + ([metric] if metric else []),
                )
            )
        elif breakdown["distinct"] >= 5:
            out.append(
                build_insight(
                    kind=RANKING,
                    title=f"🏆 {leader['label']} lidera em {metric_label}",
                    description=(
                        f"“{leader['label']}” é o maior valor de {dimension} com "
                        f"{_fmt(leader['value'], stype)}. Os três primeiros somam "
                        f"{_pct(breakdown['top3_share'] * 100)} do total."
                    ),
                    sentiment=_SENTIMENT_NEUTRAL,
                    importance=0.42 + min(0.2, breakdown["top3_share"] / 3),
                    evidence={
                        "dimension": dimension,
                        "metric": metric,
                        "leader": leader,
                        "top3_share": breakdown["top3_share"],
                    },
                    columns=[dimension] + ([metric] if metric else []),
                )
            )

        # Pareto: a small share of categories driving most of the total.
        if breakdown["distinct"] >= 8 and breakdown["pareto_share"] >= 0.7:
            out.append(
                build_insight(
                    kind=COMPOSITION,
                    title=f"📊 Efeito Pareto em {dimension}",
                    description=(
                        f"20% dos valores de {dimension} concentram "
                        f"{_pct(breakdown['pareto_share'] * 100)} de {metric_label}. "
                        "Priorizar esse grupo tende a gerar o maior retorno."
                    ),
                    sentiment=_SENTIMENT_NEUTRAL,
                    importance=0.5 + min(0.25, breakdown["pareto_share"] / 4),
                    evidence={
                        "dimension": dimension,
                        "pareto_share": breakdown["pareto_share"],
                        "distinct": breakdown["distinct"],
                        "method": "participação acumulada dos 20% maiores",
                    },
                    columns=[dimension],
                )
            )
    return out


def _correlation_insights(analysis: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for pair in analysis.get("correlations", {}).get("pairs", [])[:4]:
        if pair["abs"] < 0.45:
            continue
        direction = "positiva" if pair["direction"] == "positive" else "negativa"
        relation = (
            "tendem a crescer juntos" if pair["direction"] == "positive"
            else "movem-se em direções opostas"
        )
        note = ""
        if pair.get("outlier_sensitive"):
            note = (
                f" Pearson cai para {pair['pearson']:.2f} por efeito de valores extremos, "
                "por isso a leitura usa Spearman, que é baseado em postos e resistente "
                "a outliers."
            )
        elif pair.get("non_linear"):
            note = (
                " A relação parece monotônica porém não linear "
                f"(Spearman {pair['spearman']:.2f} > Pearson {pair['pearson']:.2f})."
            )
        method_label = "de Spearman" if pair.get("method") == "spearman" else "de Pearson"
        out.append(
            build_insight(
                kind=CORRELATION,
                title=f"🔗 Correlação {direction} {pair['strength']} entre "
                f"{pair['x']} e {pair['y']}",
                description=(
                    f"O coeficiente {method_label} é {pair['coefficient']:.2f} "
                    f"({pair['sample_size']:,} registros comparáveis). "
                    f"Os valores {relation}.{note} "
                    "Correlação não implica causalidade."
                ).replace(",", "."),
                sentiment=_SENTIMENT_NEUTRAL,
                importance=0.45 + min(0.4, pair["abs"] / 2),
                evidence={**pair, "method": "correlação de Pearson e Spearman"},
                columns=[pair["x"], pair["y"]],
            )
        )
    return out


def _distribution_insights(profile: dict[str, Any], types: dict[str, str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for col in profile["columns"]:
        if col["semantic_type"] not in sem.NUMERIC_TYPES or col["role"] != sem.METRIC:
            continue
        col_stats = col.get("stats") or {}
        mean, median = col_stats.get("mean"), col_stats.get("median")
        skew = col_stats.get("skewness")
        if mean is None or median is None or not median:
            continue
        stype = col["semantic_type"]

        if skew is not None and abs(skew) > 1.5 and col_stats.get("count", 0) > 30:
            side = "à direita" if skew > 0 else "à esquerda"
            out.append(
                build_insight(
                    kind=DISTRIBUTION,
                    title=f"📐 {col['name']} tem distribuição assimétrica",
                    description=(
                        f"A média ({_fmt(mean, stype)}) difere bastante da mediana "
                        f"({_fmt(median, stype)}), com assimetria {side} "
                        f"(coeficiente {skew:.2f}). Use a mediana como referência "
                        "de valor típico."
                    ),
                    sentiment=_SENTIMENT_NEUTRAL,
                    importance=0.38 + min(0.2, abs(skew) / 15),
                    evidence={
                        "column": col["name"],
                        "mean": mean,
                        "median": median,
                        "skewness": skew,
                        "method": "coeficiente de assimetria de Fisher-Pearson",
                    },
                    columns=[col["name"]],
                )
            )

        outliers = col_stats.get("outliers") or {}
        if outliers.get("count", 0) > 0 and outliers.get("ratio", 0) > 0.02:
            out.append(
                build_insight(
                    kind=ANOMALY,
                    title=f"⚠️ {outliers['count']} valor(es) fora do padrão em {col['name']}",
                    description=(
                        f"{_pct(outliers['ratio'] * 100)} dos registros estão fora do "
                        f"intervalo esperado de {_fmt(outliers['lower_bound'], stype)} a "
                        f"{_fmt(outliers['upper_bound'], stype)} (método de Tukey). "
                        f"Exemplos: {', '.join(_fmt(v, stype) for v in outliers['examples'][:3])}."
                    ),
                    sentiment=_SENTIMENT_NEGATIVE if outliers["ratio"] > 0.08 else _SENTIMENT_NEUTRAL,
                    importance=0.4 + min(0.3, outliers["ratio"] * 3),
                    evidence={
                        "column": col["name"],
                        **{k: v for k, v in outliers.items() if k != "examples"},
                        "examples": outliers["examples"][:5],
                        "method": "cercas de Tukey (1,5 × IQR)",
                    },
                    columns=[col["name"]],
                )
            )
    return out


def _quality_insights(profile: dict[str, Any], quality: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    overview = profile["overview"]
    score = quality["score"]

    if score < 70:
        critical = quality["issue_counts"].get("critical", 0) + quality["issue_counts"].get("high", 0)
        out.append(
            build_insight(
                kind=QUALITY,
                title=f"🧹 Qualidade dos dados em {score}/100 ({quality['label']})",
                description=(
                    f"Foram identificados {critical} problema(s) de alta severidade. "
                    "Os números do dashboard podem estar distorcidos até que sejam "
                    "tratados. Veja a aba Data Quality para o detalhamento."
                ),
                sentiment=_SENTIMENT_NEGATIVE,
                importance=0.75 if score < 55 else 0.6,
                evidence={"score": score, "dimensions": quality["dimensions"]},
            )
        )

    if overview["duplicate_rows"] > 0 and overview["duplicate_ratio"] > 0.01:
        out.append(
            build_insight(
                kind=QUALITY,
                title=f"🧹 {overview['duplicate_rows']:,} linhas duplicadas".replace(",", "."),
                description=(
                    f"{_pct(overview['duplicate_ratio'] * 100)} das linhas são cópias exatas. "
                    "Somas e contagens estão infladas nesse percentual."
                ),
                sentiment=_SENTIMENT_NEGATIVE,
                importance=0.5 + min(0.3, overview["duplicate_ratio"] * 3),
                evidence={
                    "duplicate_rows": overview["duplicate_rows"],
                    "duplicate_ratio": overview["duplicate_ratio"],
                },
            )
        )
    return out


def _volume_insight(profile: dict[str, Any], domain_info: dict[str, Any]) -> list[dict[str, Any]]:
    overview = profile["overview"]
    metrics = [c for c in profile["columns"] if c["role"] == sem.METRIC]
    dimensions = [c for c in profile["columns"] if c["role"] == sem.DIMENSION]
    temporal = [c for c in profile["columns"] if c["role"] == sem.TEMPORAL]

    parts = [f"{overview['row_count']:,} registros".replace(",", ".")]
    parts.append(f"{len(metrics)} métrica(s)")
    parts.append(f"{len(dimensions)} dimensão(ões)")
    if temporal:
        parts.append(f"{len(temporal)} coluna(s) de data")

    domain_note = ""
    if domain_info["key"] != domain_mod.GENERIC and domain_info["confidence"] >= 0.4:
        domain_note = (
            f" O vocabulário das colunas indica um conjunto de dados de "
            f"{domain_info['label'].lower()}."
        )

    return [
        build_insight(
            kind=COMPOSITION,
            title="🗂️ Estrutura do conjunto de dados",
            description="Identificamos " + ", ".join(parts) + "." + domain_note,
            sentiment=_SENTIMENT_NEUTRAL,
            importance=0.3,
            evidence={
                "row_count": overview["row_count"],
                "metrics": [c["name"] for c in metrics],
                "dimensions": [c["name"] for c in dimensions],
                "temporal": [c["name"] for c in temporal],
                "domain": domain_info,
            },
        )
    ]
