"""Semantic typing: turn raw text columns into typed, role-aware columns.

This module answers the questions the dashboard engine depends on:
  * What *is* this column (number, money, date, category, identifier, geo)?
  * Can it be aggregated (a metric) or does it slice data (a dimension)?
"""
from __future__ import annotations

import contextlib
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

# --- Semantic types -------------------------------------------------------
INTEGER = "integer"
FLOAT = "float"
CURRENCY = "currency"
PERCENTAGE = "percentage"
BOOLEAN = "boolean"
DATETIME = "datetime"
CATEGORICAL = "categorical"
TEXT = "text"
IDENTIFIER = "identifier"
GEO = "geo"
EMAIL = "email"
URL = "url"

NUMERIC_TYPES = {INTEGER, FLOAT, CURRENCY, PERCENTAGE}

# --- Roles ----------------------------------------------------------------
METRIC = "metric"
DIMENSION = "dimension"
TEMPORAL = "temporal"
IDENTITY = "identity"
FREE_TEXT = "free_text"

_ACCENTS = str.maketrans("áàâãäéèêëíìîïóòôõöúùûüçñ", "aaaaaeeeeiiiiooooouuuucn")

# Keyword lexicons (pt-BR + en) used to enrich inference and detect domain.
_MONEY_WORDS = {
    "valor", "preco", "preço", "price", "cost", "custo", "receita", "revenue",
    "faturamento", "total", "amount", "salario", "salary", "lucro", "profit",
    "despesa", "expense", "montante", "ticket", "billing", "payment", "pagamento",
    "sales", "vendas", "venda", "gmv", "mrr", "arr", "budget", "orcamento",
}
_PERCENT_WORDS = {
    "percentual", "percent", "pct", "taxa", "rate", "margem", "margin",
    "conversao", "conversion", "share", "participacao", "crescimento", "growth",
}
_ID_WORDS = {
    "id", "codigo", "code", "uuid", "guid", "cpf", "cnpj", "sku", "matricula",
    "registro", "identificador", "identifier", "key", "chave", "pedido_id",
    "order_id", "customer_id", "hash", "serial", "nf", "protocolo",
}
_DATE_WORDS = {
    "data", "date", "dia", "day", "mes", "month", "ano", "year", "periodo",
    "period", "timestamp", "datetime", "created", "criado", "updated",
    "atualizado", "vencimento", "due", "inicio", "start", "fim", "end", "hora",
    "time", "competencia", "emissao",
}
_GEO_WORDS = {
    "pais", "country", "estado", "state", "uf", "cidade", "city", "municipio",
    "regiao", "region", "bairro", "district", "provincia", "province",
    "latitude", "longitude", "lat", "lng", "lon", "cep", "zip", "postal",
    "territorio", "territory", "local", "location",
}
_QUANTITY_WORDS = {
    "quantidade", "qtd", "qty", "quantity", "count", "contagem", "volume",
    "unidades", "units", "estoque", "stock", "pedidos", "orders", "clientes",
    "customers", "usuarios", "users", "visitas", "visits", "cliques", "clicks",
    "sessoes", "sessions", "alunos", "students", "nota", "score", "grade",
    "frequencia", "attendance", "idade", "age", "peso", "weight", "altura",
    "impressao", "impressoes", "impression", "impressions", "alcance", "reach",
    "leads", "propostas", "proposals", "oportunidades", "opportunities",
}

# Measures that must never be summed: rates, unit prices, scores, ratios and
# point-in-time readings. Summing them produces a number with no meaning.
_NON_ADDITIVE_WORDS = {
    "unitario", "unitaria", "unit", "medio", "media", "avg", "average", "mean",
    "taxa", "rate", "percentual", "percent", "pct", "margem", "margin", "ratio",
    "razao", "indice", "index", "score", "nota", "grade", "rating", "avaliacao",
    "idade", "age", "peso", "weight", "altura", "height", "imc", "bmi",
    "temperatura", "temperature", "densidade", "velocidade", "speed",
    "saldo", "balance", "estoque", "stock", "preco", "price", "salario",
    "salary", "cotacao", "latitude", "longitude", "percentil", "mediana",
}

