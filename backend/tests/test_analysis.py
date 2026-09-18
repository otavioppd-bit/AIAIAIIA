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


def test_map_is_recommended_alongside_the_ranking_bar():
    """A map adds position in real space, which no bar carries — so the two
    are complementary readings of the same columns, not duplicate ones."""
    rng = np.random.default_rng(7)
    n = 400
    frame = pd.DataFrame(
        {
            "uf": rng.choice(["SP", "RJ", "MG", "RS", "PR", "BA", "SC", "DF"], n),
            "vendedor": rng.choice(["Ana", "Bruno", "Carla"], n),
            "valor_total": rng.gamma(2, 500, n).round(2),
        }
    )
    bundle = analyse_csv_bytes(_csv(frame))
    recs = bundle.analysis["recommendations"]

    chart_map = next((r for r in recs if r["chart_type"] == "map"), None)
    assert chart_map is not None, "uma coluna de UFs deveria gerar um mapa"
    assert chart_map["encoding"]["geo_kind"] == "state"
    assert chart_map["encoding"]["x"] == "uf"

    # The bar over the very same pair must survive next to it.
    bars = [
        r for r in recs
        if r["chart_type"] in {"bar", "bar_horizontal"}
        and r["encoding"].get("x") == "uf"
        and r["encoding"].get("y") == "valor_total"
    ]
    assert bars, "o ranking em barras não deveria ser descartado pelo mapa"


def test_country_values_are_recognised_without_a_country_header():
    """Nobody names the column "pais" every time; the values have to be enough."""
    rng = np.random.default_rng(3)
    n = 300
    frame = pd.DataFrame(
        {
            "mercado": rng.choice(
                ["Brasil", "Argentina", "Estados Unidos", "Alemanha", "Japão", "México"], n
            ),
            "receita": rng.gamma(2, 900, n).round(2),
        }
    )
    bundle = analyse_csv_bytes(_csv(frame))
    column = next(c for c in bundle.profile["columns"] if c["name"] == "mercado")
    assert column["semantic_type"] == sem.GEO
    assert column["detail"]["geo_kind"] == "country"

    chart_map = next(
        (r for r in bundle.analysis["recommendations"] if r["chart_type"] == "map"), None
    )
    assert chart_map is not None, "países reconhecíveis deveriam gerar um mapa global"
    assert chart_map["encoding"]["geo_kind"] == "country"


def test_state_names_outrank_an_ambiguous_region_header():
    """“região” names a granularity the data may not use: a column holding
    state names is a state column whatever the header claims."""
    rng = np.random.default_rng(5)
    n = 300
    frame = pd.DataFrame(
        {
            "regiao_cliente": rng.choice(
                ["São Paulo", "Rio de Janeiro", "Minas Gerais", "Bahia", "Paraná"], n
            ),
            "receita": rng.gamma(2, 700, n).round(2),
        }
    )
    bundle = analyse_csv_bytes(_csv(frame))
    column = next(c for c in bundle.profile["columns"] if c["name"] == "regiao_cliente")
    assert column["detail"]["geo_kind"] == "state"


def test_plain_categories_never_become_a_map():
    """A map of things that are not places is the kind of chart this engine
    exists to avoid."""
    rng = np.random.default_rng(9)
    n = 200
    frame = pd.DataFrame(
        {
            "categoria": rng.choice(["Eletrônicos", "Moda", "Casa", "Livros"], n),
            "receita": rng.gamma(2, 300, n).round(2),
        }
    )
    bundle = analyse_csv_bytes(_csv(frame))
    column = next(c for c in bundle.profile["columns"] if c["name"] == "categoria")
    assert column["semantic_type"] != sem.GEO
    assert all(r["chart_type"] != "map" for r in bundle.analysis["recommendations"])


