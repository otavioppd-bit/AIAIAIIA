"""Safe CSV ingestion: encoding/delimiter sniffing, validation, normalisation.

Nothing from the uploaded file is ever evaluated or executed. Values are read
as text by pandas and then coerced with explicit, bounded parsers.
"""
from __future__ import annotations

import csv
import io
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import chardet
import pandas as pd

from app.core.config import settings
from app.core.errors import UnprocessableDatasetError

_SNIFF_BYTES = 256 * 1024
_CANDIDATE_DELIMITERS = [",", ";", "\t", "|"]
# Leading characters Excel/Sheets treat as formulas. Neutralised on export and
# never interpreted on import, but we strip them so they cannot travel onward.
_FORMULA_PREFIXES = ("=", "+", "-@", "@")


@dataclass
class ReadResult:
    frame: pd.DataFrame
    encoding: str
    delimiter: str
    original_row_count: int
    truncated: bool = False
    warnings: list[str] = field(default_factory=list)


def detect_encoding(raw: bytes) -> str:
    """Best-effort encoding detection with a UTF-8-first bias."""
    head = raw[:_SNIFF_BYTES]
    if head.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    try:
        head.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        pass
    guess = chardet.detect(head)
    encoding = (guess.get("encoding") or "latin-1").lower()
    confidence = guess.get("confidence") or 0.0
    if confidence < 0.5:
        return "latin-1"
    return encoding


def detect_delimiter(text_head: str) -> str:
    """Sniff the delimiter, falling back to a frequency heuristic."""
    try:
        dialect = csv.Sniffer().sniff(text_head, delimiters="".join(_CANDIDATE_DELIMITERS))
        if dialect.delimiter in _CANDIDATE_DELIMITERS:
            return dialect.delimiter
    except csv.Error:
        pass

    lines = [ln for ln in text_head.splitlines() if ln.strip()][:25]
    if not lines:
        return ","
    best, best_score = ",", -1.0
    for delim in _CANDIDATE_DELIMITERS:
        counts = [ln.count(delim) for ln in lines]
        if not counts or max(counts) == 0:
            continue
        # Prefer the delimiter with a high and *consistent* count per line.
        avg = sum(counts) / len(counts)
        variance = sum((c - avg) ** 2 for c in counts) / len(counts)
        score = avg - variance
        if score > best_score:
            best, best_score = delim, score
    return best


def normalise_column_name(name: str, index: int, seen: set[str]) -> str:
    """Produce a stable, safe, human-readable column name."""
    raw = str(name).strip()
    if not raw or raw.lower().startswith("unnamed:"):
        raw = f"coluna_{index + 1}"
    # Strip control characters and collapse whitespace.
    raw = "".join(ch for ch in raw if unicodedata.category(ch)[0] != "C")
    raw = re.sub(r"\s+", " ", raw).strip()
    raw = raw.lstrip("".join(_FORMULA_PREFIXES)) or f"coluna_{index + 1}"
    raw = raw[:120]
    candidate = raw
    suffix = 2
    while candidate.casefold() in seen:
        candidate = f"{raw} ({suffix})"
        suffix += 1
    seen.add(candidate.casefold())
    return candidate


def read_csv_bytes(raw: bytes, *, filename: str = "dataset.csv") -> ReadResult:
    """Parse raw CSV bytes into a DataFrame with validation and guard rails."""
    if not raw:
        raise UnprocessableDatasetError("O arquivo enviado está vazio.")
    if len(raw) > settings.max_upload_bytes:
        raise UnprocessableDatasetError(
            f"Arquivo maior que o limite de {settings.max_upload_bytes // (1024 * 1024)} MB."
        )

    encoding = detect_encoding(raw)
    try:
        head_text = raw[:_SNIFF_BYTES].decode(encoding, errors="replace")
    except LookupError:
        encoding = "latin-1"
        head_text = raw[:_SNIFF_BYTES].decode(encoding, errors="replace")

    delimiter = detect_delimiter(head_text)
    warnings: list[str] = []

    try:
        frame = pd.read_csv(
            io.BytesIO(raw),
            sep=delimiter,
            encoding=encoding,
            encoding_errors="replace",
            dtype=str,
            keep_default_na=True,
            na_values=["", "NA", "N/A", "n/a", "null", "NULL", "None", "-", "--"],
            skip_blank_lines=True,
            on_bad_lines="skip",
            engine="python",
            nrows=settings.max_rows + 1,
        )
    except pd.errors.EmptyDataError as exc:
        raise UnprocessableDatasetError(
            "Não foi possível encontrar dados no arquivo CSV."
        ) from exc
    except pd.errors.ParserError as exc:
        raise UnprocessableDatasetError(
            "O arquivo não pôde ser interpretado como CSV. "
            "Verifique o separador e as aspas."
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise UnprocessableDatasetError(f"Falha ao ler o CSV: {exc}") from exc

    if frame.empty:
        raise UnprocessableDatasetError("O CSV não possui linhas de dados.")
    if frame.shape[1] < 1:
        raise UnprocessableDatasetError("O CSV não possui colunas reconhecíveis.")
    if frame.shape[1] > settings.max_columns:
        raise UnprocessableDatasetError(
            f"O CSV possui {frame.shape[1]} colunas — o limite é {settings.max_columns}."
        )

    original_rows = int(frame.shape[0])
    truncated = original_rows > settings.max_rows
    if truncated:
        frame = frame.iloc[: settings.max_rows]
        warnings.append(
            f"O arquivo foi truncado em {settings.max_rows:,} linhas para análise."
        )

    seen: set[str] = set()
    frame.columns = [
        normalise_column_name(col, idx, seen) for idx, col in enumerate(frame.columns)
    ]

    # Drop columns that are entirely empty — they carry no information.
    empty_cols = [c for c in frame.columns if frame[c].isna().all()]
    if empty_cols:
        frame = frame.drop(columns=empty_cols)
        warnings.append(
            f"{len(empty_cols)} coluna(s) totalmente vazia(s) foram removidas."
        )
    if frame.shape[1] == 0:
        raise UnprocessableDatasetError("Todas as colunas do CSV estão vazias.")

    frame = _strip_text_values(frame)
    return ReadResult(
        frame=frame,
        encoding=encoding,
        delimiter=delimiter,
        original_row_count=original_rows,
        truncated=truncated,
        warnings=warnings,
    )


def _strip_text_values(frame: pd.DataFrame) -> pd.DataFrame:
    """Trim whitespace and neutralise spreadsheet formula prefixes."""
    for col in frame.columns:
        series = frame[col]
        if series.dtype == object:
            stripped = series.str.strip()
            # Only neutralise when the value is clearly a formula, not a
            # negative number such as "-12.5".
            mask = stripped.str.match(r"^[=@+]", na=False)
            if mask.any():
                stripped = stripped.mask(mask, "'" + stripped.where(mask, ""))
            frame[col] = stripped.replace({"": None})
    return frame


def read_csv_file(path: Path) -> ReadResult:
    return read_csv_bytes(path.read_bytes(), filename=path.name)