# Measures that are additive even when a non-additive word appears in the name
# (e.g. "valor_total_preco" is still a total).
_ADDITIVE_OVERRIDE_WORDS = {
    "total", "soma", "sum", "faturamento", "receita", "revenue", "gmv",
    "quantidade", "qtd", "qty", "quantity", "count", "contagem", "volume",
    "unidades", "units", "acumulado", "subtotal", "falta", "faltas",
    "absence", "absences", "ocorrencias", "vendidos", "itens", "items",
    "transacoes", "transactions", "pedidos", "orders",
}


def infer_additivity(
    name: str,
    semantic_type: str,
    shape: dict[str, float] | None = None,
) -> bool:
    """Whether summing this column across rows yields a meaningful number.

    The column name is the strongest signal. When it gives none, the shape of
    the distribution decides, because the two failure modes are not symmetric:
    showing the mean of an additive column is merely less useful, while showing
    the sum of a measurement (a temperature, a sensor reading, a score) is
    meaningless. Readings cluster tightly around a non-zero centre; transaction
    amounts are right-skewed and full of small or zero values.
    """
    if semantic_type == PERCENTAGE:
        return False
    if semantic_type not in NUMERIC_TYPES:
        return False
    if _matches(name, _ADDITIVE_OVERRIDE_WORDS):
        return True
    if _matches(name, _NON_ADDITIVE_WORDS):
        return False

    if shape:
        zero_ratio = shape.get("zero_ratio", 0.0)
        skew = shape.get("skew", 0.0)
        cv = shape.get("cv")
        # A tight spread around a non-zero centre is a measurement, whichever
        # way it leans — a bounded score skews *left* and must not be summed.
        # This is checked first for that reason.
        if cv is not None and cv < 0.5:
            return False
        # Zeros and a long *right* tail are what transactional amounts look
        # like; a left tail says nothing of the sort.
        if zero_ratio > 0.1 or skew > 1.5:
            return True

    return True


def default_aggregation(
    name: str, semantic_type: str, shape: dict[str, float] | None = None
) -> str:
    """The aggregation an analyst would reach for by default."""
    return "sum" if infer_additivity(name, semantic_type, shape) else "mean"


def _distribution_shape(values: pd.Series) -> dict[str, float] | None:
    """Cheap descriptors used only to break an additivity tie."""
    clean = pd.to_numeric(values, errors="coerce").dropna()
    if clean.size < 20:
        return None
    mean = float(clean.mean())
    std = float(clean.std(ddof=1)) if clean.size > 1 else 0.0
    shape: dict[str, float] = {
        "zero_ratio": float((clean == 0).mean()),
        "skew": float(clean.skew()) if clean.size > 2 else 0.0,
    }
    if mean != 0:
        shape["cv"] = abs(std / mean)
    return shape


_BOOL_TRUE = {"true", "verdadeiro", "sim", "yes", "y", "s", "1", "t"}
_BOOL_FALSE = {"false", "falso", "nao", "não", "no", "n", "0", "f"}

_BR_STATES = {
    "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms",
    "mg", "pa", "pb", "pr", "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc",
    "sp", "se", "to",
}

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)
_URL_RE = re.compile(r"^https?://", re.I)
_CURRENCY_SYMBOL_RE = re.compile(r"[R$€£¥₹]|BRL|USD|EUR", re.I)
_PERCENT_RE = re.compile(r"%\s*$")


def slugify(name: str) -> str:
    base = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", base.lower()).strip("_")


