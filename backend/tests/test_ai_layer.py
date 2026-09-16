"""The LLM layer.

These tests exercise the paths a configured model would take, using a fake
provider. What matters is not that the model is clever, but that the system
stays correct when it is wrong: a malformed answer, a hallucinated column or a
fabricated number must never reach the user.
"""
from __future__ import annotations

import json

import pytest

from app.ai.analyst import DataAnalyst
from app.ai.base import LLMProvider, LLMResponse, LLMUnavailable
from app.ai.providers import NullProvider
from app.services.analyzer import analyse_csv_bytes


class FakeProvider(LLMProvider):
    """Returns canned responses keyed by the system prompt's role."""

    name = "fake"
    model = "fake-1"

    def __init__(self, responses: dict[str, str], *, fail: bool = False):
        self.responses = responses
        self.fail = fail
        self.calls: list[tuple[str, str]] = []

    @property
    def available(self) -> bool:
        return True

    async def complete(self, *, system: str, user: str, **_: object) -> LLMResponse:
        self.calls.append((system, user))
        if self.fail:
            raise LLMUnavailable("provedor indisponível")

        if "planejador de consultas" in system:
            key = "planner"
        elif "explicando um resultado" in system:
            key = "narrator"
        elif "resumo executivo" in system:
            key = "summary"
        else:
            key = "curator"
        return LLMResponse(text=self.responses.get(key, "{}"), provider=self.name, model=self.model)


@pytest.fixture
def bundle(sales_csv: bytes):
    return analyse_csv_bytes(sales_csv)


async def test_valid_plan_from_the_model_is_executed(bundle):
    """A well-formed plan drives a real query; the answer comes from the rows."""
    provider = FakeProvider(
        {
            "planner": json.dumps(
                {
                    "intent": "aggregate",
                    "group_by": ["uf"],
                    "metrics": [{"column": "valor_total", "agg": "sum"}],
                    "filters": [],
                    "sort_desc": True,
                    "limit": 5,
                    "chart_type": "bar_horizontal",
                    "chart_title": "Vendas por UF",
                    "reasoning": "agrupa por unidade federativa",
                }
            ),
            "narrator": json.dumps(
                {"answer": "São Paulo lidera as vendas.", "follow_up_questions": ["E por produto?"]}
            ),
        }
    )
    answer = await DataAnalyst(provider).answer(
        "Vendas por estado?", bundle.frame, bundle.profile, bundle.analysis
    )

    assert answer.source == "llm:fake"
    assert answer.plan["group_by"] == ["uf"]
    assert answer.result is not None and answer.result["rows"]
    assert answer.chart is not None
    # The numbers are the engine's, whatever the model wrote.
    assert all(isinstance(row["valor_total"], (int, float)) for row in answer.result["rows"])


async def test_plan_referencing_a_missing_column_is_discarded(bundle):
    """A hallucinated column must not reach the query engine."""
    provider = FakeProvider(
        {
            "planner": json.dumps(
                {
                    "intent": "aggregate",
                    "group_by": ["coluna_que_nao_existe"],
                    "metrics": [{"column": "receita_inventada", "agg": "sum"}],
                    "limit": 5,
                }
            )
        }
    )
    answer = await DataAnalyst(provider).answer(
        "Qual produto vendeu mais?", bundle.frame, bundle.profile, bundle.analysis
    )

    # Rules took over, and the executed plan uses real columns only.
    assert answer.source == "deterministic"
    names = {c["name"] for c in bundle.profile["columns"]}
    assert set(answer.plan["group_by"]) <= names


@pytest.mark.parametrize(
    "malformed",
    [
        "isso não é json",
        "{",
        '{"intent": "aggregate", "limit": "muitos"}',
        json.dumps({"intent": "voar", "group_by": ["uf"]}),
        "",
    ],
)
async def test_malformed_model_output_falls_back_to_rules(bundle, malformed):
    provider = FakeProvider({"planner": malformed})
    answer = await DataAnalyst(provider).answer(
        "Qual produto vendeu mais?", bundle.frame, bundle.profile, bundle.analysis
    )
    assert answer.source == "deterministic"
    assert answer.answer


