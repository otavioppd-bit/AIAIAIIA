"""Data quality scoring with actionable, dataset-specific findings."""
from __future__ import annotations

from typing import Any

from app.services import semantics as sem

# Weights sum to 1.0. Each dimension is scored 0-100 and combined.
_WEIGHTS = {
    "completeness": 0.30,
    "uniqueness": 0.20,
    "consistency": 0.20,
    "validity": 0.20,
    "richness": 0.10,
}

_SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def score_dataset(profile: dict[str, Any]) -> dict[str, Any]:
    """Compute a 0-100 quality score with per-dimension breakdown and issues."""
    overview = profile["overview"]
    columns = profile["columns"]
    row_count = max(int(overview["row_count"]), 1)

    issues: list[dict[str, Any]] = []

    completeness = _score_completeness(overview, columns, issues)
    uniqueness = _score_uniqueness(overview, columns, row_count, issues)
    consistency = _score_consistency(columns, row_count, issues)
    validity = _score_validity(columns, issues)
    richness = _score_richness(columns, issues)

    dimensions = {
        "completeness": completeness,
        "uniqueness": uniqueness,
        "consistency": consistency,
        "validity": validity,
        "richness": richness,
    }
    total = sum(dimensions[k] * w for k, w in _WEIGHTS.items())
    score = int(round(max(0.0, min(100.0, total))))

    issues.sort(key=lambda i: (_SEVERITY_ORDER.get(i["severity"], 9), -i.get("impact", 0)))

    return {
        "score": score,
        "grade": _grade(score),
        "label": _label(score),
        "dimensions": [
            {
                "key": key,
                "label": _DIMENSION_LABELS[key],
                "score": int(round(value)),
                "weight": _WEIGHTS[key],
                "description": _DIMENSION_DESCRIPTIONS[key],
            }
            for key, value in dimensions.items()
        ],
        "issues": issues,
        "issue_counts": {
            severity: sum(1 for i in issues if i["severity"] == severity)
            for severity in ("critical", "high", "medium", "low")
        },
    }


_DIMENSION_LABELS = {
    "completeness": "Completude",
    "uniqueness": "Unicidade",
    "consistency": "Consistência",
    "validity": "Validade",
    "richness": "Riqueza analítica",
}

_DIMENSION_DESCRIPTIONS = {
    "completeness": "Proporção de células preenchidas no conjunto de dados.",
    "uniqueness": "Ausência de linhas duplicadas e de colunas redundantes.",
    "consistency": "Estabilidade de formatos, categorias e cardinalidade.",
    "validity": "Valores dentro de faixas plausíveis, sem outliers extremos.",
    "richness": "Variedade de métricas, dimensões e séries temporais disponíveis.",
}


def _grade(score: int) -> str:
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    if score >= 55:
        return "D"
    return "E"


def _label(score: int) -> str:
    if score >= 90:
        return "Excelente"
    if score >= 80:
        return "Boa"
    if score >= 70:
        return "Aceitável"
    if score >= 55:
        return "Requer atenção"
    return "Crítica"


def _add(
    issues: list[dict[str, Any]],
    *,
    severity: str,
    title: str,
    description: str,
    recommendation: str,
    columns: list[str] | None = None,
    impact: float = 0.0,
    category: str = "geral",
) -> None:
    issues.append(
        {
            "severity": severity,
            "category": category,
            "title": title,
            "description": description,
            "recommendation": recommendation,
            "columns": columns or [],
            "impact": round(float(impact), 4),
        }
    )


