"""CSV ingestion and type inference."""
from __future__ import annotations

import pytest

from app.core.errors import UnprocessableDatasetError
from app.services import semantics as sem
from app.services.ingestion import detect_delimiter, detect_encoding, read_csv_bytes


def test_detects_semicolon_delimiter():
    raw = "nome;valor;data\nAna;10,50;01/03/2025\nJoão;20,75;02/03/2025\n".encode()
    result = read_csv_bytes(raw)
    assert result.delimiter == ";"
    assert list(result.frame.columns) == ["nome", "valor", "data"]
    assert len(result.frame) == 2


def test_detects_latin1_encoding():
    raw = "nome,cidade\nJosé,São Paulo\nJoão,Brasília\n".encode("latin-1")
    result = read_csv_bytes(raw)
    assert "José" in result.frame["nome"].tolist()


def test_brazilian_currency_parses_to_number():
    raw = b"produto,valor\nA,\"R$ 1.234,56\"\nB,\"R$ 890,00\"\n"
    frame = read_csv_bytes(raw).frame
    typed, semantics = sem.analyse_schema(frame)
    valor = next(s for s in semantics if s.name == "valor")
    assert valor.semantic_type == sem.CURRENCY
    assert typed["valor"].sum() == pytest.approx(2124.56)


def test_us_format_numbers_parse():
    raw = b"produto,valor\nA,\"1,234.56\"\nB,\"890.00\"\n"
    typed, _ = sem.analyse_schema(read_csv_bytes(raw).frame)
    assert typed["valor"].sum() == pytest.approx(2124.56)


def test_rejects_empty_file():
    with pytest.raises(UnprocessableDatasetError):
        read_csv_bytes(b"")


def test_rejects_file_without_rows():
    with pytest.raises(UnprocessableDatasetError):
        read_csv_bytes(b"coluna_a,coluna_b\n")


def test_duplicate_column_names_are_disambiguated():
    raw = b"nome,nome,valor\nA,B,1\nC,D,2\n"
    frame = read_csv_bytes(raw).frame
    assert len(set(frame.columns)) == 3


def test_formula_injection_is_neutralised():
    raw = b'"nome","nota"\n"=SUM(A1:A9)","10"\n"@cmd","9"\n'
    frame = read_csv_bytes(raw).frame
    assert not frame["nome"].iloc[0].startswith("=")
    assert not frame["nome"].iloc[1].startswith("@")


def test_empty_columns_are_dropped():
    raw = b"a,b,c\n1,,3\n4,,6\n"
    result = read_csv_bytes(raw)
    assert "b" not in result.frame.columns
    assert result.warnings


@pytest.mark.parametrize(
    "text,expected",
    [("a,b,c\n1,2,3", ","), ("a;b;c\n1;2;3", ";"), ("a\tb\tc\n1\t2\t3", "\t"), ("a|b\n1|2", "|")],
)
def test_delimiter_sniffing(text, expected):
    assert detect_delimiter(text) == expected


def test_encoding_detection_prefers_utf8():
    assert detect_encoding("olá".encode()) == "utf-8"
