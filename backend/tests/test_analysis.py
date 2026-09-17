"""Analytical correctness — the guarantees the product depends on."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.services import semantics as sem
from app.services import statistics as stats
from app.services.analyzer import analyse_csv_bytes


def _csv(frame: pd.DataFrame) -> bytes:
    return frame.to_csv(index=False).encode("utf-8")


def test_partial_final_period_is_excluded_from_trends():
    """A half-finished month must not be reported as a collapse."""
    # Two full years of flat daily sales, then 5 days of the next month.
    dates = pd.date_range("2024-01-01", "2025-12-31", freq="D").tolist()
    dates += pd.date_range("2026-01-01", "2026-01-05", freq="D").tolist()
    frame = pd.DataFrame({"data": dates, "valor_total": [100.0] * len(dates)})

    series, notes = stats.resample_series(frame, "data", "valor_total", "month", "sum")
    assert notes, "o período parcial deveria ter sido sinalizado"
    assert series.index[-1].strftime("%Y-%m") == "2025-12"

    trend = stats.analyse_trend(frame, "data", "valor_total", grain="month")
    assert trend is not None
    # Flat data must read as flat, not as a 95% crash.
    assert trend.direction == "flat"
    assert abs(trend.change_pct) < 5


def test_non_additive_columns_use_mean_not_sum():
    assert sem.default_aggregation("preco_unitario", sem.CURRENCY) == "mean"
    assert sem.default_aggregation("taxa_conversao", sem.PERCENTAGE) == "mean"
    assert sem.default_aggregation("nota_final", sem.FLOAT) == "mean"
    assert sem.default_aggregation("valor_total", sem.CURRENCY) == "sum"
    assert sem.default_aggregation("quantidade", sem.INTEGER) == "sum"


def test_additivity_falls_back_to_distribution_shape():
    """A column whose name says nothing is judged by how its values behave."""
    rng = np.random.default_rng(1)
    frame = pd.DataFrame(
        {
            # Readings: tight around a non-zero centre, symmetric.
            "sensor_a": rng.normal(50, 9, 600),
            "leitura_xyz": rng.normal(23, 2.5, 600),
            # Amounts: right-skewed, or full of zeros.
            "campo_opaco": np.abs(rng.lognormal(7, 1.1, 600)),
            "outro_campo": np.where(rng.random(600) < 0.3, 0, np.abs(rng.lognormal(3, 1, 600))),
        }
    )
    _, semantics = sem.analyse_schema(frame)
    by_name = {c.name: c for c in semantics}

    assert by_name["sensor_a"].detail["default_agg"] == "mean"
    assert by_name["leitura_xyz"].detail["default_agg"] == "mean"
    assert by_name["campo_opaco"].detail["default_agg"] == "sum"
    assert by_name["outro_campo"].detail["default_agg"] == "sum"


def test_left_skewed_measurements_are_not_summed():
    """A bounded score leans left; that is still a measurement, not an amount."""
    rng = np.random.default_rng(7)
    # Scores bunched against a ceiling with a thin lower tail: strongly
    # left-skewed, and still a measurement.
    scores = np.clip(100 - rng.gamma(shape=1.4, scale=3.0, size=800), 0, 100)
    frame = pd.DataFrame({"indicador_x": scores})
    _, semantics = sem.analyse_schema(frame)
    column = semantics[0]
    assert column.detail["distribution_shape"]["skew"] < -1
    assert column.detail["default_agg"] == "mean"


def test_named_measures_beat_the_distribution_heuristic():
    """An explicit name always wins: shape only breaks a tie."""
    rng = np.random.default_rng(2)
    frame = pd.DataFrame(
        {
            # Looks like a reading, but the name says it is a total.
            "valor_total": rng.normal(500, 40, 400),
            # Looks like an amount, but the name says it is a rate.
            "taxa_x": np.abs(rng.lognormal(1, 1.2, 400)),
        }
    )
    _, semantics = sem.analyse_schema(frame)
    by_name = {c.name: c for c in semantics}
    assert by_name["valor_total"].detail["default_agg"] == "sum"
    assert by_name["taxa_x"].detail["default_agg"] == "mean"


def test_correlation_survives_extreme_outliers():
    """Pearson collapses under a few extreme values; Spearman must catch it."""
    rng = np.random.default_rng(3)
    x = rng.uniform(1, 100, 500)
    y = x * 2 + rng.normal(0, 3, 500)
    # Six wildly extreme rows, as a data-entry error would produce.
    x = np.append(x, [50] * 6)
    y = np.append(y, [1_000_000] * 6)
    frame = pd.DataFrame({"preco": x, "receita": y})

    result = stats.correlation_matrix(frame, ["preco", "receita"])
    assert result["pairs"], "a relação real não deveria ser perdida"
    pair = result["pairs"][0]
    assert pair["outlier_sensitive"] is True
    assert pair["method"] == "spearman"
    assert abs(pair["coefficient"]) > 0.7


def test_outliers_use_tukey_fences():
    values = pd.Series([10, 11, 12, 11, 10, 12, 11, 10, 500])
    described = stats.describe_numeric(values)
    assert described["outliers"]["count"] == 1
    assert 500 in described["outliers"]["examples"]


def test_identifier_column_is_not_treated_as_metric():
    frame = pd.DataFrame(
        {
            "pedido_id": [f"{100000 + i}" for i in range(50)],
            "valor": [10.5 + i for i in range(50)],
        }
    )
    _, semantics = sem.analyse_schema(frame)
    pedido = next(s for s in semantics if s.name == "pedido_id")
    assert pedido.role == sem.IDENTITY
    assert not pedido.is_aggregatable


def test_pipeline_detects_sales_domain_and_builds_charts(sales_csv: bytes):
    bundle = analyse_csv_bytes(sales_csv)
    assert bundle.analysis["domain"]["key"] == "sales"
    assert bundle.analysis["recommendations"], "nenhum gráfico recomendado"
    assert bundle.analysis["kpis"], "nenhum KPI recomendado"
    assert bundle.analysis["insights"], "nenhum insight gerado"

    # Every recommendation must justify itself.
    for rec in bundle.analysis["recommendations"]:
        assert rec["rationale"], f"{rec['chart_type']} sem justificativa"
        assert rec["principle"], f"{rec['chart_type']} sem princípio"
        assert rec["encoding"], f"{rec['chart_type']} sem encoding"


def test_time_series_produces_line_chart(sales_csv: bytes):
    bundle = analyse_csv_bytes(sales_csv)
    types = {r["chart_type"] for r in bundle.analysis["recommendations"]}
    assert types & {"line", "area"}, "série temporal deveria gerar linha ou área"


def test_recommendations_are_not_a_fixed_template():
    """A dataset with no dates and no categories gets a different layout."""
    rng = np.random.default_rng(5)
    numeric_only = pd.DataFrame(
        {"medida_a": rng.normal(50, 10, 400), "medida_b": rng.normal(20, 4, 400)}
    )
    bundle_numeric = analyse_csv_bytes(_csv(numeric_only))
    numeric_types = {r["chart_type"] for r in bundle_numeric.analysis["recommendations"]}

    categorical_only = pd.DataFrame(
        {
            "categoria": rng.choice(["A", "B", "C"], 400),
            "regiao": rng.choice(["Norte", "Sul"], 400),
        }
    )
    bundle_categorical = analyse_csv_bytes(_csv(categorical_only))
    categorical_types = {r["chart_type"] for r in bundle_categorical.analysis["recommendations"]}

    assert numeric_types != categorical_types
    assert "line" not in numeric_types, "sem coluna temporal não deve haver linha"


def test_quality_score_reacts_to_dirty_data():
    clean = pd.DataFrame({"a": range(200), "categoria": ["x", "y"] * 100})
    dirty = clean.copy()
    dirty = pd.concat([dirty, dirty], ignore_index=True)  # 50% duplicates
    dirty.loc[dirty.index[:150], "a"] = None  # heavy missingness

    clean_score = analyse_csv_bytes(_csv(clean)).quality_score
    dirty_score = analyse_csv_bytes(_csv(dirty)).quality_score
    assert dirty_score < clean_score


def test_insight_numbers_match_the_underlying_data():
    """Insight text must restate values the engine computed, never invent them."""
    frame = pd.DataFrame(
        {
            "regiao": ["Sudeste"] * 70 + ["Sul"] * 20 + ["Norte"] * 10,
            "receita_total": [100.0] * 100,
        }
    )
    bundle = analyse_csv_bytes(_csv(frame))
    concentration = [
        i for i in bundle.analysis["insights"] if i["kind"] == "concentration"
    ]
    assert concentration, "a concentração em Sudeste deveria virar insight"
    evidence = concentration[0]["evidence"]
    assert evidence["leader"]["label"] == "Sudeste"
    assert evidence["leader"]["value"] == pytest.approx(7000.0)
    assert evidence["leader"]["ratio"] == pytest.approx(0.7)
    assert "70" in concentration[0]["title"]


def test_geo_column_is_detected_from_uf_values():
    frame = pd.DataFrame(
        {"uf": ["SP", "RJ", "MG", "RS"] * 25, "valor_total": list(range(100))}
    )
    _, semantics = sem.analyse_schema(frame)
    uf = next(s for s in semantics if s.name == "uf")
    assert uf.semantic_type == sem.GEO
    assert uf.detail["geo_kind"] == "state"


def test_indexing_to_100_requires_a_positive_base():
    """Dividing by a negative or zero base would invert or erase the series."""
    from app.services.widget_data import _index_to_100

    rows = [
        {"mes": "01", "lucro": -100.0, "receita": 200.0, "zerada": 0.0},
        {"mes": "02", "lucro": -50.0, "receita": 300.0, "zerada": 0.0},
        {"mes": "03", "lucro": 150.0, "receita": 400.0, "zerada": 0.0},
    ]
    indexed = _index_to_100(rows, ["lucro", "receita", "zerada"])

    # The revenue series has a positive first value and is rebased.
    assert [row["receita"] for row in indexed] == [100.0, 150.0, 200.0]
    # Profit starts negative: rebasing there would plot a recovery as a fall,
    # so the raw values are kept.
    assert [row["lucro"] for row in indexed] == [-100.0, -50.0, 150.0]
    # An all-zero measure has no base; it stays a flat line rather than vanishing.
    assert [row["zerada"] for row in indexed] == [0.0, 0.0, 0.0]


def test_funnel_rule_detects_sequential_stages_in_order():
    """A recognisable pipeline (impressions → clicks → leads → sales) becomes
    a funnel, staged in process order — never re-sorted by magnitude."""
    rng = np.random.default_rng(11)
    n = 400
    frame = pd.DataFrame(
        {
            "campanha": rng.choice(["Busca", "Social", "Display"], n),
            "impressoes": rng.integers(1000, 50000, n),
            "cliques": rng.integers(50, 3000, n),
            "leads": rng.integers(5, 400, n),
            "vendas": rng.integers(0, 40, n),
        }
    )
    bundle = analyse_csv_bytes(_csv(frame))
    funnel = next(
        (r for r in bundle.analysis["recommendations"] if r["chart_type"] == "funnel"), None
    )
    assert funnel is not None, "um pipeline reconhecível deveria gerar um funil"
    assert funnel["encoding"]["metrics"] == ["impressoes", "cliques", "leads", "vendas"]

    from app.services import widget_data

    result = widget_data.resolve(
        bundle.frame, bundle.profile, bundle.analysis,
        chart_type="funnel", encoding=funnel["encoding"],
    )
    labels = [row["label"] for row in result["rows"]]
    assert labels == ["Impressoes", "Cliques", "Leads", "Vendas"]
    # Each stage's value is the real sum of that column — never invented.
    assert result["rows"][0]["value"] == pytest.approx(float(frame["impressoes"].sum()))


def test_funnel_rule_requires_at_least_three_additive_stages():
    """Two stages, or a stage that is a rate rather than a count, must not
    produce a funnel — the chart would misrepresent what it claims to show."""
    frame = pd.DataFrame(
        {
            "cliques": [100, 200, 150, 300, 90],
            "vendas": [10, 20, 15, 30, 9],
            "outra_coluna": [5.0, 6.0, 7.0, 8.0, 9.0],
        }
    )
    bundle = analyse_csv_bytes(_csv(frame))
    funnel = next(
        (r for r in bundle.analysis["recommendations"] if r["chart_type"] == "funnel"), None
    )
    assert funnel is None


def test_radar_rule_compares_top_entities_across_normalised_metrics():
    """With several metrics and a moderate-cardinality dimension, a radar
    compares the leading entities on a common 0-100 scale per axis."""
    rng = np.random.default_rng(5)
    n = 600
    frame = pd.DataFrame(
        {
            "produto": rng.choice(["A", "B", "C", "D", "E"], n),
            "receita": rng.uniform(100, 9000, n).round(2),
            "quantidade": rng.integers(1, 50, n),
            "avaliacao": rng.uniform(1, 5, n).round(1),
        }
    )
    bundle = analyse_csv_bytes(_csv(frame))
    radar = next(
        (r for r in bundle.analysis["recommendations"] if r["chart_type"] == "radar"), None
    )
    assert radar is not None
    assert radar["encoding"]["x"] == "produto"
    assert set(radar["encoding"]["metrics"]) <= {"receita", "quantidade", "avaliacao"}

    from app.services import widget_data

    result = widget_data.resolve(
        bundle.frame, bundle.profile, bundle.analysis,
        chart_type="radar", encoding=radar["encoding"],
    )
    assert len(result["rows"]) == 3, "deve trazer o top 3 de entidades, não todas"
    metric_keys = [ind["key"] for ind in result["meta"]["indicators"]]
    for row in result["rows"]:
        for key in metric_keys:
            # Every axis is bounded to the 0-100 scale the chart expects...
            assert 0 <= row[key] <= 100
            # ...while the raw value travels alongside for the tooltip.
            assert f"{key}_raw" in row
    # At least one entity should sit at exactly 100 on its leading metric —
    # that is the leader the normalisation is anchored to.
    assert any(row[metric_keys[0]] == 100.0 for row in result["rows"])


def test_radar_rule_needs_at_least_three_metrics():
    frame = pd.DataFrame(
        {
            "produto": ["A", "B", "C", "D"] * 20,
            "receita": list(range(80)),
            "quantidade": list(range(80)),
        }
    )
    bundle = analyse_csv_bytes(_csv(frame))
    radar = next(
        (r for r in bundle.analysis["recommendations"] if r["chart_type"] == "radar"), None
    )
    assert radar is None