def _score_completeness(
    overview: dict[str, Any], columns: list[dict[str, Any]], issues: list[dict[str, Any]]
) -> float:
    missing_ratio = float(overview["missing_ratio"])
    score = max(0.0, 100.0 - missing_ratio * 160.0)

    critical = [c for c in columns if c["missing_ratio"] > 0.5]
    moderate = [c for c in columns if 0.15 < c["missing_ratio"] <= 0.5]

    if critical:
        _add(
            issues,
            severity="critical",
            category="completude",
            title=f"{len(critical)} coluna(s) com mais de 50% de valores ausentes",
            description="Colunas majoritariamente vazias distorcem médias e podem "
            "gerar gráficos enganosos: "
            + ", ".join(f"{c['name']} ({c['missing_ratio']:.0%})" for c in critical[:5]),
            recommendation="Remova essas colunas da análise ou obtenha os dados na origem "
            "antes de usá-las como métrica ou dimensão.",
            columns=[c["name"] for c in critical],
            impact=sum(c["missing_ratio"] for c in critical) / max(len(columns), 1),
        )
    if moderate:
        _add(
            issues,
            severity="medium",
            category="completude",
            title=f"{len(moderate)} coluna(s) com preenchimento parcial",
            description="Entre 15% e 50% dos valores estão ausentes em: "
            + ", ".join(f"{c['name']} ({c['missing_ratio']:.0%})" for c in moderate[:5]),
            recommendation="Defina uma política de imputação (média, mediana ou categoria "
            "'Não informado') ou filtre os registros incompletos.",
            columns=[c["name"] for c in moderate],
            impact=sum(c["missing_ratio"] for c in moderate) / max(len(columns), 1),
        )
    return score


def _score_uniqueness(
    overview: dict[str, Any],
    columns: list[dict[str, Any]],
    row_count: int,
    issues: list[dict[str, Any]],
) -> float:
    dup_ratio = float(overview["duplicate_ratio"])
    score = max(0.0, 100.0 - dup_ratio * 220.0)

    if overview["duplicate_rows"] > 0:
        severity = "high" if dup_ratio > 0.05 else "medium" if dup_ratio > 0.01 else "low"
        _add(
            issues,
            severity=severity,
            category="unicidade",
            title=f"{overview['duplicate_rows']:,} linha(s) duplicada(s)".replace(",", "."),
            description=f"{dup_ratio:.1%} das linhas são cópias exatas de outra linha, "
            "o que infla somas e contagens.",
            recommendation="Deduplique os registros antes de agregar, ou confirme se "
            "duplicatas são legítimas (ex.: itens repetidos de um mesmo pedido).",
            impact=dup_ratio,
        )

    constants = overview.get("constant_columns") or []
    if constants:
        score -= min(15.0, len(constants) * 4.0)
        _add(
            issues,
            severity="low",
            category="unicidade",
            title=f"{len(constants)} coluna(s) com valor único constante",
            description="Estas colunas têm sempre o mesmo valor e não agregam informação: "
            + ", ".join(constants[:6]),
            recommendation="Remova-as do dataset para simplificar a análise.",
            columns=constants,
            impact=len(constants) / max(len(columns), 1),
        )
    return max(0.0, score)


def _score_consistency(
    columns: list[dict[str, Any]], row_count: int, issues: list[dict[str, Any]]
) -> float:
    score = 100.0

    # Categorical columns whose cardinality approaches the row count are
    # usually free text that was never standardised.
    noisy = [
        c
        for c in columns
        if c["semantic_type"] == sem.CATEGORICAL
        and c["unique_count"] > 50
        and c["cardinality_ratio"] > 0.5
    ]
    if noisy:
        score -= min(30.0, len(noisy) * 12.0)
        _add(
            issues,
            severity="medium",
            category="consistencia",
            title=f"{len(noisy)} coluna(s) categórica(s) com cardinalidade muito alta",
            description="Valores quase sempre distintos sugerem texto livre ou falta de "
            "padronização em: " + ", ".join(c["name"] for c in noisy[:5]),
            recommendation="Padronize os rótulos (maiúsculas/minúsculas, acentuação, "
            "espaços) ou trate a coluna como identificador em vez de dimensão.",
            columns=[c["name"] for c in noisy],
            impact=len(noisy) / max(len(columns), 1),
        )

    # Rare categories that appear exactly once often indicate typos.
    typo_prone = [
        c
        for c in columns
        if c["semantic_type"] in {sem.CATEGORICAL, sem.GEO}
        and c.get("stats", {}).get("rare_values", 0) > 0
        and 1 < c["unique_count"] <= 60
        and c["stats"]["rare_values"] / max(c["unique_count"], 1) > 0.3
    ]
    if typo_prone:
        score -= min(15.0, len(typo_prone) * 6.0)
        _add(
            issues,
            severity="low",
            category="consistencia",
            title="Categorias que aparecem uma única vez",
            description="Possíveis erros de digitação ou variações do mesmo rótulo em: "
            + ", ".join(c["name"] for c in typo_prone[:5]),
            recommendation="Revise os valores raros e agrupe variações equivalentes "
            "(ex.: 'SP' e 'São Paulo').",
            columns=[c["name"] for c in typo_prone],
            impact=0.2,
        )
    return max(0.0, score)


