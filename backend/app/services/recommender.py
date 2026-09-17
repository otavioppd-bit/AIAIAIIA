"""Chart recommendation engine.

Each candidate visualisation is produced by a rule grounded in a data-viz
principle, then scored. Only high-scoring, non-redundant charts survive, so a
dataset never receives a fixed template — the layout follows the data.

Encoding vocabulary used throughout:
    x       - the categorical/temporal axis column
    y       - the measured column
    series  - optional second dimension (colour / split)
    agg     - sum | mean | median | count | min | max | nunique
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from app.services import domain as domain_mod
from app.services import semantics as sem
from app.services import statistics as stats

# --- Chart types ----------------------------------------------------------
LINE = "line"
AREA = "area"
BAR = "bar"
BAR_HORIZONTAL = "bar_horizontal"
STACKED_BAR = "stacked_bar"
SCATTER = "scatter"
DONUT = "donut"
PIE = "pie"
HISTOGRAM = "histogram"
BOX_PLOT = "box_plot"
HEATMAP = "heatmap"
TREEMAP = "treemap"
RADAR = "radar"
FUNNEL = "funnel"
KPI = "kpi"
TABLE = "table"
MAP = "map"

# Default grid footprint (12-column grid) per chart type.
_DEFAULT_SIZE: dict[str, dict[str, int]] = {
    KPI: {"w": 3, "h": 1},
    LINE: {"w": 8, "h": 2},
    AREA: {"w": 8, "h": 2},
    BAR: {"w": 6, "h": 2},
    BAR_HORIZONTAL: {"w": 6, "h": 2},
    STACKED_BAR: {"w": 8, "h": 2},
    SCATTER: {"w": 6, "h": 2},
    DONUT: {"w": 4, "h": 2},
    PIE: {"w": 4, "h": 2},
    HISTOGRAM: {"w": 6, "h": 2},
    BOX_PLOT: {"w": 6, "h": 2},
    HEATMAP: {"w": 8, "h": 2},
    TREEMAP: {"w": 6, "h": 2},
    RADAR: {"w": 4, "h": 2},
    FUNNEL: {"w": 4, "h": 2},
    MAP: {"w": 6, "h": 2},
    TABLE: {"w": 12, "h": 2},
}


@dataclass
class Recommendation:
    """A proposed widget, with the reasoning that justifies it."""

    chart_type: str
    title: str
    subtitle: str
    encoding: dict[str, Any]
    rationale: str
    principle: str
    score: float
    columns: list[str] = field(default_factory=list)
    options: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "chart_type": self.chart_type,
            "title": self.title,
            "subtitle": self.subtitle,
            "encoding": self.encoding,
            "rationale": self.rationale,
            "principle": self.principle,
            "score": round(self.score, 4),
            "columns": self.columns,
            "options": self.options,
            "size": dict(_DEFAULT_SIZE.get(self.chart_type, {"w": 6, "h": 2})),
        }


def _columns_by_role(profile: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    buckets: dict[str, list[dict[str, Any]]] = {
        sem.METRIC: [], sem.DIMENSION: [], sem.TEMPORAL: [],
        sem.IDENTITY: [], sem.FREE_TEXT: [],
    }
    for col in profile["columns"]:
        buckets.setdefault(col["role"], []).append(col)
    return buckets


def recommend(
    frame: pd.DataFrame,
    profile: dict[str, Any],
    analysis: dict[str, Any],
    domain_info: dict[str, Any],
    max_charts: int = 14,
) -> list[dict[str, Any]]:
    """Return the ranked, de-duplicated set of recommended visualisations."""
    buckets = _columns_by_role(profile)
    metrics = [c for c in buckets[sem.METRIC] if c["missing_ratio"] < 0.6]
    dimensions = [
        c for c in buckets[sem.DIMENSION]
        if 1 < c["unique_count"] <= 5000 and c["missing_ratio"] < 0.6
    ]
    temporal = [c for c in buckets[sem.TEMPORAL] if c["missing_ratio"] < 0.6]

    # Order metrics so the domain's headline metric leads the dashboard.
    ranked_names = domain_mod.rank_metric_columns(
        domain_info["key"], [m["name"] for m in metrics]
    )
    metrics.sort(key=lambda m: ranked_names.index(m["name"]))

    candidates: list[Recommendation] = []
    candidates += _temporal_rules(analysis, metrics, temporal)
    candidates += _comparison_rules(analysis, metrics, dimensions)
    candidates += _composition_rules(analysis, metrics, dimensions)
    candidates += _correlation_rules(analysis, metrics)
    candidates += _distribution_rules(metrics)
    candidates += _geo_rules(analysis, metrics, dimensions, profile)
    candidates += _cross_dimension_rules(frame, metrics, dimensions)
    candidates += _funnel_rules(profile, metrics)
    candidates += _radar_rules(metrics, dimensions)

    candidates.sort(key=lambda c: c.score, reverse=True)
    selected = _deduplicate(candidates, max_charts)
    return [c.to_dict() for c in selected]


def _deduplicate(candidates: list[Recommendation], max_charts: int) -> list[Recommendation]:
    """Drop charts that would tell the same story twice."""
    selected: list[Recommendation] = []
    seen_signatures: set[tuple] = set()
    type_counts: dict[str, int] = {}

    for cand in candidates:
        enc = cand.encoding
        signature = (
            cand.chart_type,
            enc.get("x"),
            enc.get("y"),
            enc.get("series"),
            enc.get("agg"),
        )
        if signature in seen_signatures:
            continue
        # A different chart type over the exact same column pair is redundant.
        pair_signature = (enc.get("x"), enc.get("y"), enc.get("series"), enc.get("agg"))
        if any(
            (s.encoding.get("x"), s.encoding.get("y"), s.encoding.get("series"), s.encoding.get("agg"))
            == pair_signature
            for s in selected
        ):
            continue
        # Cap repetition of any single chart type.
        cap = 3 if cand.chart_type in {LINE, BAR, BAR_HORIZONTAL} else 2
        if type_counts.get(cand.chart_type, 0) >= cap:
            continue

        seen_signatures.add(signature)
        type_counts[cand.chart_type] = type_counts.get(cand.chart_type, 0) + 1
        selected.append(cand)
        if len(selected) >= max_charts:
            break
    return selected


# --- Rule: time series ----------------------------------------------------

def _temporal_rules(
    analysis: dict[str, Any], metrics: list[dict[str, Any]], temporal: list[dict[str, Any]]
) -> list[Recommendation]:
    """Principle: a continuous quantity over time reads best as a line."""
    out: list[Recommendation] = []
    if not temporal or not metrics:
        return out

    trends = {(t["date_column"], t["metric_column"]): t for t in analysis.get("trends", [])}

    for trend_key, trend in trends.items():
        date_col, metric_col = trend_key
        if trend["periods"] < 3:
            continue
        # A single series over many points: line. Few points: area reads fuller.
        chart = LINE if trend["periods"] > 8 else AREA
        change = trend.get("change_pct")
        movement = (
            f"variação de {change:+.1f}% no período" if change is not None else "evolução no período"
        )
        strength = min(1.0, trend["periods"] / 24)
        significance = min(1.0, abs(change or 0) / 50)

        out.append(
            Recommendation(
                chart_type=chart,
                title=f"Evolução de {sem.humanize(metric_col)}",
                subtitle=f"Por {_grain_label(trend['grain'])} · {movement}",
                encoding={
                    "x": date_col,
                    "y": metric_col,
                    "agg": trend.get("agg", "sum"),
                    "time_grain": trend["grain"],
                },
                rationale=(
                    f"“{date_col}” é uma coluna temporal com {trend['periods']} períodos e "
                    f"“{metric_col}” é uma métrica contínua. Séries temporais são lidas com "
                    "mais precisão em linhas, porque a inclinação do traço representa "
                    "diretamente a taxa de variação."
                ),
                principle="Série temporal → linha/área",
                score=0.92 + 0.05 * strength + 0.08 * significance,
                columns=[date_col, metric_col],
                options={"show_trendline": (trend.get("r_squared") or 0) > 0.4},
            )
        )

    # Comparing two metrics on the same timeline is more useful than two charts.
    if len(metrics) >= 2 and temporal:
        date_col = temporal[0]["name"]
        pair = [m["name"] for m in metrics[:2]]
        if all((date_col, m) in trends for m in pair):
            out.append(
                Recommendation(
                    chart_type=LINE,
                    title=f"{sem.humanize(pair[0])} vs {sem.humanize(pair[1])} — crescimento comparado",
                    subtitle="Indexado: primeiro período = 100",
                    encoding={
                        "x": date_col,
                        "y": pair[0],
                        "y2": pair[1],
                        "agg": trends[(date_col, pair[0])].get("agg", "sum"),
                        "agg2": trends[(date_col, pair[1])].get("agg", "sum"),
                        "time_grain": trends[(date_col, pair[0])]["grain"],
                        "normalize": "index_100",
                    },
                    rationale=(
                        "As duas métricas compartilham o eixo temporal, mas têm escalas "
                        "diferentes. Em vez de dois eixos Y — cujo alinhamento é arbitrário e "
                        "inventa correlações que não existem nos dados — ambas são indexadas "
                        "ao primeiro período (=100) e plotadas em um único eixo, o que torna "
                        "as taxas de crescimento diretamente comparáveis."
                    ),
                    principle="Escalas diferentes → indexar à base comum, nunca eixo duplo",
                    score=0.74,
                    columns=[date_col, *pair],
                    options={"normalize": "index_100"},
                )
            )
    return out


def _grain_label(grain: str) -> str:
    return {
        "hour": "hora", "day": "dia", "week": "semana",
        "month": "mês", "quarter": "trimestre", "year": "ano",
    }.get(grain, grain)


# --- Rule: comparison between categories ----------------------------------

def _comparison_rules(
    analysis: dict[str, Any], metrics: list[dict[str, Any]], dimensions: list[dict[str, Any]]
) -> list[Recommendation]:
    """Principle: comparing magnitudes across categories → bars on a zero baseline."""
    out: list[Recommendation] = []
    breakdowns = analysis.get("breakdowns", [])

    for breakdown in breakdowns:
        dim = breakdown["dimension"]
        metric = breakdown.get("metric")
        distinct = breakdown["distinct"]
        if distinct < 2:
            continue

        agg = breakdown.get("agg", "sum")
        metric_label = metric or "registros"
        # Long labels and long tails read better horizontally.
        longest_label = max((len(i["label"]) for i in breakdown["items"]), default=0)
        horizontal = distinct > 6 or longest_label > 14
        chart = BAR_HORIZONTAL if horizontal else BAR

        spread = 0.0
        items = breakdown["items"]
        if len(items) > 1 and items[0]["value"]:
            spread = abs((items[0]["value"] - items[-1]["value"]) / items[0]["value"])

        metric_display = sem.humanize(metric) if metric else "Registros"
        title = (
            f"Ranking de {metric_display.lower()} por {sem.humanize(dim).lower()}"
            if horizontal
            else f"{metric_display} por {sem.humanize(dim).lower()}"
        )
        out.append(
            Recommendation(
                chart_type=chart,
                title=title,
                subtitle=f"{min(distinct, len(items))} de {distinct} valores · agregação: {_agg_label(agg)}",
                encoding={
                    "x": dim,
                    "y": metric,
                    "agg": agg,
                    "limit": 12,
                    "sort": "desc",
                },
                rationale=(
                    f"“{dim}” é uma dimensão com {distinct} valores distintos e "
                    f"“{metric_label}” é agregável. Barras partindo do zero permitem "
                    "comparar magnitudes com precisão, pois o comprimento é proporcional "
                    "ao valor."
                    + (
                        " A orientação horizontal foi escolhida porque os rótulos são longos "
                        "ou numerosos, evitando texto rotacionado."
                        if horizontal
                        else ""
                    )
                ),
                principle="Comparação entre categorias → barras",
                score=0.86 + min(0.1, spread / 6) - (0.05 if distinct > 25 else 0),
                columns=[dim] + ([metric] if metric else []),
            )
        )
    return out


def _agg_label(agg: str) -> str:
    return {
        "sum": "soma", "mean": "média", "median": "mediana",
        "count": "contagem", "min": "mínimo", "max": "máximo",
        "nunique": "valores distintos",
    }.get(agg, agg)


# --- Rule: composition (part of whole) ------------------------------------

def _composition_rules(
    analysis: dict[str, Any], metrics: list[dict[str, Any]], dimensions: list[dict[str, Any]]
) -> list[Recommendation]:
    """Principle: part-of-whole only when parts are few and sum to a meaningful total."""
    out: list[Recommendation] = []
    for breakdown in analysis.get("breakdowns", []):
        distinct = breakdown["distinct"]
        total = breakdown.get("total")
        items = breakdown["items"]
        if total is None or total <= 0 or not items:
            continue
        # Negative parts make a share meaningless.
        if any((i["value"] or 0) < 0 for i in items):
            continue

        dim = breakdown["dimension"]
        metric = breakdown.get("metric")

        if 2 <= distinct <= 6:
            out.append(
                Recommendation(
                    chart_type=DONUT,
                    title=f"Composição de {sem.humanize(metric).lower() if metric else 'registros'} por {sem.humanize(dim).lower()}",
                    subtitle=f"{distinct} segmentos · total {stats._fmt_num(total)}",
                    encoding={"x": dim, "y": metric, "agg": breakdown.get("agg", "sum"), "limit": 6},
                    rationale=(
                        f"“{dim}” tem apenas {distinct} categorias, todas com valores "
                        "não negativos que somam um total significativo. Nesse cenário "
                        "restrito o donut comunica participação relativa de forma imediata; "
                        "com mais categorias os ângulos ficariam indistinguíveis."
                    ),
                    principle="Composição com poucas partes → donut",
                    score=0.68 + (0.08 if distinct <= 4 else 0.0),
                    columns=[dim] + ([metric] if metric else []),
                )
            )
        elif 7 <= distinct <= 40 and breakdown.get("pareto_share", 0) >= 0.6:
            out.append(
                Recommendation(
                    chart_type=TREEMAP,
                    title=f"Participação de {sem.humanize(metric).lower() if metric else 'registros'} por {sem.humanize(dim).lower()}",
                    subtitle=f"{distinct} categorias · área proporcional ao valor",
                    encoding={"x": dim, "y": metric, "agg": breakdown.get("agg", "sum"), "limit": 30},
                    rationale=(
                        f"Com {distinct} categorias um gráfico de pizza seria ilegível. "
                        "O treemap codifica o valor pela área, acomodando muitas partes e "
                        "evidenciando a concentração — "
                        f"os 20% maiores somam {breakdown['pareto_share']:.0%} do total."
                    ),
                    principle="Composição com muitas partes → treemap",
                    score=0.66 + min(0.1, breakdown["pareto_share"] / 8),
                    columns=[dim] + ([metric] if metric else []),
                )
            )
    return out


# --- Rule: correlation ----------------------------------------------------

def _correlation_rules(
    analysis: dict[str, Any], metrics: list[dict[str, Any]]
) -> list[Recommendation]:
    """Principle: relationship between two continuous variables → scatter."""
    out: list[Recommendation] = []
    metric_names = {m["name"] for m in metrics}

    for pair in analysis.get("correlations", {}).get("pairs", [])[:3]:
        if pair["abs"] < 0.45:
            continue
        if pair["x"] not in metric_names or pair["y"] not in metric_names:
            continue
        out.append(
            Recommendation(
                chart_type=SCATTER,
                title=f"Relação entre {sem.humanize(pair['x'])} e {sem.humanize(pair['y'])}",
                subtitle=f"Correlação {pair['strength']} ({pair['coefficient']:+.2f})",
                encoding={"x": pair["x"], "y": pair["y"], "agg": "none"},
                rationale=(
                    f"As duas variáveis são contínuas e apresentam correlação "
                    f"{'de Spearman' if pair.get('method') == 'spearman' else 'de Pearson'} "
                    f"{pair['coefficient']:+.2f} sobre {pair['sample_size']} registros. "
                    "A dispersão é a única forma de exibir a relação ponto a ponto, "
                    "revelando agrupamentos e desvios que um coeficiente sozinho esconde."
                    + (
                        " Aqui Pearson é distorcido por valores extremos, então a força "
                        "real da relação vem do coeficiente de postos."
                        if pair.get("outlier_sensitive")
                        else ""
                    )
                ),
                principle="Correlação entre variáveis contínuas → dispersão",
                score=0.7 + min(0.2, pair["abs"] / 3),
                columns=[pair["x"], pair["y"]],
                options={"show_regression": True},
            )
        )

    # A heatmap earns its place only when there are enough numeric columns
    # that pairwise scatters would be impractical.
    corr = analysis.get("correlations", {})
    if len(corr.get("columns", [])) >= 4 and corr.get("pairs"):
        out.append(
            Recommendation(
                chart_type=HEATMAP,
                title="Matriz de correlação",
                subtitle=f"{len(corr['columns'])} métricas numéricas",
                encoding={"matrix": "correlation", "agg": "none"},
                rationale=(
                    f"Com {len(corr['columns'])} métricas numéricas existiriam "
                    f"{len(corr['columns']) * (len(corr['columns']) - 1) // 2} pares possíveis. "
                    "O heatmap resume todas as relações em uma única leitura, usando cor "
                    "divergente para separar correlações positivas de negativas."
                ),
                principle="Múltiplas dimensões numéricas → heatmap",
                score=0.6,
                columns=list(corr["columns"]),
            )
        )
    return out


# --- Rule: distribution ---------------------------------------------------

def _distribution_rules(metrics: list[dict[str, Any]]) -> list[Recommendation]:
    """Principle: the shape of a single variable → histogram; spread/outliers → box plot."""
    out: list[Recommendation] = []
    for metric in metrics[:4]:
        col_stats = metric.get("stats") or {}
        if col_stats.get("count", 0) < 20:
            continue
        if metric["unique_count"] < 8:
            continue

        skew = col_stats.get("skewness")
        outlier_ratio = (col_stats.get("outliers") or {}).get("ratio", 0)
        interesting = abs(skew or 0) > 0.6 or outlier_ratio > 0.02

        out.append(
            Recommendation(
                chart_type=HISTOGRAM,
                title=f"Distribuição de {sem.humanize(metric['name'])}",
                subtitle=(
                    f"Mediana {stats._fmt_num(col_stats.get('median') or 0)} · "
                    f"{col_stats.get('count', 0)} valores"
                ),
                encoding={"x": metric["name"], "agg": "count"},
                rationale=(
                    f"“{metric['name']}” é contínua com {metric['unique_count']} valores "
                    "distintos. O histograma mostra a forma da distribuição — concentração, "
                    "caudas e multimodalidade — que medidas resumo como a média não revelam."
                    + (
                        f" Aqui a assimetria é {skew:.2f}, então média e mediana divergem."
                        if skew is not None and abs(skew) > 0.6
                        else ""
                    )
                ),
                principle="Distribuição de uma variável → histograma",
                score=0.58 + (0.14 if interesting else 0.0),
                columns=[metric["name"]],
            )
        )

        if outlier_ratio > 0.03:
            out.append(
                Recommendation(
                    chart_type=BOX_PLOT,
                    title=f"Dispersão e outliers de {sem.humanize(metric['name'])}",
                    subtitle=f"{(col_stats.get('outliers') or {}).get('count', 0)} valores atípicos",
                    encoding={"y": metric["name"], "agg": "none"},
                    rationale=(
                        f"{outlier_ratio:.1%} dos valores caem fora das cercas de Tukey. "
                        "O box plot posiciona quartis, mediana e outliers em uma escala "
                        "comum, tornando o desvio imediatamente visível."
                    ),
                    principle="Dispersão e valores atípicos → box plot",
                    score=0.55 + min(0.15, outlier_ratio * 2),
                    columns=[metric["name"]],
                )
            )
    return out


# --- Rule: geography ------------------------------------------------------

def _geo_rules(
    analysis: dict[str, Any],
    metrics: list[dict[str, Any]],
    dimensions: list[dict[str, Any]],
    profile: dict[str, Any],
) -> list[Recommendation]:
    """Principle: spatial data → map, but only when the places are recognisable."""
    out: list[Recommendation] = []
    geo_columns = [
        c for c in profile["columns"]
        if c["semantic_type"] == sem.GEO
        and c["detail"].get("geo_kind") in {"state", "country"}
        and 1 < c["unique_count"] <= 200
    ]
    if not geo_columns:
        return out

    metric_name = metrics[0]["name"] if metrics else None
    metric_agg = (metrics[0].get("detail") or {}).get("default_agg", "sum") if metrics else "count"
    for geo in geo_columns[:1]:
        kind = geo["detail"]["geo_kind"]
        out.append(
            Recommendation(
                chart_type=MAP,
                title=f"Distribuição geográfica de {sem.humanize(metric_name).lower() if metric_name else 'registros'}",
                subtitle=f"Por {geo['name']} · {geo['unique_count']} localidades",
                encoding={
                    "x": geo["name"],
                    "y": metric_name,
                    "agg": metric_agg if metric_name else "count",
                    "geo_kind": kind,
                },
                rationale=(
                    f"“{geo['name']}” contém {kind_label(kind)} reconhecíveis. "
                    "Um mapa coroplético usa a posição real no espaço, permitindo "
                    "identificar padrões regionais que uma lista ordenada não expõe."
                ),
                principle="Dados geográficos → mapa",
                score=0.72,
                columns=[geo["name"]] + ([metric_name] if metric_name else []),
            )
        )
    return out


def kind_label(kind: str) -> str:
    return {"state": "unidades federativas", "country": "países", "city": "cidades"}.get(
        kind, "localidades"
    )


# --- Rule: two dimensions crossed -----------------------------------------

def _cross_dimension_rules(
    frame: pd.DataFrame, metrics: list[dict[str, Any]], dimensions: list[dict[str, Any]]
) -> list[Recommendation]:
    """Principle: two categorical axes plus a measure → heatmap or stacked bars."""
    out: list[Recommendation] = []
    small_dims = [d for d in dimensions if 2 <= d["unique_count"] <= 15]
    if len(small_dims) < 2 or not metrics:
        return out

    dim_a, dim_b = small_dims[0], small_dims[1]
    metric = metrics[0]["name"]
    metric_agg = (metrics[0].get("detail") or {}).get("default_agg", "sum")
    cells = dim_a["unique_count"] * dim_b["unique_count"]
    if cells > 200:
        return out

    out.append(
        Recommendation(
            chart_type=HEATMAP,
            title=f"{sem.humanize(metric)} por {sem.humanize(dim_a['name']).lower()} e {sem.humanize(dim_b['name']).lower()}",
            subtitle=f"Matriz {dim_a['unique_count']} × {dim_b['unique_count']}",
            encoding={
                "x": dim_a["name"],
                "series": dim_b["name"],
                "y": metric,
                "agg": metric_agg,
                "matrix": "cross",
            },
            rationale=(
                f"Cruzar “{dim_a['name']}” ({dim_a['unique_count']} valores) com "
                f"“{dim_b['name']}” ({dim_b['unique_count']} valores) gera {cells} "
                "combinações. O heatmap codifica a intensidade por cor, permitindo "
                "localizar concentrações sem sobrecarregar o eixo com séries."
            ),
            principle="Duas dimensões + medida → heatmap",
            score=0.64,
            columns=[dim_a["name"], dim_b["name"], metric],
        )
    )

    if dim_b["unique_count"] <= 6:
        out.append(
            Recommendation(
                chart_type=STACKED_BAR,
                title=f"{sem.humanize(metric)} por {sem.humanize(dim_a['name']).lower()}, segmentado por {sem.humanize(dim_b['name']).lower()}",
                subtitle=f"{dim_b['unique_count']} segmentos empilhados",
                encoding={
                    "x": dim_a["name"],
                    "series": dim_b["name"],
                    "y": metric,
                    "agg": metric_agg,
                    "limit": 12,
                },
                rationale=(
                    f"“{dim_b['name']}” tem apenas {dim_b['unique_count']} valores, poucos o "
                    "suficiente para empilhar sem confundir. As barras mantêm a leitura do "
                    "total por categoria enquanto revelam a composição interna."
                ),
                principle="Total + composição → barras empilhadas",
                score=0.62,
                columns=[dim_a["name"], dim_b["name"], metric],
            )
        )
    return out


# --- Rule: sequential process (funnel) -------------------------------------

# Canonical, ordered pipeline stages. A metric matching a tier is a *stage*;
# stage order comes from this list's order, never from magnitude — a funnel's
# defining principle is sequence, and a later stage that outscores an earlier
# one (bad data, a mislabelled column) is a Data Quality problem to surface,
# not a reason to silently reorder the chart.
_FUNNEL_STAGE_TIERS: tuple[tuple[str, ...], ...] = (
    ("impressao", "impressoes", "impression", "impressions", "alcance", "reach"),
    (
        "visita", "visitas", "visit", "visits", "sessao", "sessoes", "session",
        "sessions", "trafego", "traffic", "clique", "cliques", "click", "clicks",
        "visualizacao", "visualizacoes", "view", "views",
    ),
    (
        "lead", "leads", "cadastro", "cadastros", "signup", "signups",
        "inscricao", "inscricoes", "registration", "contato", "contatos",
    ),
    (
        "oportunidade", "oportunidades", "opportunity", "opportunities",
        "qualificado", "qualificados", "qualified", "proposta", "propostas",
        "proposal", "orcamento", "orcamentos", "quote", "quotes",
    ),
    (
        "venda", "vendas", "sale", "sales", "conversao", "conversoes",
        "conversion", "conversions", "cliente", "clientes", "customer",
        "customers", "pedido", "pedidos", "order", "orders", "fechamento",
        "fechamentos", "compra", "compras", "purchase", "purchases",
    ),
)


def _funnel_rules(profile: dict[str, Any], metrics: list[dict[str, Any]]) -> list[Recommendation]:
    """Principle: a sequential process with falling volume at each step is a
    funnel — the width of each bar encodes what fraction of the previous
    stage survived, which a bar or line chart cannot show directly."""
    by_slug = {sem.slugify(m["name"]): m for m in metrics}
    staged: list[dict[str, Any]] = []
    used_slugs: set[str] = set()

    for tier in _FUNNEL_STAGE_TIERS:
        match = next(
            (
                by_slug[slug]
                for slug in by_slug
                if slug not in used_slugs and any(slug == kw or kw in slug.split("_") for kw in tier)
            ),
            None,
        )
        if match is not None:
            staged.append(match)
            used_slugs.add(sem.slugify(match["name"]))

    # A funnel needs at least three stages, and every stage must be a flow
    # count or amount (additive) — a conversion *rate* is not a stage.
    staged = [m for m in staged if (m.get("detail") or {}).get("additive", True)]
    if len(staged) < 3:
        return []

    column_names = [m["name"] for m in staged]
    stage_labels = [sem.humanize(name) for name in column_names]
    first, last = staged[0], staged[-1]
    first_stats, last_stats = first.get("stats") or {}, last.get("stats") or {}
    overall_rate = None
    if first_stats.get("sum") and last_stats.get("sum") is not None:
        overall_rate = last_stats["sum"] / first_stats["sum"] * 100 if first_stats["sum"] else None

    subtitle = f"{len(staged)} etapas"
    if overall_rate is not None:
        subtitle += f" · conversão total {overall_rate:.1f}%"

    return [
        Recommendation(
            chart_type=FUNNEL,
            title=f"Funil de {stage_labels[0].lower()} até {stage_labels[-1].lower()}",
            subtitle=subtitle,
            encoding={"metrics": column_names, "labels": stage_labels, "agg": "sum"},
            rationale=(
                f"As colunas {', '.join(column_names)} nomeiam etapas reconhecíveis de um "
                "processo sequencial, na ordem em que um registro normalmente passa por "
                "elas. Um funil mostra a retenção degrau a degrau — a largura de cada "
                "barra é proporcional ao volume que chegou até ali — algo que barras "
                "lado a lado não comunicam diretamente."
            ),
            principle="Processo sequencial com etapas → funil",
            score=0.7 + (min(0.1, (100 - overall_rate) / 1000) if overall_rate else 0),
            columns=column_names,
        )
    ]


# --- Rule: many metrics, few entities (radar) -------------------------------

def _radar_rules(
    metrics: list[dict[str, Any]], dimensions: list[dict[str, Any]]
) -> list[Recommendation]:
    """Principle: comparing a handful of entities across several metrics at
    once is a shape-comparison problem — each entity becomes a polygon, each
    metric an axis — that no single-metric chart (bar, donut) can pose at
    all, because those only ever plot one measure at a time."""
    if len(metrics) < 3:
        return []
    # A cardinality with a genuine "top few" to compare, small enough that
    # three overlapping polygons stay legible (the categorical palette's
    # all-pairs-safe range is 3 slots, for the same readability reason).
    candidates = [d for d in dimensions if 3 <= d["unique_count"] <= 40]
    if not candidates:
        return []
    dim = candidates[0]
    top_metrics = metrics[:5]
    metric_names = [m["name"] for m in top_metrics]
    metric_labels = [sem.humanize(name).lower() for name in metric_names]

    return [
        Recommendation(
            chart_type=RADAR,
            title=f"Comparativo de {sem.humanize(dim['name']).lower()} em {len(top_metrics)} métricas",
            subtitle="Top 3 · cada eixo normalizado de 0 a 100",
            encoding={"x": dim["name"], "metrics": metric_names, "limit": 3},
            rationale=(
                f"Há {len(top_metrics)} métricas disponíveis e “{dim['name']}” é uma "
                f"dimensão com {dim['unique_count']} valores — o bastante para ter um "
                "“top 3” significativo. Um radar sobrepõe as três entidades líderes como "
                f"polígonos, um eixo por métrica ({', '.join(metric_labels)}), revelando "
                "o perfil de cada uma de um jeito que gráficos de uma métrica só, como "
                "barra ou donut, não conseguem mostrar de uma vez."
            ),
            principle="Múltiplas métricas, poucas entidades → radar normalizado",
            score=0.56,
            columns=[dim["name"], *metric_names],
        )
    ]


# --- KPI selection --------------------------------------------------------

def recommend_kpis(
    frame: pd.DataFrame,
    profile: dict[str, Any],
    analysis: dict[str, Any],
    domain_info: dict[str, Any],
    max_kpis: int = 4,
) -> list[dict[str, Any]]:
    """Pick the headline numbers, each with a period-over-period delta when possible."""
    buckets = _columns_by_role(profile)
    metrics = [c for c in buckets[sem.METRIC] if c["missing_ratio"] < 0.6]
    ranked = domain_mod.rank_metric_columns(domain_info["key"], [m["name"] for m in metrics])
    metrics.sort(key=lambda m: ranked.index(m["name"]))

    trends_by_metric = {t["metric_column"]: t for t in analysis.get("trends", [])}
    kpis: list[dict[str, Any]] = []

    # Record count is always meaningful and needs no metric column.
    kpis.append(
        {
            "id": "kpi_records",
            "label": "Registros",
            "value": profile["overview"]["row_count"],
            "format": "integer",
            "column": None,
            "agg": "count",
            "delta": None,
            "rationale": "Volume total de linhas analisadas no conjunto de dados.",
        }
    )

    for metric in metrics[: max_kpis - 1]:
        name = metric["name"]
        col_stats = metric.get("stats") or {}
        stype = metric["semantic_type"]

        # Summing a unit price or a rate produces a meaningless number, so the
        # aggregation follows the column's additivity, not just its type.
        additive = (metric.get("detail") or {}).get("additive")
        if additive is None:
            additive = sem.infer_additivity(name, stype)
        if additive and col_stats.get("negatives", 0) == 0:
            agg, value, label = "sum", col_stats.get("sum"), f"Total de {sem.humanize(name).lower()}"
        else:
            agg, value, label = "mean", col_stats.get("mean"), f"{sem.humanize(name)} (média)"

        if value is None:
            continue

        delta = None
        trend = trends_by_metric.get(name)
        if trend and trend["periods"] >= 2:
            points = trend["points"]
            current, previous = points[-1]["value"], points[-2]["value"]
            if current is not None and previous not in (None, 0):
                change = (current - previous) / abs(previous) * 100
                delta = {
                    "value": round(change, 2),
                    "direction": "up" if change > 0 else "down" if change < 0 else "flat",
                    "label": f"vs. {points[-2]['label']}",
                    "current_period": points[-1]["label"],
                    "previous_period": points[-2]["label"],
                    "current_value": current,
                    "previous_value": previous,
                }

        kpis.append(
            {
                "id": f"kpi_{sem.slugify(name)}",
                "label": label,
                "value": value,
                "format": _kpi_format(stype),
                "column": name,
                "agg": agg,
                "delta": delta,
                "rationale": (
                    f"“{name}” é a métrica {'principal' if metric is metrics[0] else 'secundária'} "
                    f"identificada para este conjunto. A agregação escolhida foi "
                    f"{_agg_label(agg)} porque um valor do tipo {_type_label(stype)} "
                    + ("pode ser somado entre registros." if agg == "sum"
                       else "não pode ser somado entre registros sem perder o significado.")
                ),
            }
        )

    # Averages that describe the business, e.g. ticket médio.
    extra = _derived_kpis(profile, analysis, domain_info)
    kpis.extend(extra)
    return kpis[:max_kpis]


def _derived_kpis(
    profile: dict[str, Any], analysis: dict[str, Any], domain_info: dict[str, Any]
) -> list[dict[str, Any]]:
    """Domain-aware derived KPIs (only when the inputs genuinely exist)."""
    out: list[dict[str, Any]] = []
    money = [
        c for c in profile["columns"]
        if c["semantic_type"] == sem.CURRENCY
        and c["role"] == sem.METRIC
        and (c.get("detail") or {}).get("additive", True)
    ]
    if domain_info["key"] == "sales" and money:
        col = money[0]
        col_stats = col.get("stats") or {}
        mean = col_stats.get("mean")
        if mean is not None:
            out.append(
                {
                    "id": "kpi_ticket_medio",
                    "label": "Ticket médio",
                    "value": mean,
                    "format": "currency",
                    "column": col["name"],
                    "agg": "mean",
                    "delta": None,
                    "rationale": (
                        f"Valor médio por registro de “{col['name']}”. Em dados de vendas "
                        "o ticket médio indica a qualidade da receita, não apenas o volume."
                    ),
                }
            )
    return out


def _kpi_format(semantic_type: str) -> str:
    return {
        sem.CURRENCY: "currency",
        sem.PERCENTAGE: "percent",
        sem.INTEGER: "integer",
    }.get(semantic_type, "decimal")


def _type_label(semantic_type: str) -> str:
    return {
        sem.CURRENCY: "monetário",
        sem.PERCENTAGE: "percentual",
        sem.INTEGER: "contagem",
        sem.FLOAT: "contínuo",
    }.get(semantic_type, "numérico")