async def test_provider_failure_does_not_break_the_answer(bundle):
    """A timeout or an outage degrades to rules, never to an error page."""
    answer = await DataAnalyst(FakeProvider({}, fail=True)).answer(
        "Qual produto vendeu mais?", bundle.frame, bundle.profile, bundle.analysis
    )
    assert answer.source == "deterministic"
    assert answer.result is not None and answer.result["rows"]


async def test_narration_failure_keeps_the_computed_answer(bundle):
    """If only the narrator fails, the executed result still reaches the user."""
    provider = FakeProvider(
        {
            "planner": json.dumps(
                {
                    "intent": "aggregate",
                    "group_by": ["produto"],
                    "metrics": [{"column": "valor_total", "agg": "sum"}],
                    "limit": 5,
                }
            ),
            "narrator": "resposta em prosa, não em json",
        }
    )
    answer = await DataAnalyst(provider).answer(
        "Qual produto vendeu mais?", bundle.frame, bundle.profile, bundle.analysis
    )
    assert answer.result is not None and answer.result["rows"]
    assert answer.answer  # composed deterministically from the rows


async def test_the_model_never_sees_raw_records(bundle):
    """Only pre-computed facts are sent; the dataset itself never leaves."""
    provider = FakeProvider({"planner": "{}"})
    await DataAnalyst(provider).answer(
        "Qual produto vendeu mais?", bundle.frame, bundle.profile, bundle.analysis
    )
    sent = "\n".join(user for _, user in provider.calls)
    # An order id appears in the data but in no fact sheet.
    assert "PED-1000" not in sent
    assert "pedido_id" in sent or "produto" in sent  # the schema is sent


async def test_curation_cannot_invent_or_empty_the_dashboard(bundle):
    """The model may prune and reorder; it may not create visualisations."""
    provider = FakeProvider(
        {
            "curator": json.dumps(
                {
                    "dashboard_title": "Painel Comercial",
                    "widgets": [
                        {"index": 0, "keep": True, "title": "Evolução", "priority": 90},
                        {"index": 99, "keep": True, "title": "Inventado", "priority": 95},
                        {"index": 1, "keep": False, "priority": 10},
                    ],
                }
            )
        }
    )
    recommendations = bundle.analysis["recommendations"]
    curated, meta = await DataAnalyst(provider).curate_dashboard(
        recommendations, bundle.profile, bundle.analysis
    )

    for widget in curated:
        assert widget["chart_type"] in {r["chart_type"] for r in recommendations}
        # Encodings are never taken from the model.
        assert widget["encoding"] in [r["encoding"] for r in recommendations]
    assert len(curated) >= 3, "a curadoria não pode esvaziar o dashboard"
    assert meta["title"] == "Painel Comercial"


async def test_curation_that_empties_the_dashboard_is_rejected(bundle):
    provider = FakeProvider(
        {
            "curator": json.dumps(
                {
                    "dashboard_title": "Vazio",
                    "widgets": [
                        {"index": i, "keep": False}
                        for i in range(len(bundle.analysis["recommendations"]))
                    ],
                }
            )
        }
    )
    recommendations = bundle.analysis["recommendations"]
    curated, _ = await DataAnalyst(provider).curate_dashboard(
        recommendations, bundle.profile, bundle.analysis
    )
    assert len(curated) == len(recommendations)


async def test_null_provider_is_fully_functional(bundle):
    """With no model configured every feature still answers."""
    analyst = DataAnalyst(NullProvider())
    for question in [
        "Qual produto vendeu mais?",
        "Quais valores parecem fora do padrão?",
        "Quais são os principais problemas encontrados nos dados?",
        "Qual a evolução do valor total ao longo do tempo?",
    ]:
        answer = await analyst.answer(question, bundle.frame, bundle.profile, bundle.analysis)
        assert answer.answer, question
        assert answer.source == "deterministic"

    narrative = await analyst.summarise_dashboard(bundle.profile, bundle.analysis)
    assert narrative["summary"]
    assert narrative["source"] == "deterministic"
