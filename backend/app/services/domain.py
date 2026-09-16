"""Business-domain detection.

Identifies what the dataset is *about* so the dashboard can surface the
vocabulary and KPIs an analyst in that domain would expect.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.services.semantics import slugify

GENERIC = "generic"


@dataclass(frozen=True)
class DomainProfile:
    key: str
    label: str
    description: str
    keywords: tuple[str, ...]
    # Metric keywords ranked by how "primary" they are for this domain.
    primary_metrics: tuple[str, ...]
    suggested_questions: tuple[str, ...]


DOMAINS: tuple[DomainProfile, ...] = (
    DomainProfile(
        key="sales",
        label="Vendas",
        description="Pedidos, produtos, clientes e receita comercial.",
        keywords=(
            "venda", "vendas", "sale", "sales", "pedido", "order", "produto",
            "product", "cliente", "customer", "faturamento", "revenue", "receita",
            "ticket", "sku", "canal", "channel", "vendedor", "seller", "desconto",
            "discount", "quantidade", "qty", "loja", "store", "gmv",
        ),
        primary_metrics=("faturamento", "receita", "revenue", "valor", "total", "venda", "gmv"),
        suggested_questions=(
            "Qual foi o mês com maior faturamento?",
            "Qual produto vendeu mais?",
            "Qual é o ticket médio por pedido?",
            "Quais regiões têm o melhor desempenho?",
        ),
    ),
    DomainProfile(
        key="finance",
        label="Financeiro",
        description="Receitas, despesas, margem e resultado contábil.",
        keywords=(
            "receita", "despesa", "expense", "custo", "cost", "margem", "margin",
            "lucro", "profit", "ebitda", "caixa", "cash", "conta", "account",
            "saldo", "balance", "orcamento", "budget", "centro_custo", "fluxo",
            "investimento", "juros", "imposto", "tax",
        ),
        primary_metrics=("receita", "lucro", "margem", "despesa", "custo", "saldo", "valor"),
        suggested_questions=(
            "Qual é a evolução da margem ao longo do tempo?",
            "Quais categorias concentram as maiores despesas?",
            "A receita está crescendo mais rápido que os custos?",
            "Existem lançamentos fora do padrão?",
        ),
    ),
    DomainProfile(
        key="education",
        label="Educação",
        description="Alunos, notas, frequência e desempenho acadêmico.",
        keywords=(
            "aluno", "student", "nota", "grade", "score", "prova", "exam",
            "disciplina", "subject", "turma", "class", "curso", "course",
            "frequencia", "attendance", "presenca", "professor", "teacher",
            "matricula", "semestre", "escola", "school", "aprovado", "media",
        ),
        primary_metrics=("nota", "media", "score", "frequencia", "grade", "desempenho"),
        suggested_questions=(
            "Qual é a média geral por turma?",
            "Existe relação entre frequência e nota?",
            "Quais alunos estão abaixo da média?",
            "Como o desempenho evoluiu ao longo do período?",
        ),
    ),
    DomainProfile(
        key="marketing",
        label="Marketing",
        description="Campanhas, canais, conversão e investimento em mídia.",
        keywords=(
            "campanha", "campaign", "impressao", "impression", "clique", "click",
            "ctr", "cpc", "cpa", "cpm", "conversao", "conversion", "lead",
            "trafego", "traffic", "sessao", "session", "visita", "visit",
            "anuncio", "ad", "midia", "media", "roas", "engajamento",
        ),
        primary_metrics=("conversao", "clique", "lead", "roas", "investimento", "impressao"),
        suggested_questions=(
            "Qual canal traz mais conversões?",
            "Qual campanha tem o melhor custo por aquisição?",
            "Existe correlação entre investimento e resultados?",
            "Como o tráfego evoluiu no período?",
        ),
    ),
    DomainProfile(
        key="hr",
        label="Pessoas",
        description="Colaboradores, cargos, salários e rotatividade.",
        keywords=(
            "funcionario", "employee", "colaborador", "cargo", "role", "salario",
            "salary", "departamento", "department", "admissao", "hire",
            "desligamento", "turnover", "ferias", "headcount", "contratacao",
            "senioridade", "equipe", "team", "gestor", "manager",
        ),
        primary_metrics=("salario", "headcount", "turnover", "tempo_casa", "custo"),
        suggested_questions=(
            "Qual é a distribuição salarial por cargo?",
            "Qual departamento tem maior rotatividade?",
            "Como o headcount evoluiu ao longo do tempo?",
            "Existem salários fora do padrão?",
        ),
    ),
    DomainProfile(
        key="operations",
        label="Operações",
        description="Produção, logística, estoque e prazos de entrega.",
        keywords=(
            "estoque", "stock", "inventory", "entrega", "delivery", "prazo",
            "lead_time", "producao", "production", "fornecedor", "supplier",
            "armazem", "warehouse", "transporte", "frete", "freight", "defeito",
            "sla", "capacidade", "maquina", "manutencao", "ocorrencia",
        ),
        primary_metrics=("prazo", "quantidade", "estoque", "custo", "sla", "tempo"),
        suggested_questions=(
            "Qual é o prazo médio de entrega por região?",
            "Onde estão os maiores gargalos operacionais?",
            "Quais itens estão com estoque crítico?",
            "O SLA melhorou nos últimos meses?",
        ),
    ),
    DomainProfile(
        key="health",
        label="Saúde",
        description="Pacientes, atendimentos, diagnósticos e indicadores clínicos.",
        keywords=(
            "paciente", "patient", "atendimento", "consulta", "diagnostico",
            "diagnosis", "exame", "medico", "doctor", "hospital", "leito",
            "internacao", "sintoma", "tratamento", "medicamento", "idade",
            "pressao", "peso", "altura", "imc",
        ),
        primary_metrics=("atendimento", "tempo", "idade", "custo", "quantidade"),
        suggested_questions=(
            "Quantos atendimentos foram realizados por período?",
            "Qual é o perfil etário dos pacientes?",
            "Quais diagnósticos são mais frequentes?",
            "Existem indicadores fora da faixa esperada?",
        ),
    ),
)

_DOMAIN_BY_KEY = {d.key: d for d in DOMAINS}

GENERIC_PROFILE = DomainProfile(
    key=GENERIC,
    label="Geral",
    description="Conjunto de dados sem um domínio de negócio dominante.",
    keywords=(),
    primary_metrics=(),
    suggested_questions=(
        "O que mais chama atenção nesse dataset?",
        "Quais métricas devo acompanhar?",
        "Existe alguma tendência importante?",
        "Quais valores parecem fora do padrão?",
    ),
)


def detect_domain(column_names: list[str]) -> dict[str, Any]:
    """Score every domain against the column vocabulary and pick a winner."""
    slugs = [slugify(name) for name in column_names]
    tokens: set[str] = set()
    for slug in slugs:
        tokens.add(slug)
        tokens.update(p for p in slug.split("_") if p)

    scores: list[dict[str, Any]] = []
    for domain in DOMAINS:
        matched = sorted({kw for kw in domain.keywords if kw in tokens})
        # Partial matches ("valor_venda" contains "venda") count at half weight.
        partial = sorted(
            {
                kw
                for kw in domain.keywords
                if kw not in matched and len(kw) > 4 and any(kw in slug for slug in slugs)
            }
        )
        raw = len(matched) + 0.5 * len(partial)
        if raw <= 0:
            continue
        scores.append(
            {
                "key": domain.key,
                "label": domain.label,
                "score": round(raw, 2),
                "matched_keywords": (matched + partial)[:10],
            }
        )

    scores.sort(key=lambda s: s["score"], reverse=True)

    if not scores or scores[0]["score"] < 2:
        chosen = GENERIC_PROFILE
        confidence = 0.0
    else:
        chosen = _DOMAIN_BY_KEY[scores[0]["key"]]
        runner_up = scores[1]["score"] if len(scores) > 1 else 0.0
        top = scores[0]["score"]
        # Confidence blends absolute evidence with the gap to the runner-up.
        evidence = min(1.0, top / 6.0)
        separation = (top - runner_up) / top if top else 0.0
        confidence = round(min(1.0, 0.55 * evidence + 0.45 * separation + 0.15), 3)

    return {
        "key": chosen.key,
        "label": chosen.label,
        "description": chosen.description,
        "confidence": confidence,
        "suggested_questions": list(chosen.suggested_questions),
        "candidates": scores[:4],
    }


def get_profile(key: str) -> DomainProfile:
    return _DOMAIN_BY_KEY.get(key, GENERIC_PROFILE)


def rank_metric_columns(domain_key: str, metric_columns: list[str]) -> list[str]:
    """Order metric columns so the domain's headline metric comes first."""
    profile = get_profile(domain_key)
    if not profile.primary_metrics:
        return list(metric_columns)

    def rank(name: str) -> tuple[int, int]:
        slug = slugify(name)
        for idx, keyword in enumerate(profile.primary_metrics):
            if keyword == slug:
                return (0, idx)
            if keyword in slug:
                return (1, idx)
        return (2, 0)

    return sorted(metric_columns, key=rank)