def humanize(name: str) -> str:
    """Turn a raw column name into a display label: valor_total -> Valor total."""
    text = re.sub(r"[_\-]+", " ", str(name)).strip()
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", text)
    text = re.sub(r"\s+", " ", text)
    if not text:
        return str(name)
    # Keep acronyms as the author wrote them (UF, CPF, SKU, CEP).
    words = [w if (w.isupper() and len(w) <= 4) else w.lower() for w in text.split(" ")]
    words[0] = words[0] if words[0].isupper() else words[0].capitalize()
    return " ".join(words)


def _tokens(name: str) -> set[str]:
    slug = slugify(name)
    parts = {p for p in slug.split("_") if p}
    parts.add(slug)
    return parts


def _matches(name: str, lexicon: set[str]) -> bool:
    toks = _tokens(name)
    if toks & lexicon:
        return True
    slug = slugify(name)
    return any(word in slug for word in lexicon if len(word) > 3)


@dataclass
class ColumnSemantics:
    name: str
    semantic_type: str
    role: str
    pandas_dtype: str
    unique_count: int
    missing_count: int
    missing_ratio: float
    cardinality_ratio: float
    is_aggregatable: bool
    sample_values: list[Any] = field(default_factory=list)
    detail: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# --- Coercion helpers -----------------------------------------------------

def _clean_numeric_strings(series: pd.Series) -> pd.Series:
    """Normalise BR/US number formats: '1.234,56', 'R$ 1,234.56', '(120)'."""
    s = series.astype("string").str.strip()
    s = s.str.replace(_CURRENCY_SYMBOL_RE, "", regex=True)
    s = s.str.replace(r"\s", "", regex=True)
    s = s.str.replace("%", "", regex=False)
    # Accounting negatives: (120) -> -120
    s = s.str.replace(r"^\((.*)\)$", r"-\1", regex=True)

    has_comma = s.str.contains(",", na=False)
    has_dot = s.str.contains(r"\.", na=False)

    both = has_comma & has_dot
    if both.any():
        # Whichever separator appears last is the decimal separator.
        last_comma = s.str.rfind(",").fillna(-1)
        last_dot = s.str.rfind(".").fillna(-1)
        br_style = both & (last_comma > last_dot)
        us_style = both & (last_dot > last_comma)
        br_values = s.str.replace(".", "", regex=False).str.replace(",", ".", regex=False)
        us_values = s.str.replace(",", "", regex=False)
        s = s.mask(br_style, br_values)
        s = s.mask(us_style, us_values)

    only_comma = has_comma & ~has_dot
    if only_comma.any():
        # "1,234" is ambiguous; treat 3-digit groups as thousands separators.
        thousands = only_comma & s.str.match(r"^-?\d{1,3}(,\d{3})+$", na=False)
        s = s.mask(thousands, s.str.replace(",", "", regex=False))
        s = s.mask(only_comma & ~thousands, s.str.replace(",", ".", regex=False))

    only_dot = has_dot & ~has_comma
    if only_dot.any():
        thousands = only_dot & s.str.match(r"^-?\d{1,3}(\.\d{3})+$", na=False)
        s = s.mask(thousands, s.str.replace(".", "", regex=False))

    return s


def try_numeric(series: pd.Series, threshold: float = 0.85) -> pd.Series | None:
    """Return a numeric series if enough non-null values parse cleanly."""
    non_null = series.dropna()
    if non_null.empty:
        return None
    cleaned = _clean_numeric_strings(non_null)
    parsed = pd.to_numeric(cleaned, errors="coerce")
    if parsed.notna().mean() < threshold:
        return None
    full = pd.to_numeric(_clean_numeric_strings(series), errors="coerce")
    return full