def _score_validity(columns: list[dict[str, Any]], issues: list[dict[str, Any]]) -> float:
    score = 100.0
    numeric = [c for c in columns if c["semantic_type"] in sem.NUMERIC_TYPES]

    heavy_outliers = [
        c
        for c in numeric
        if c.get("stats", {}).get("outliers", {}).get("ratio", 0) > 0.05
    ]
    if heavy_outliers:
        penalty = sum(c["stats"]["outliers"]["ratio"] for c in heavy_outliers) * 100
        score -= min(35.0, penalty)
        _add(
            issues,
            severity="medium",
            category="validade",
            title=f"{len(heavy_outliers)} coluna(s) com muitos valores atípicos",
            description="Mais de 5% dos valores estão fora das cercas de Tukey em: "
            + ", ".join(
                f"{c['name']} ({c['stats']['outliers']['ratio']:.1%})"
                for c in heavy_outliers[:5]
            ),
            recommendation="Verifique erros de unidade ou digitação. Se forem legítimos, "
            "prefira mediana a média e considere escala logarítmica nos gráficos.",
            columns=[c["name"] for c in heavy_outliers],
            impact=max(c["stats"]["outliers"]["ratio"] for c in heavy_outliers),
        )

    extreme = [
        c for c in numeric if c.get("stats", {}).get("outliers", {}).get("extreme_count", 0) > 0
    ]
    if extreme:
        _add(
            issues,
            severity="high" if len(extreme) > 2 else "low",
            category="validade",
            title="Valores extremos detectados",
            description="Valores além de 3× o intervalo interquartil em: "
            + ", ".join(
                f"{c['name']} ({c['stats']['outliers']['extreme_count']})" for c in extreme[:5]
            ),
            recommendation="Inspecione esses registros individualmente — costumam ser "
            "erros de entrada (vírgula decimal, multiplicador errado).",
            columns=[c["name"] for c in extreme],
            impact=0.4,
        )

    negatives = [
        c
        for c in numeric
        if c["semantic_type"] == sem.CURRENCY and c.get("stats", {}).get("negatives", 0) > 0
    ]
    if negatives:
        _add(
            issues,
            severity="low",
            category="validade",
            title="Valores monetários negativos",
            description="Encontramos valores negativos em colunas de valor: "
            + ", ".join(c["name"] for c in negatives[:5]),
            recommendation="Confirme se representam estornos/devoluções. Se sim, separe-os "
            "em uma dimensão própria para não reduzir o faturamento bruto.",
            columns=[c["name"] for c in negatives],
            impact=0.15,
        )
    return max(0.0, score)


def _score_richness(columns: list[dict[str, Any]], issues: list[dict[str, Any]]) -> float:
    metrics = [c for c in columns if c["role"] == sem.METRIC]
    dimensions = [c for c in columns if c["role"] == sem.DIMENSION]
    temporal = [c for c in columns if c["role"] == sem.TEMPORAL]

    score = 40.0
    score += min(30.0, len(metrics) * 10.0)
    score += min(20.0, len(dimensions) * 7.0)
    score += 10.0 if temporal else 0.0

    if not metrics:
        _add(
            issues,
            severity="high",
            category="riqueza",
            title="Nenhuma métrica numérica identificada",
            description="Sem colunas numéricas agregáveis, só é possível analisar "
            "contagens de registros.",
            recommendation="Verifique se colunas de valor foram importadas como texto "
            "(separadores decimais ou símbolos de moeda inconsistentes).",
            impact=1.0,
        )
    if not dimensions:
        _add(
            issues,
            severity="medium",
            category="riqueza",
            title="Nenhuma dimensão categórica identificada",
            description="Não há colunas para segmentar as métricas.",
            recommendation="Inclua atributos como categoria, região, canal ou segmento "
            "para permitir comparações.",
            impact=0.6,
        )
    if not temporal:
        _add(
            issues,
            severity="low",
            category="riqueza",
            title="Nenhuma coluna temporal identificada",
            description="Sem datas não é possível analisar tendências ou sazonalidade.",
            recommendation="Se existir uma coluna de data importada como texto, "
            "verifique o formato (dd/mm/aaaa é suportado).",
            impact=0.3,
        )
    return min(100.0, score)