def test_thin_dataset_still_reaches_the_chart_floor():
    """Two columns is enough for four genuinely different questions, so a thin
    dataset should not land on a one-chart dashboard."""
    rng = np.random.default_rng(9)
    n = 200
    frame = pd.DataFrame(
        {
            "categoria": rng.choice(["A", "B", "C", "D"], n),
            "receita": rng.gamma(2, 300, n).round(2),
        }
    )
    bundle = analyse_csv_bytes(_csv(frame))
    recs = bundle.analysis["recommendations"]
    assert len(recs) >= 4, f"apenas {len(recs)} gráficos para um dataset utilizável"
    # Every chart still carries the reasoning that justifies it — the floor is
    # reached by re-admitting real candidates, never by inventing filler.
    for rec in recs:
        assert rec["rationale"].strip()
        assert rec["principle"].strip()


def test_a_single_column_is_not_padded_with_invented_charts():
    """The floor is best-effort, not a quota: one numeric column supports a
    histogram and a box plot, and nothing else honest exists to add."""
    rng = np.random.default_rng(4)
    frame = pd.DataFrame({"valor": rng.gamma(2, 100, 80).round(2)})
    bundle = analyse_csv_bytes(_csv(frame))
    types = [r["chart_type"] for r in bundle.analysis["recommendations"]]
    assert types, "uma coluna numérica ainda rende alguma análise"
    assert set(types) <= {"histogram", "box_plot"}, types


def test_grouped_box_plot_answers_what_a_total_hides():
    """A category can lead on total while being the least consistent of the
    set; only the per-group quartiles show that."""
    rng = np.random.default_rng(12)
    n = 300
    frame = pd.DataFrame(
        {
            "loja": rng.choice(["Centro", "Norte", "Sul"], n),
            "ticket": rng.gamma(2, 120, n).round(2),
        }
    )
    bundle = analyse_csv_bytes(_csv(frame))
    grouped = [
        r for r in bundle.analysis["recommendations"]
        if r["chart_type"] == "box_plot" and r["encoding"].get("x") == "loja"
    ]
    assert grouped, "faltou o box plot agrupado"
    assert grouped[0]["encoding"]["y"] == "ticket"

    from app.services import widget_data

    result = widget_data.resolve(
        bundle.frame, bundle.profile, bundle.analysis,
        chart_type="box_plot", encoding=grouped[0]["encoding"],
    )
    # One box per store, each with real quartiles.
    assert len(result["rows"]) == 3
    for row in result["rows"]:
        assert row["q1"] <= row["median"] <= row["q3"]


def test_pipeline_reports_the_stages_it_actually_runs():
    """The progress a user watches has to be the work the server did, so the
    callback fires from inside the pipeline rather than on a timer."""
    rng = np.random.default_rng(1)
    n = 300
    frame = pd.DataFrame(
        {
            "data": pd.to_datetime(rng.choice(pd.date_range("2024-01-01", "2024-12-31"), n)),
            "uf": rng.choice(["SP", "RJ", "MG"], n),
            "valor_total": rng.gamma(2, 400, n).round(2),
        }
    )
    seen: list[str] = []
    analyse_csv_bytes(_csv(frame), on_stage=seen.append)

    from app.services import progress

    assert seen, "nenhum estágio reportado"
    assert set(seen) <= set(progress.STAGE_IDS), seen
    # Reported in execution order, never rearranged to look tidier.
    positions = [progress.STAGE_IDS.index(stage) for stage in seen]
    assert positions == sorted(positions), seen
    assert seen[0] == "read"


def test_a_broken_progress_reporter_never_fails_the_analysis():
    """Progress is a nicety; losing it must not cost the user their upload."""
    frame = pd.DataFrame({"categoria": ["A", "B", "A"], "valor": [1.0, 2.0, 3.0]})

    def explode(_stage: str) -> None:
        raise RuntimeError("reporter caiu")

    bundle = analyse_csv_bytes(_csv(frame), on_stage=explode)
    assert bundle.profile["overview"]["row_count"] == 3


def _spec_for(frame: pd.DataFrame) -> dict:
    from app.services import dashboard_builder

    bundle = analyse_csv_bytes(_csv(frame))
    return dashboard_builder.build_dashboard_spec(
        profile=bundle.profile,
        analysis=bundle.analysis,
        recommendations=bundle.analysis["recommendations"],
        kpis=bundle.analysis["kpis"],
        narrative={"summary": "x"},
    )