def try_datetime(series: pd.Series, threshold: float = 0.85) -> pd.Series | None:
    """Return a datetime series if enough non-null values parse as dates."""
    non_null = series.dropna().astype("string").str.strip()
    if non_null.empty:
        return None
    sample = non_null.head(4000)

    # Reject pure numbers unless they look like yyyymmdd or a 4-digit year.
    if sample.str.match(r"^-?\d+([.,]\d+)?$", na=False).mean() > 0.9:
        as_int = pd.to_numeric(sample, errors="coerce").dropna()
        if as_int.empty:
            return None
        looks_year = as_int.between(1900, 2100).mean() > 0.95 and (as_int % 1 == 0).all()
        looks_yyyymmdd = as_int.between(19000101, 21001231).mean() > 0.95
        if not (looks_year or looks_yyyymmdd):
            return None

    best: pd.Series | None = None
    best_score = threshold
    formats = [None, "%d/%m/%Y", "%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S",
               "%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y", "%d-%m-%Y",
               "%Y/%m/%d", "%Y%m%d", "%Y-%m", "%m/%Y", "%Y"]
    for fmt in formats:
        try:
            if fmt is None:
                parsed = pd.to_datetime(sample, errors="coerce", format="mixed", dayfirst=True)
            else:
                parsed = pd.to_datetime(sample, errors="coerce", format=fmt)
        except (ValueError, TypeError):
            continue
        score = float(parsed.notna().mean())
        if score > best_score:
            best_score, best = score, parsed
            if score > 0.995:
                break
    if best is None:
        return None

    try:
        full = pd.to_datetime(
            series.astype("string").str.strip(), errors="coerce",
            format="mixed", dayfirst=True,
        )
    except (ValueError, TypeError):
        full = pd.to_datetime(series, errors="coerce")
    if full.notna().mean() < threshold * 0.8:
        return None
    return full


def try_boolean(series: pd.Series) -> pd.Series | None:
    non_null = series.dropna().astype("string").str.strip().str.lower()
    if non_null.empty:
        return None
    values = set(non_null.unique())
    if len(values) > 3 or not values:
        return None
    if not values <= (_BOOL_TRUE | _BOOL_FALSE):
        return None
    # "0"/"1" only counts as boolean when the column name suggests a flag.
    lowered = series.astype("string").str.strip().str.lower()
    return lowered.map(
        lambda v: True if v in _BOOL_TRUE else (False if v in _BOOL_FALSE else None)
    ).astype("boolean")


# --- Main inference -------------------------------------------------------

