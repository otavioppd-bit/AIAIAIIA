"""Rule-based natural-language question parsing (pt-BR and en).

This is the deterministic fallback that keeps the AI Data Analyst functional
with no model configured — and the sanity check that catches an LLM plan
referencing columns the dataset does not have.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any

from app.ai.schemas import AnalystPlan, PlannedFilter, PlannedMetric
from app.services import domain as domain_mod
from app.services import semantics as sem

# --- Vocabulary -----------------------------------------------------------
_SUPERLATIVE_MAX = {
    "maior", "maiores", "mais", "melhor", "melhores", "top", "máximo", "maximo",
    "highest", "best", "most", "largest", "max",
}
_SUPERLATIVE_MIN = {
    "menor", "menores", "menos", "pior", "piores", "mínimo", "minimo",
    "lowest", "worst", "least", "smallest", "min", "bottom",
}
_AVG_WORDS = {"media", "médio", "medio", "average", "avg", "mean", "típico", "tipico"}
_SUM_WORDS = {"total", "soma", "somatorio", "sum", "acumulado", "faturamento", "receita"}
_COUNT_WORDS = {"quantos", "quantas", "contagem", "count", "numero", "número", "quantidade de"}
_MEDIAN_WORDS = {"mediana", "median"}

_TREND_WORDS = {
    "tendencia", "tendência", "evolucao", "evolução", "ao_longo", "longo_do_tempo",
    "crescimento", "crescendo", "caindo", "queda", "trend", "evolution", "over_time",
    "historico", "histórico", "serie", "série", "timeline",
}
_CORRELATION_WORDS = {
    "correlacao", "correlação", "correlation", "relacao", "relação", "relationship",
    "influencia", "influência", "impacta", "depende", "associacao", "associação",
}
_OUTLIER_WORDS = {
    "outlier", "outliers", "atipico", "atípico", "atipicos", "atípicos", "anomalia",
    "anomalias", "fora_do_padrao", "fora", "padrao", "padrão", "estranho", "anomaly",
    "unusual", "abnormal", "discrepante",
}
_QUALITY_WORDS = {
    "qualidade", "quality", "problema", "problemas", "erro", "erros", "ausente",
    "ausentes", "faltando", "missing", "duplicado", "duplicados", "duplicate",
    "inconsistencia", "inconsistência", "limpeza", "sujo",
}
_OVERVIEW_WORDS = {
    "resumo", "resuma", "overview", "summary", "panorama", "geral", "chama_atencao",
    "chama", "atencao", "atenção", "destaque", "destaques", "principais", "acompanhar",
    "monitorar", "kpi", "kpis", "metricas", "métricas",
}
_DISTRIBUTION_WORDS = {
    "distribuicao", "distribuição", "distribution", "histograma", "histogram",
    "dispersao", "dispersão", "espalhado", "frequencia", "frequência",
}
_COMPARE_WORDS = {"compare", "comparar", "comparacao", "comparação", "versus", "vs", "entre"}

_TIME_GRAIN_WORDS = {
    "hora": "hour", "horas": "hour", "hourly": "hour",
    "dia": "day", "dias": "day", "diario": "day", "diário": "day", "daily": "day",
    "semana": "week", "semanas": "week", "semanal": "week", "weekly": "week",
    "mes": "month", "mês": "month", "meses": "month", "mensal": "month", "monthly": "month",
    "trimestre": "quarter", "trimestral": "quarter", "quarter": "quarter", "quarterly": "quarter",
    "ano": "year", "anos": "year", "anual": "year", "year": "year", "yearly": "year",
}

# Business vocabulary rarely matches column names literally. Each key expands
# into extra tokens that are matched against column names.
_SYNONYMS: dict[str, tuple[str, ...]] = {
    "estado": ("uf", "state", "provincia"),
    "estados": ("uf", "state"),
    "state": ("uf", "estado"),
    "regiao": ("uf", "estado", "region", "territorio"),
    "local": ("cidade", "uf", "estado", "regiao", "city"),
    "localidade": ("cidade", "uf", "estado", "regiao"),
    "faturamento": ("valor", "total", "receita", "revenue", "venda", "vendas", "preco"),
    "receita": ("valor", "total", "faturamento", "revenue", "venda"),
    "vendas": ("valor", "total", "faturamento", "venda", "receita", "quantidade"),
    "venda": ("valor", "total", "faturamento", "receita"),
    "revenue": ("valor", "total", "faturamento", "receita"),
    "ticket": ("valor", "total", "preco", "faturamento"),
    "preco": ("preco", "valor", "price", "unitario"),
    "price": ("preco", "valor", "unitario"),
    "custo": ("custo", "cost", "despesa", "valor"),
    "lucro": ("lucro", "profit", "margem", "resultado"),
    "desempenho": ("valor", "total", "nota", "score", "resultado", "faturamento"),
    "performance": ("valor", "total", "nota", "score", "resultado"),
    "cliente": ("cliente", "customer", "comprador"),
    "clientes": ("cliente", "customer"),
    "produto": ("produto", "product", "item", "sku"),
    "produtos": ("produto", "product", "item", "sku"),
    "categoria": ("categoria", "category", "tipo", "segmento"),
    "canal": ("canal", "channel", "origem", "fonte"),
    "periodo": ("data", "date", "mes", "ano", "periodo"),
    "tempo": ("data", "date", "periodo", "timestamp"),
    "data": ("data", "date", "periodo", "dia"),
    "aluno": ("aluno", "student", "matricula"),
    "nota": ("nota", "grade", "score", "avaliacao", "media"),
    "funcionario": ("funcionario", "employee", "colaborador"),
    "salario": ("salario", "salary", "remuneracao"),
}


def _expand(tokens: set[str]) -> set[str]:
    expanded = set(tokens)
    for token in tokens:
        expanded.update(_SYNONYMS.get(token, ()))
    return expanded


_BY_MARKERS = (" por ", " per ", " by ", " agrupado por ", " segmentado por ")
_STOPWORDS = {
    "qual", "quais", "quanto", "quantos", "quantas", "como", "onde", "quem",
    "o", "a", "os", "as", "de", "do", "da", "dos", "das", "em", "no", "na",
    "nos", "nas", "um", "uma", "e", "ou", "para", "com", "que", "foi", "foram",
    "esta", "está", "ser", "tem", "the", "of", "in", "is", "are", "what",
    "which", "how", "show", "me", "mostre", "mostrar", "exiba", "liste",
    "quero", "gostaria", "por", "favor", "meu", "meus", "minha", "sobre",
}


# Words that carry no subject of their own: they shape the question rather than
# name anything in the data. What survives their removal is what the user is
# actually asking *about*.
_FUNCTIONAL_WORDS = {
    "temos", "tenho", "tem", "houve", "teve", "existe", "existem", "ha",
    "dados", "dado", "registro", "registros", "valores", "valor", "coluna",
    "colunas", "linha", "linhas", "tabela", "conjunto", "base", "arquivo",
    "csv", "grafico", "gráfico", "analise", "análise", "me", "diga", "fale",
    "sobre", "acima", "abaixo", "cada", "todos", "todas", "geral", "melhor",
    "pior", "maior", "menor", "ultimo", "último", "primeiro", "anos", "ano",
    "mes", "mês", "meses", "dia", "dias", "semana", "semanas", "periodo",
    "período", "trimestre", "trimestres", "data", "datas", "tempo",
    "longo", "ao", "durante", "atraves", "através",
}


def _subject_words(question: str) -> set[str]:
    """The words in a question that name something, stripped of the vocabulary
    that only describes how to slice or aggregate it."""
    words = _word_set(question) - _STOPWORDS - _FUNCTIONAL_WORDS
    for lexicon in (
        _SUPERLATIVE_MAX, _SUPERLATIVE_MIN, _AVG_WORDS, _SUM_WORDS, _COUNT_WORDS,
        _MEDIAN_WORDS, _TREND_WORDS, _CORRELATION_WORDS, _OUTLIER_WORDS,
        _QUALITY_WORDS, _OVERVIEW_WORDS, _DISTRIBUTION_WORDS, _COMPARE_WORDS,
        _TIME_GRAIN_WORDS,
    ):
        # Some lexicons map a word to a meaning rather than being a bare set.
        words -= set(lexicon)
    # Single letters and bare numbers name nothing.
    return {w for w in words if len(w) > 2 and not w.isdigit()}


def _normalize(text: str) -> str:
    lowered = str(text).lower().strip()
    stripped = unicodedata.normalize("NFKD", lowered).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", stripped)


def _word_set(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9_]+", _normalize(text)))


@dataclass
class ColumnMatch:
    name: str
    score: float


class ColumnMatcher:
    """Fuzzy-matches free text against real column names and their values."""

    def __init__(self, column_semantics: list[dict[str, Any]]):
        self.columns = column_semantics
        self._index: list[tuple[str, set[str], str]] = []
        for col in column_semantics:
            name = col["name"]
            tokens = _word_set(sem.slugify(name).replace("_", " "))
            self._index.append((name, tokens, col["role"]))
        # Category values let "vendas por estado" match a column named "uf"
        # whose values are UF codes.
        self._value_index: dict[str, list[str]] = {}
        for col in column_semantics:
            for entry in (col.get("detail") or {}).get("top_values", []) or []:
                key = _normalize(str(entry.get("value", "")))
                if key and len(key) > 1:
                    self._value_index.setdefault(key, []).append(col["name"])

    def find(self, text: str, *, roles: set[str] | None = None, limit: int = 3) -> list[ColumnMatch]:
        literal_tokens = _word_set(text) - _STOPWORDS
        if not literal_tokens:
            return []
        query_tokens = _expand(literal_tokens)
        matches: list[ColumnMatch] = []
        normalized_query = _normalize(text)

        for name, tokens, role in self._index:
            if roles and role not in roles:
                continue
            overlap = tokens & query_tokens
            score = 0.0
            if overlap:
                score += len(overlap) / max(len(tokens), 1) * 2.0
            slug_words = sem.slugify(name).replace("_", " ")
            if slug_words and slug_words in normalized_query:
                score += 2.5
            # Substring credit: "faturamento" inside "valor_faturamento".
            for token in query_tokens:
                if len(token) >= 4:
                    weight = 1.0 if token in literal_tokens else 0.6
                    if token in slug_words:
                        score += 0.9 * weight
                    elif any(token in t or t in token for t in tokens if len(t) >= 4):
                        score += 0.5 * weight
            if score > 0:
                matches.append(ColumnMatch(name=name, score=score))

        matches.sort(key=lambda m: m.score, reverse=True)
        return matches[:limit]

    def find_by_value(self, text: str) -> list[tuple[str, str]]:
        """Return (column, value) pairs whose category values appear in the text."""
        normalized = _normalize(text)
        hits: list[tuple[str, str]] = []
        for value, columns in self._value_index.items():
            if len(value) < 3:
                continue
            if re.search(rf"\b{re.escape(value)}\b", normalized):
                for column in columns:
                    hits.append((column, value))
        return hits[:4]


def _detect_agg(text: str, default: str = "sum") -> str:
    words = _word_set(text)
    normalized = _normalize(text)
    if words & _MEDIAN_WORDS:
        return "median"
    if words & _AVG_WORDS or "media de" in normalized:
        return "mean"
    if words & _COUNT_WORDS or normalized.startswith(("quantos", "quantas", "how many")):
        return "count"
    if words & _SUM_WORDS:
        return "sum"
    return default


def _detect_time_grain(text: str) -> str | None:
    for word in _word_set(text):
        if word in _TIME_GRAIN_WORDS:
            return _TIME_GRAIN_WORDS[word]
    return None


def _extract_years(text: str) -> list[int]:
    years = [int(y) for y in re.findall(r"\b(19\d{2}|20\d{2})\b", text)]
    return sorted(set(years))


def _dimension_hint(question: str) -> str:
    """Text that follows a 'por/by' marker names the intended dimension."""
    normalized = _normalize(question)
    for marker in _BY_MARKERS:
        idx = normalized.find(marker.strip().join((" ", " ")))
        if idx == -1:
            idx = normalized.find(marker)
        if idx != -1:
            return normalized[idx + len(marker) :]
    return ""


def parse_question(
    question: str,
    column_semantics: list[dict[str, Any]],
    analysis: dict[str, Any],
) -> AnalystPlan:
    """Translate a question into a query plan using explicit rules."""
    matcher = ColumnMatcher(column_semantics)
    words = _word_set(question)
    normalized = _normalize(question)

    metrics_available = analysis.get("columns", {}).get("metrics", []) or []
    dimensions_available = analysis.get("columns", {}).get("dimensions", []) or []
    temporal_available = analysis.get("columns", {}).get("temporal", []) or []
    by_name = {c["name"]: c for c in column_semantics}

    def default_agg_for(column: str | None) -> str:
        if not column or column not in by_name:
            return "sum"
        return (by_name[column].get("detail") or {}).get("default_agg", "sum")

    # --- Non-aggregation intents come first ------------------------------
    if words & _QUALITY_WORDS:
        return AnalystPlan(
            intent="quality", limit=1, chart_type="none",
            reasoning="A pergunta trata da qualidade do conjunto de dados.",
        )
    if words & _OUTLIER_WORDS and not (words & _SUPERLATIVE_MAX):
        return AnalystPlan(
            intent="outliers", limit=1, chart_type="none",
            reasoning="A pergunta busca valores fora do padrão.",
        )
    if words & _CORRELATION_WORDS:
        candidates = matcher.find(question, roles={sem.METRIC}, limit=2)
        plan = AnalystPlan(
            intent="correlation", limit=1, chart_type="scatter",
            reasoning="A pergunta investiga a relação entre variáveis numéricas.",
        )
        if len(candidates) == 2:
            plan.metrics = [
                PlannedMetric(column=candidates[0].name, agg="mean"),
                PlannedMetric(column=candidates[1].name, agg="mean"),
            ]
        return plan
    # "O que mais chama atenção?" contains a superlative but is still a request
    # for an overview, so explicit overview phrases are checked first.
    explicit_overview = any(
        phrase in normalized
        for phrase in (
            "chama atencao", "chama a atencao", "stands out", "resumo",
            "resuma", "panorama", "visao geral", "overview", "me conte",
            "o que devo", "devo acompanhar", "devo monitorar", "principais achados",
            "quais metricas", "que metricas", "destaques",
        )
    )
    if explicit_overview or (words & _OVERVIEW_WORDS and not (words & _SUPERLATIVE_MAX) and len(words) < 12):
        return AnalystPlan(
            intent="overview", limit=1, chart_type="none",
            reasoning="A pergunta pede um panorama geral do conjunto de dados.",
        )

    # --- Is the question even about this dataset? -------------------------
    #
    # Falling back to the headline metric is right when the question names no
    # subject at all ("qual o total?"). It is a lie when the question names a
    # subject the data does not have: asking for profit margin and receiving
    # revenue, labelled revenue, still answers a question nobody asked. So a
    # question whose every subject word is unknown is refused instead.
    #
    # A question that carries a clear analytical intent — "how did it evolve",
    # "compare these", "what is the distribution" — is asking about the usual
    # measure by construction, so it does not have to name a column. Only a
    # question with no intent *and* no recognisable subject is refused.
    has_intent_signal = bool(
        words & _TREND_WORDS or words & _COMPARE_WORDS or words & _DISTRIBUTION_WORDS
    )
    subjects = _subject_words(question)
    if subjects and not has_intent_signal:
        # Matched against the subjects alone: the full question still contains
        # words like "valor" that name an aggregation here and a column
        # elsewhere, and anchoring on those would accept any question at all.
        subject_text = " ".join(sorted(subjects))
        anchored = bool(matcher.find(subject_text, limit=1)) or bool(
            matcher.find_by_value(subject_text)
        )
        if not anchored:
            plan = AnalystPlan(
                intent="unsupported", limit=1, chart_type="none",
                reasoning=(
                    "Nenhum termo da pergunta corresponde a uma coluna ou a um valor "
                    "deste conjunto de dados."
                ),
            )
            plan.unmatched_terms = sorted(subjects)
            return plan

    # --- Metric selection -------------------------------------------------
    metric_matches = matcher.find(question, roles={sem.METRIC}, limit=1)
    metric_column: str | None = metric_matches[0].name if metric_matches else None
    if metric_column is None and metrics_available:
        # Fall back to the domain's headline metric (revenue for sales, grade
        # for education) rather than whichever column happens to come first.
        ranked = domain_mod.rank_metric_columns(
            (analysis.get("domain") or {}).get("key", "generic"), metrics_available
        )
        metric_column = ranked[0] if ranked else metrics_available[0]

    agg = _detect_agg(question, default=default_agg_for(metric_column))
    if agg == "count":
        metric_column = None

    # --- Dimension selection ---------------------------------------------
    hint = _dimension_hint(question)
    dimension_column: str | None = None
    if hint:
        dim_matches = matcher.find(hint, roles={sem.DIMENSION, sem.TEMPORAL}, limit=1)
        if dim_matches:
            dimension_column = dim_matches[0].name
    if dimension_column is None:
        dim_matches = [
            m for m in matcher.find(question, roles={sem.DIMENSION, sem.TEMPORAL}, limit=3)
            if m.name != metric_column
        ]
        if dim_matches:
            dimension_column = dim_matches[0].name

    # --- Time handling ----------------------------------------------------
    grain = _detect_time_grain(hint or question)
    years = _extract_years(question)
    wants_trend = bool(words & _TREND_WORDS) or grain is not None
    wants_compare = bool(words & _COMPARE_WORDS) or len(years) >= 2

    filters: list[PlannedFilter] = []
    # Category values named in the question become filters, not dimensions.
    for column, value in matcher.find_by_value(question):
        if column != dimension_column:
            filters.append(PlannedFilter(column=column, op="eq", value=value))

    if years and temporal_available:
        date_column = temporal_available[0]
        if len(years) >= 2:
            dimension_column = date_column
            grain = grain or "year"
            filters.append(
                PlannedFilter(
                    column=date_column, op="between",
                    value=[f"{min(years)}-01-01", f"{max(years)}-12-31"],
                )
            )
        else:
            filters.append(
                PlannedFilter(
                    column=date_column, op="between",
                    value=[f"{years[0]}-01-01", f"{years[0]}-12-31"],
                )
            )

    if (wants_trend or wants_compare) and temporal_available:
        if dimension_column is None or dimension_column not in temporal_available:
            if not (dimension_column and dimension_column in dimensions_available and not wants_trend):
                dimension_column = temporal_available[0]
        if grain is None:
            trends = analysis.get("trends") or []
            grain = trends[0]["grain"] if trends else "month"

    is_temporal_dimension = bool(dimension_column and dimension_column in temporal_available)
    if is_temporal_dimension and grain is None:
        grain = "month"

    # --- Superlatives: "which month had the highest revenue?" -------------
    limit = 20
    sort_desc = True
    if words & _SUPERLATIVE_MIN:
        sort_desc = False
    superlative = bool((words & _SUPERLATIVE_MAX) or (words & _SUPERLATIVE_MIN))
    singular = bool(re.search(r"\b(qual|which|what)\b", normalized)) and not re.search(
        r"\b(quais|which ones|top\s*\d+)\b", normalized
    )
    top_n = re.search(r"\btop\s*(\d{1,3})\b", normalized)
    if top_n:
        limit = max(1, min(int(top_n.group(1)), 100))
    elif superlative and singular and not is_temporal_dimension:
        limit = 1
    elif superlative and singular and is_temporal_dimension:
        limit = 1
        sort_desc = sort_desc  # ranking over periods still sorts by value

    # --- Intent + chart ---------------------------------------------------
    if is_temporal_dimension and not superlative:
        intent = "compare" if wants_compare else "trend"
        chart = "line"
        sort_desc = False
        limit = 500
    elif words & _DISTRIBUTION_WORDS and metric_column:
        return AnalystPlan(
            intent="distribution",
            metrics=[PlannedMetric(column=metric_column, agg="count")],
            chart_type="histogram", limit=1,
            reasoning=f"A pergunta pede a distribuição de “{metric_column}”, "
            "respondida com o histograma já calculado no perfilamento.",
        )
    else:
        intent = "aggregate"
        chart = "bar_horizontal" if not is_temporal_dimension else "bar"

    if dimension_column is None:
        # No dimension at all: a single aggregate value answers the question.
        return AnalystPlan(
            intent="aggregate",
            metrics=[PlannedMetric(column=metric_column, agg=agg)],
            filters=filters, chart_type="kpi", limit=1,
            reasoning="A pergunta pede um valor agregado único.",
        )

    metric_label = metric_column or "registros"
    # "Which month had the highest revenue?" ranks periods by value; a plain
    # "revenue over time" keeps chronological order.
    rank_over_time = is_temporal_dimension and superlative
    if rank_over_time:
        intent = "aggregate"
        chart = "bar"

    return AnalystPlan(
        intent=intent,
        group_by=[dimension_column],
        metrics=[PlannedMetric(column=metric_column, agg=agg)],
        filters=filters,
        time_grain=grain if is_temporal_dimension else None,
        sort_desc=sort_desc,
        limit=limit,
        chart_type=chart,
        chart_title=f"{sem.humanize(metric_label)} por {sem.humanize(dimension_column).lower()}",
        reasoning=(
            f"Agrupamento por “{dimension_column}” com agregação {agg} de "
            f"“{metric_label}”, derivado das palavras-chave da pergunta."
        ),
    )