def test_no_dashboard_row_is_left_ragged():
    """A row that ends short leaves dead space, and a row with mismatched
    heights leaves a hole under the shorter card. Neither reads as a layout
    someone composed."""
    rng = np.random.default_rng(7)
    n = 500
    frame = pd.DataFrame(
        {
            "data_venda": pd.to_datetime(rng.choice(pd.date_range("2024-01-01", "2024-12-31"), n)),
            "uf": rng.choice(["SP", "RJ", "MG", "BA", "RS"], n),
            "vendedor": rng.choice(["Ana", "Bruno", "Carla"], n),
            "categoria": rng.choice(["A", "B", "C"], n),
            "valor_total": rng.gamma(2, 500, n).round(2),
        }
    )
    spec = _spec_for(frame)

    rows: dict[int, list[dict]] = {}
    for widget in spec["widgets"]:
        rows.setdefault(widget["layout"]["y"], []).append(widget)

    for y, row in rows.items():
        heights = {w["layout"]["h"] for w in row}
        assert len(heights) == 1, f"linha y={y} tem alturas diferentes: {heights}"

        row.sort(key=lambda w: w["layout"]["x"])
        # Widgets sit side by side with no overlap and no gap between them.
        for left, right in zip(row, row[1:], strict=False):
            assert left["layout"]["x"] + left["layout"]["w"] == right["layout"]["x"], (
                f"buraco ou sobreposição na linha y={y}"
            )

        span = row[-1]["layout"]["x"] + row[-1]["layout"]["w"] - row[0]["layout"]["x"]
        if span < 12:
            # Only a capped form may leave space, and then it is centred.
            left_margin = row[0]["layout"]["x"]
            right_margin = 12 - (row[-1]["layout"]["x"] + row[-1]["layout"]["w"])
            assert abs(left_margin - right_margin) <= 1, f"linha y={y} não está centrada"


def test_a_donut_is_never_inflated_to_close_a_gap():
    """Past a point the circle stops growing and the card just gets emptier,
    so filling a row is not worth stretching one."""
    rng = np.random.default_rng(3)
    n = 400
    frame = pd.DataFrame(
        {
            "canal": rng.choice(["Direto", "Online", "Parceiro"], n),
            "receita": rng.gamma(2, 400, n).round(2),
        }
    )
    spec = _spec_for(frame)
    for widget in spec["widgets"]:
        if (widget.get("config") or {}).get("chart_type") in {"donut", "pie"}:
            assert widget["layout"]["w"] <= 6, "donut esticado além do que é legível"


def test_a_postal_code_is_never_summed_into_a_total():
    """Digits that name a place are not a quantity: the old engine read
    "customer" as the Portuguese "custo" and reported billions of reais worth
    of ZIP codes as the headline figure."""
    rng = np.random.default_rng(11)
    n = 400
    frame = pd.DataFrame(
        {
            "customer_id": [f"{i:08x}" for i in range(n)],
            "customer_zip_code_prefix": rng.integers(1000, 99990, n),
            "customer_state": rng.choice(["SP", "RJ", "MG"], n),
        }
    )
    bundle = analyse_csv_bytes(_csv(frame))
    zip_column = next(
        c for c in bundle.profile["columns"] if c["name"] == "customer_zip_code_prefix"
    )
    assert zip_column["semantic_type"] != sem.CURRENCY
    assert zip_column["role"] != sem.METRIC

    labels = " ".join(k["label"].lower() for k in bundle.analysis["kpis"])
    assert "zip" not in labels, bundle.analysis["kpis"]
    assert all(k["format"] != "currency" for k in bundle.analysis["kpis"])


def test_an_english_column_name_is_not_read_as_portuguese_money():
    """"custo" lives inside "customer"; matching by substring made every
    customer column in an English dataset a currency measure."""
    assert not sem._matches("customer_state", sem._MONEY_WORDS)
    assert not sem._matches("CustomerID", sem._MONEY_WORDS)
    # The words that should match still do, including one plural step.
    assert sem._matches("custo_medio", sem._MONEY_WORDS)
    assert sem._matches("custos", sem._MONEY_WORDS)
    assert sem._matches("valorTotal", sem._MONEY_WORDS)
    assert sem._matches("precoUnitario", sem._MONEY_WORDS)