def infer_column(name: str, series: pd.Series, row_count: int) -> tuple[ColumnSemantics, pd.Series]:
    """Infer a column's semantic type and return the coerced series."""
    missing = int(series.isna().sum())
    non_null = series.dropna()
    unique = int(non_null.nunique())
    missing_ratio = missing / row_count if row_count else 0.0
    card_ratio = unique / max(len(non_null), 1)
    detail: dict[str, Any] = {}
    coerced: pd.Series = series
    sem_type = TEXT
    role = FREE_TEXT

    name_is_id = _matches(name, _ID_WORDS)
    name_is_date = _matches(name, _DATE_WORDS)
    name_is_money = _matches(name, _MONEY_WORDS)
    name_is_pct = _matches(name, _PERCENT_WORDS)
    name_is_geo = _matches(name, _GEO_WORDS)
    name_is_qty = _matches(name, _QUANTITY_WORDS)

    str_sample = non_null.astype("string").head(2000)

    if non_null.empty:
        sem = ColumnSemantics(
            name=name, semantic_type=TEXT, role=FREE_TEXT, pandas_dtype="object",
            unique_count=0, missing_count=missing, missing_ratio=1.0,
            cardinality_ratio=0.0, is_aggregatable=False, sample_values=[],
            detail={"empty": True},
        )
        return sem, series

    # 1. Structured text patterns we never want to aggregate.
    if str_sample.str.match(_EMAIL_RE, na=False).mean() > 0.8:
        sem_type, role = EMAIL, IDENTITY
    elif str_sample.str.match(_URL_RE, na=False).mean() > 0.8:
        sem_type, role = URL, IDENTITY
    else:
        # 2. Boolean flags.
        as_bool = try_boolean(series)
        binary_numeric = {str(v).strip() for v in non_null.unique()} <= {"0", "1"}
        # "sim"/"nao" and "true"/"false" are unambiguous. A bare 0/1 column is
        # only a flag when the name says so — otherwise it is a count or a code.
        if as_bool is not None and (not binary_numeric or _looks_like_flag(name)):
            sem_type, role = BOOLEAN, DIMENSION
            coerced = as_bool
            detail["true_ratio"] = (
                float(as_bool.dropna().mean()) if as_bool.notna().any() else 0.0
            )

        if sem_type == TEXT:
            # 3. Dates.
            as_date = try_datetime(series) if (name_is_date or _looks_like_date(str_sample)) else None
            if as_date is not None and as_date.notna().sum() > 0:
                sem_type, role = DATETIME, TEMPORAL
                coerced = as_date
                valid = as_date.dropna()
                detail.update(
                    min=valid.min().isoformat() if len(valid) else None,
                    max=valid.max().isoformat() if len(valid) else None,
                    span_days=int((valid.max() - valid.min()).days) if len(valid) > 1 else 0,
                    suggested_grain=_suggest_grain(valid),
                )
            else:
                # 4. Numbers.
                as_num = try_numeric(series)
                if as_num is not None:
                    coerced = as_num
                    valid = as_num.dropna()
                    is_int = bool(len(valid)) and float(np.nanmax(np.abs(valid % 1))) < 1e-9
                    has_money = bool(str_sample.str.contains(_CURRENCY_SYMBOL_RE, na=False).mean() > 0.3)
                    has_pct = bool(str_sample.str.contains(_PERCENT_RE, na=False).mean() > 0.5)

                    if has_pct or (name_is_pct and valid.between(-1000, 1000).all()):
                        sem_type = PERCENTAGE
                    elif has_money or name_is_money:
                        sem_type = CURRENCY
                    elif is_int:
                        sem_type = INTEGER
                    else:
                        sem_type = FLOAT

                    # An integer column that is really a key is a dimension.
                    looks_like_key = (
                        is_int
                        and card_ratio > 0.92
                        and unique > 20
                        and (name_is_id or not (name_is_qty or name_is_money or name_is_pct))
                    )
                    names_a_measure = name_is_qty or name_is_money or name_is_pct
                    if looks_like_key and sem_type in {INTEGER}:
                        sem_type, role = IDENTIFIER, IDENTITY
                    elif (
                        is_int
                        and 1 < unique <= 12
                        and not names_a_measure
                        and card_ratio < 0.05
                    ):
                        # Low-cardinality integer codes behave like categories
                        # (a 1-5 rating, a status code). A column whose name
                        # says "valor", "receita" or "quantidade" is a measure
                        # no matter how few distinct values it happens to have.
                        role = DIMENSION
                        detail["discrete_codes"] = True
                    else:
                        role = METRIC
                else:
                    # 5. Text: category vs identifier vs free text.
                    avg_len = float(str_sample.str.len().mean())
                    if name_is_id and card_ratio > 0.9 or card_ratio > 0.95 and unique > 50 and avg_len > 12:
                        sem_type, role = IDENTIFIER, IDENTITY
                    elif avg_len > 80:
                        sem_type, role = TEXT, FREE_TEXT
                    else:
                        sem_type, role = CATEGORICAL, DIMENSION

    # 6. Geography overlay — a category that names places is still a dimension,
    #    but the chart engine can offer a map for it.
    if sem_type in {CATEGORICAL, TEXT, IDENTIFIER} and (name_is_geo or _looks_geographic(str_sample)):
        if unique <= 500:
            sem_type, role = GEO, DIMENSION
            detail["geo_kind"] = _geo_kind(name, str_sample)

    if sem_type in {FLOAT, CURRENCY} and (name_is_geo and slugify(name) in {"latitude", "longitude", "lat", "lng", "lon"}):
        sem_type, role = FLOAT, IDENTITY
        detail["geo_kind"] = "coordinate"
        detail["coordinate_axis"] = "lat" if slugify(name) in {"latitude", "lat"} else "lon"

    if sem_type == CATEGORICAL:
        counts = non_null.astype("string").value_counts().head(12)
        detail["top_values"] = [
            {"value": str(k), "count": int(v), "ratio": float(v / len(non_null))}
            for k, v in counts.items()
        ]

    aggregatable = role == METRIC and sem_type in NUMERIC_TYPES
    if aggregatable:
        shape = _distribution_shape(coerced)
        detail["additive"] = infer_additivity(name, sem_type, shape)
        detail["default_agg"] = default_aggregation(name, sem_type, shape)
        if shape:
            detail["distribution_shape"] = {k: round(v, 4) for k, v in shape.items()}

    # Keep integer-typed columns on an integer dtype so category labels render
    # as "3" rather than "3.0".
    if sem_type == INTEGER and coerced is not None:
        with contextlib.suppress(TypeError, ValueError):
            coerced = coerced.astype("Int64")

    sem = ColumnSemantics(
        name=name,
        semantic_type=sem_type,
        role=role,
        pandas_dtype=str(coerced.dtype),
        unique_count=unique,
        missing_count=missing,
        missing_ratio=round(missing_ratio, 6),
        cardinality_ratio=round(card_ratio, 6),
        is_aggregatable=aggregatable,
        sample_values=[_jsonable(v) for v in non_null.head(5).tolist()],
        detail=detail,
    )
    return sem, coerced


def _looks_like_flag(name: str) -> bool:
    slug = slugify(name)
    return slug.startswith(("is_", "has_", "flag_", "eh_", "ativo", "active")) or slug.endswith(
        ("_flag", "_ativo", "_active", "_bool")
    )


def _looks_like_date(sample: pd.Series) -> bool:
    pattern = r"^\s*\d{1,4}[-/.]\d{1,2}([-/.]\d{1,4})?([ T]\d{1,2}:\d{2})?\s*$"
    return bool(sample.str.match(pattern, na=False).mean() > 0.7)


def _looks_geographic(sample: pd.Series) -> bool:
    lowered = sample.astype("string").str.strip().str.lower()
    if lowered.empty:
        return False
    return bool(lowered.isin(_BR_STATES).mean() > 0.7)


def _geo_kind(name: str, sample: pd.Series) -> str:
    slug = slugify(name)
    if any(w in slug for w in ("pais", "country")):
        return "country"
    if any(w in slug for w in ("uf", "estado", "state", "provincia", "province")):
        return "state"
    if any(w in slug for w in ("cidade", "city", "municipio")):
        return "city"
    if any(w in slug for w in ("regiao", "region", "territorio", "territory")):
        return "region"
    lowered = sample.astype("string").str.strip().str.lower()
    if not lowered.empty and lowered.isin(_BR_STATES).mean() > 0.7:
        return "state"
    return "place"


def _suggest_grain(valid: pd.Series) -> str:
    if len(valid) < 2:
        return "day"
    span_days = (valid.max() - valid.min()).days
    if span_days <= 2:
        return "hour"
    if span_days <= 92:
        return "day"
    if span_days <= 400:
        return "week" if valid.nunique() > 60 else "month"
    if span_days <= 365 * 4:
        return "month"
    return "quarter" if span_days <= 365 * 12 else "year"


def _jsonable(value: Any) -> Any:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    return str(value)


def analyse_schema(frame: pd.DataFrame) -> tuple[pd.DataFrame, list[ColumnSemantics]]:
    """Coerce every column and return the typed frame plus its semantics."""
    row_count = int(len(frame))
    typed: dict[str, pd.Series] = {}
    semantics: list[ColumnSemantics] = []
    for col in frame.columns:
        sem, coerced = infer_column(col, frame[col], row_count)
        semantics.append(sem)
        typed[col] = coerced
    typed_frame = pd.DataFrame(typed, index=frame.index)
    return typed_frame, semantics
