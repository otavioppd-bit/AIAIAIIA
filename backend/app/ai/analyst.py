"""The AI Data Analyst.

Orchestrates: question → plan → deterministic execution → grounded narration.

The model never sees the dataset and never produces a number. It proposes a
plan (validated against the real schema) and phrases an answer over rows the
query engine computed. With no model configured, rule-based parsing and
templated narration keep every feature working.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from app.ai import context as ctx
from app.ai import nl_query, prompts
from app.ai.base import LLMProvider, LLMUnavailable, parse_structured
from app.ai.providers import get_provider
from app.ai.schemas import (
    AnalystPlan,
    AnswerNarration,
    DashboardCuration,
    DashboardNarrative,
)
from app.core.errors import ValidationError
from app.services import insights as insights_mod
from app.services import query_engine as qe
from app.services import semantics as sem

logger = logging.getLogger(__name__)

_MAX_CHART_ROWS = 200


@dataclass
class AnalystAnswer:
    answer: str
    intent: str
    plan: dict[str, Any]
    result: dict[str, Any] | None
    chart: dict[str, Any] | None
    follow_ups: list[str] = field(default_factory=list)
    source: str = "deterministic"
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "intent": self.intent,
            "plan": self.plan,
            "result": self.result,
            "chart": self.chart,
            "follow_ups": self.follow_ups,
            "source": self.source,
            "notes": self.notes,
        }


class DataAnalyst:
    def __init__(self, provider: LLMProvider | None = None):
        self.provider = provider or get_provider()

    # --- Question answering ----------------------------------------------

    async def answer(
        self,
        question: str,
        frame: pd.DataFrame,
        profile: dict[str, Any],
        analysis: dict[str, Any],
    ) -> AnalystAnswer:
        question = (question or "").strip()
        if not question:
            raise ValidationError("A pergunta não pode estar vazia.")
        if len(question) > 2000:
            raise ValidationError("A pergunta é longa demais (máximo 2000 caracteres).")

        column_semantics = profile["columns"]
        guard = qe.SchemaGuard(column_semantics)

        plan, plan_source = await self._build_plan(question, profile, analysis, guard)

        # Intents that are answered from the pre-computed analysis document.
        if plan.intent in {"quality", "outliers", "overview", "correlation", "distribution"}:
            return self._answer_from_analysis(plan, profile, analysis, plan_source)

        if plan.intent == "unsupported":
            missing = ", ".join(f"“{term}”" for term in plan.unmatched_terms[:3])
            return AnalystAnswer(
                answer=(
                    (f"Não encontrei {missing} neste conjunto de dados. " if missing else "")
                    + "Responder assim mesmo significaria trocar a sua pergunta por outra. "
                    f"As colunas disponíveis são: {', '.join(guard.names[:15])}"
                    + ("…" if len(guard.names) > 15 else "")
                    + "."
                ),
                intent="unsupported",
                plan=plan.model_dump(),
                result=None,
                chart=None,
                follow_ups=list(analysis["domain"].get("suggested_questions", []))[:3],
                source=plan_source,
            )

        query_plan = self._to_query_plan(plan)
        result = qe.execute(frame, query_plan, guard)

        if result.row_count == 0:
            return AnalystAnswer(
                answer=(
                    "Nenhum registro atende aos critérios da pergunta. "
                    "Verifique se os filtros mencionados existem nos dados."
                ),
                intent=plan.intent,
                plan=query_plan.model_dump(),
                result=result.to_dict(),
                chart=None,
                source=plan_source,
                notes=result.notes,
            )

        chart = self._build_chart(plan, query_plan, result)
        types = {c['name']: c['semantic_type'] for c in column_semantics}
        narration = await self._narrate(question, query_plan, result, analysis, types)

        return AnalystAnswer(
            answer=narration["answer"],
            intent=plan.intent,
            plan=query_plan.model_dump(),
            result=result.to_dict(),
            chart=chart,
            follow_ups=narration["follow_ups"],
            source=narration["source"] if narration["source"] != "deterministic" else plan_source,
            notes=result.notes,
        )

    async def _build_plan(
        self,
        question: str,
        profile: dict[str, Any],
        analysis: dict[str, Any],
        guard: qe.SchemaGuard,
    ) -> tuple[AnalystPlan, str]:
        """Ask the model for a plan; fall back to rules on any problem."""
        if self.provider.available:
            try:
                schema_ctx = ctx.schema_context(profile, analysis)
                response = await self.provider.complete(
                    system=prompts.PLANNER_SYSTEM,
                    user=prompts.planner_user_prompt(question, schema_ctx),
                    temperature=0.0,
                    max_tokens=1200,
                )
                plan = parse_structured(response.text, AnalystPlan)
                if self._plan_is_valid(plan, guard):
                    return plan, f"llm:{self.provider.name}"
                logger.warning("Plano do modelo referencia colunas inexistentes; usando regras.")
            except (LLMUnavailable, ValueError) as exc:
                logger.warning("Planejamento via LLM falhou (%s); usando regras.", exc)

        return nl_query.parse_question(question, profile["columns"], analysis), "deterministic"

    def _plan_is_valid(self, plan: AnalystPlan, guard: qe.SchemaGuard) -> bool:
        """Reject any plan that references a column the dataset does not have."""
        for column in plan.group_by:
            if guard.resolve(column) is None:
                return False
        for metric in plan.metrics:
            if metric.column is not None and guard.resolve(metric.column) is None:
                return False
        for flt in plan.filters:
            if guard.resolve(flt.column) is None:
                return False
        return True

    def _to_query_plan(self, plan: AnalystPlan) -> qe.QueryPlan:
        metrics = [
            qe.MetricSpec(column=m.column, agg=m.agg) for m in plan.metrics
        ] or [qe.MetricSpec(column=None, agg="count")]

        # Grouping on a date defaults to chronological order, which is right for
        # a trend but wrong for "which month was the highest" — that ranks by
        # the measure. Ask for the metric explicitly in the ranking case.
        sort_by: str | None = None
        if plan.intent == "aggregate":
            sort_by = metrics[0].output_name

        return qe.QueryPlan(
            group_by=list(plan.group_by),
            metrics=metrics,
            filters=[qe.Filter(column=f.column, op=f.op, value=f.value) for f in plan.filters],
            time_grain=plan.time_grain,
            sort_by=sort_by,
            sort_desc=plan.sort_desc,
            limit=plan.limit,
            include_others=plan.limit >= 10 and plan.intent == "aggregate",
        )

    # --- Narration --------------------------------------------------------

    async def _narrate(
        self,
        question: str,
        plan: qe.QueryPlan,
        result: qe.QueryResult,
        analysis: dict[str, Any],
        types: dict[str, str],
    ) -> dict[str, Any]:
        deterministic = self._template_answer(plan, result, types)

        if not self.provider.available:
            return {"answer": deterministic, "follow_ups": [], "source": "deterministic"}

        try:
            facts = ctx.answer_facts(question, plan.model_dump(), result.to_dict(), analysis)
            response = await self.provider.complete(
                system=prompts.NARRATOR_SYSTEM,
                user=prompts.narrator_user_prompt(question, facts),
                temperature=0.2,
                max_tokens=900,
            )
            narration = parse_structured(response.text, AnswerNarration)
            if narration.answer.strip():
                return {
                    "answer": narration.answer.strip(),
                    "follow_ups": narration.follow_up_questions,
                    "source": f"llm:{self.provider.name}",
                }
        except (LLMUnavailable, ValueError) as exc:
            logger.warning("Narração via LLM falhou (%s); usando modelo determinístico.", exc)
        return {"answer": deterministic, "follow_ups": [], "source": "deterministic"}

    def _template_answer(
        self, plan: qe.QueryPlan, result: qe.QueryResult, types: dict[str, str]
    ) -> str:
        """Compose an answer from the result rows with no model involved."""
        rows = result.rows
        if not rows:
            return "Nenhum registro corresponde aos critérios informados."

        metric_name = result.columns[-1] if result.columns else "valor"
        agg = plan.metrics[0].agg if plan.metrics else "sum"
        if agg in {"count", "nunique"}:
            stype = sem.INTEGER
        else:
            stype = types.get(metric_name, sem.FLOAT)

        agg_label = {
            "sum": "soma", "mean": "média", "median": "mediana", "count": "contagem",
            "min": "mínimo", "max": "máximo", "nunique": "valores distintos", "std": "desvio padrão",
        }.get(agg, agg)

        if not plan.group_by:
            value = rows[0].get(metric_name)
            return (
                f"{sem.humanize(metric_name)}: "
                f"{insights_mod._fmt(value, stype)} ({agg_label})."
            )

        group_col = result.columns[0]
        top = rows[0]
        label = sem.humanize(metric_name).lower()
        superlative = "maior" if plan.sort_desc else "menor"

        parts = [
            f"“{top.get(group_col)}” tem o {superlative} {label}: "
            f"{insights_mod._fmt(top.get(metric_name), stype)}."
        ]
        if len(rows) > 1:
            runners = ", ".join(
                f"{r.get(group_col)} ({insights_mod._fmt(r.get(metric_name), stype)})"
                for r in rows[1:4]
            )
            parts.append(f"Na sequência: {runners}.")

        total_groups = result.row_count
        # A question like "which month was highest?" asks for one row on
        # purpose; reporting it as a truncation would read as a limitation.
        asked_for_one = plan.limit == 1
        if total_groups > len(rows) and not asked_for_one:
            parts.append(f"Foram encontrados {total_groups} grupos no total.")
        elif asked_for_one and total_groups > 1:
            parts.append(f"Comparado com outros {total_groups - 1} períodos ou categorias.")

        if not asked_for_one:
            parts.extend(result.notes)
        return " ".join(parts)

    # --- Analysis-backed intents ------------------------------------------

    def _answer_from_analysis(
        self,
        plan: AnalystPlan,
        profile: dict[str, Any],
        analysis: dict[str, Any],
        source: str,
    ) -> AnalystAnswer:
        intent = plan.intent
        follow_ups = list(analysis["domain"].get("suggested_questions", []))[:3]

        if intent == "quality":
            quality = analysis["quality"]
            issues = quality["issues"][:4]
            body = [
                f"A qualidade deste conjunto de dados está em {quality['score']}/100 "
                f"({quality['label']})."
            ]
            if issues:
                body.append("Principais problemas encontrados:")
                for issue in issues:
                    body.append(f"• {issue['title']} — {issue['recommendation']}")
            else:
                body.append("Nenhum problema relevante foi detectado.")
            return AnalystAnswer(
                answer="\n".join(body), intent=intent, plan=plan.model_dump(),
                result={"quality": quality}, chart=None, follow_ups=follow_ups, source=source,
            )

        if intent == "outliers":
            outlier_columns = []
            for col in profile["columns"]:
                out = (col.get("stats") or {}).get("outliers") or {}
                if out.get("count", 0) > 0:
                    outlier_columns.append((col, out))
            outlier_columns.sort(key=lambda p: p[1]["ratio"], reverse=True)

            if not outlier_columns:
                return AnalystAnswer(
                    answer="Nenhum valor fora do padrão foi detectado nas colunas numéricas "
                    "(método das cercas de Tukey, 1,5 × IQR).",
                    intent=intent, plan=plan.model_dump(), result=None, chart=None,
                    follow_ups=follow_ups, source=source,
                )
            lines = ["Valores fora do padrão identificados (cercas de Tukey, 1,5 × IQR):"]
            for col, out in outlier_columns[:4]:
                stype = col["semantic_type"]
                examples = ", ".join(insights_mod._fmt(v, stype) for v in out["examples"][:3])
                lines.append(
                    f"• {sem.humanize(col['name'])}: {out['count']} valores "
                    f"({out['ratio']:.1%}) fora da faixa "
                    f"{insights_mod._fmt(out['lower_bound'], stype)} – "
                    f"{insights_mod._fmt(out['upper_bound'], stype)}. Exemplos: {examples}."
                )
            return AnalystAnswer(
                answer="\n".join(lines), intent=intent, plan=plan.model_dump(),
                result={"outliers": [{"column": c["name"], **o} for c, o in outlier_columns[:6]]},
                chart=None, follow_ups=follow_ups, source=source,
            )

        if intent == "correlation":
            pairs = analysis.get("correlations", {}).get("pairs", [])
            requested = [m.column for m in plan.metrics if m.column]
            if len(requested) == 2:
                target = {requested[0], requested[1]}
                pairs = [p for p in pairs if {p["x"], p["y"]} == target] or pairs
            if not pairs:
                return AnalystAnswer(
                    answer="Não foram encontradas correlações relevantes (|r| ≥ 0,3) entre as "
                    "colunas numéricas deste conjunto de dados.",
                    intent=intent, plan=plan.model_dump(), result=None, chart=None,
                    follow_ups=follow_ups, source=source,
                )
            lines = ["Correlações mais relevantes encontradas:"]
            for pair in pairs[:4]:
                method = "ρ (Spearman)" if pair.get("method") == "spearman" else "r (Pearson)"
                lines.append(
                    f"• {sem.humanize(pair['x'])} × {sem.humanize(pair['y'])}: "
                    f"{method} = {pair['coefficient']:+.2f} (correlação {pair['strength']}, "
                    f"{pair['sample_size']} registros)."
                    + (
                        " Pearson está distorcido por valores extremos nesta coluna."
                        if pair.get("outlier_sensitive")
                        else ""
                    )
                )
            lines.append("Correlação não implica causalidade.")
            top = pairs[0]
            chart = {
                "chart_type": "scatter",
                "title": f"Relação entre {sem.humanize(top['x'])} e {sem.humanize(top['y'])}",
                "subtitle": f"Correlação {top['strength']} ({top['coefficient']:+.2f})",
                "encoding": {"x": top["x"], "y": top["y"], "agg": "none"},
                "options": {"show_regression": True},
            }
            return AnalystAnswer(
                answer="\n".join(lines), intent=intent, plan=plan.model_dump(),
                result={"correlations": pairs[:6]}, chart=chart,
                follow_ups=follow_ups, source=source,
            )

        if intent == "distribution":
            target = next((m.column for m in plan.metrics if m.column), None)
            column = next(
                (c for c in profile["columns"] if c["name"] == target),
                None,
            )
            if column is None or not (column.get("stats") or {}).get("histogram"):
                return AnalystAnswer(
                    answer="Não há uma coluna numérica adequada para montar a distribuição.",
                    intent=intent, plan=plan.model_dump(), result=None, chart=None,
                    follow_ups=follow_ups, source=source,
                )
            col_stats = column["stats"]
            stype = column["semantic_type"]
            histogram = col_stats["histogram"]
            answer = (
                f"A distribuição de {sem.humanize(column['name'])} tem mediana "
                f"{insights_mod._fmt(col_stats.get('median'), stype)} e média "
                f"{insights_mod._fmt(col_stats.get('mean'), stype)}, variando de "
                f"{insights_mod._fmt(col_stats.get('min'), stype)} a "
                f"{insights_mod._fmt(col_stats.get('max'), stype)}. "
                f"O intervalo interquartil vai de "
                f"{insights_mod._fmt(col_stats.get('q1'), stype)} a "
                f"{insights_mod._fmt(col_stats.get('q3'), stype)}."
            )
            skew = col_stats.get("skewness")
            if skew is not None and abs(skew) > 0.6:
                answer += (
                    f" A assimetria é {skew:+.2f}, ou seja, a cauda se estende "
                    f"{'à direita' if skew > 0 else 'à esquerda'}; use a mediana como "
                    "valor típico."
                )
            chart = {
                "chart_type": "histogram",
                "title": f"Distribuição de {sem.humanize(column['name'])}",
                "subtitle": f"{col_stats.get('count', 0)} valores em {len(histogram)} faixas",
                "encoding": {"x": column["name"], "y": "count", "agg": "count"},
                "inline_data": {
                    "columns": ["label", "count"],
                    "rows": [{"label": b["label"], "count": b["count"]} for b in histogram],
                },
                "source": "ai_analyst",
            }
            return AnalystAnswer(
                answer=answer, intent=intent, plan=plan.model_dump(),
                result={"statistics": {k: v for k, v in col_stats.items() if k != "histogram"}},
                chart=chart, follow_ups=follow_ups, source=source,
            )

        # overview
        top_insights = analysis.get("insights", [])[:5]
        lines = [
            f"Este conjunto tem {profile['overview']['row_count']:,} registros e "
            f"{profile['overview']['column_count']} colunas".replace(",", ".")
            + f", classificado como {analysis['domain']['label'].lower()}."
        ]
        if top_insights:
            lines.append("Principais achados:")
            for item in top_insights:
                lines.append(f"• {item['title']} — {item['description']}")
        return AnalystAnswer(
            answer="\n".join(lines), intent="overview", plan=plan.model_dump(),
            result={"insights": top_insights}, chart=None,
            follow_ups=follow_ups, source=source,
        )

    # --- Chart construction ----------------------------------------------

    def _build_chart(
        self,
        plan: AnalystPlan,
        query_plan: qe.QueryPlan,
        result: qe.QueryResult,
    ) -> dict[str, Any] | None:
        if plan.chart_type in (None, "none") or not result.rows:
            return None
        # When the answer is one value, that value *is* the chart — a lone bar
        # carries no comparison and only spends space.
        if len(result.rows) == 1:
            chart_type = "kpi"
        else:
            chart_type = plan.chart_type

        x = result.columns[0] if result.columns else None
        y = result.columns[-1] if len(result.columns) > 1 else result.columns[0]

        # A bar chart with too many categories is unreadable; switch to a table.
        if chart_type in {"bar", "bar_horizontal", "donut", "pie"} and len(result.rows) > 40:
            chart_type = "table"

        title = plan.chart_title or (
            f"{sem.humanize(y)} por {sem.humanize(x).lower()}" if x != y else sem.humanize(y)
        )
        return {
            "chart_type": chart_type,
            "title": title[:120],
            "subtitle": plan.reasoning[:160] if plan.reasoning else "",
            "encoding": {
                "x": x,
                "y": y,
                "agg": query_plan.metrics[0].agg if query_plan.metrics else "sum",
                "time_grain": query_plan.time_grain,
                "limit": query_plan.limit,
            },
            "inline_data": {
                "columns": result.columns,
                "rows": result.rows[:_MAX_CHART_ROWS],
            },
            "source": "ai_analyst",
        }

    # --- Dashboard narrative & curation ----------------------------------

    async def summarise_dashboard(
        self, profile: dict[str, Any], analysis: dict[str, Any]
    ) -> dict[str, Any]:
        """Executive summary. Falls back to a composed version of real insights."""
        deterministic = self._template_summary(profile, analysis)
        if not self.provider.available:
            return deterministic

        try:
            facts = ctx.dataset_facts(profile, analysis)
            response = await self.provider.complete(
                system=prompts.SUMMARY_SYSTEM,
                user=prompts.summary_user_prompt(facts),
                temperature=0.3,
                max_tokens=1400,
            )
            narrative = parse_structured(response.text, DashboardNarrative)
            return {
                "headline": narrative.headline,
                "summary": narrative.summary,
                "sections": [s.model_dump() for s in narrative.sections],
                "watch_items": narrative.watch_items,
                "source": f"llm:{self.provider.name}",
            }
        except (LLMUnavailable, ValueError) as exc:
            logger.warning("Resumo via LLM falhou (%s); usando resumo determinístico.", exc)
            return deterministic

    def _template_summary(
        self, profile: dict[str, Any], analysis: dict[str, Any]
    ) -> dict[str, Any]:
        insights = analysis.get("insights", [])
        overview = profile["overview"]
        domain = analysis["domain"]
        quality = analysis["quality"]

        headline = insights[0]["title"] if insights else "Análise concluída"
        summary_parts = [
            f"Analisamos {overview['row_count']:,} registros".replace(",", ".")
            + f" em {overview['column_count']} colunas"
            + (
                f", identificadas como dados de {domain['label'].lower()}."
                if domain["key"] != "generic"
                else "."
            )
        ]
        if insights:
            summary_parts.append(insights[0]["description"])
        summary_parts.append(
            f"A qualidade dos dados foi avaliada em {quality['score']}/100 "
            f"({quality['label'].lower()})."
        )

        sections = [
            {"heading": item["title"], "body": item["description"]}
            for item in insights[1:4]
        ]
        watch_items = [
            issue["title"] for issue in quality["issues"][:3]
        ] or [item["title"] for item in insights[:3]]

        return {
            "headline": headline,
            "summary": " ".join(summary_parts),
            "sections": sections,
            "watch_items": watch_items,
            "source": "deterministic",
        }

    async def curate_dashboard(
        self,
        recommendations: list[dict[str, Any]],
        profile: dict[str, Any],
        analysis: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """Let the model prune and order charts. Structure stays engine-owned."""
        meta = {
            "title": self._default_title(analysis),
            "subtitle": self._default_subtitle(profile, analysis),
            "source": "deterministic",
        }
        if not self.provider.available or not recommendations:
            return recommendations, meta

        try:
            candidates = [
                {
                    "index": i,
                    "chart_type": r["chart_type"],
                    "title": r["title"],
                    "columns": r["columns"],
                    "principle": r["principle"],
                    "rationale": r["rationale"][:280],
                    "engine_score": r["score"],
                }
                for i, r in enumerate(recommendations)
            ]
            facts = ctx.dataset_facts(profile, analysis)
            response = await self.provider.complete(
                system=prompts.CURATOR_SYSTEM,
                user=prompts.curator_user_prompt(candidates, facts),
                temperature=0.2,
                max_tokens=1600,
            )
            curation = parse_structured(response.text, DashboardCuration)

            decisions = {w.index: w for w in curation.widgets if 0 <= w.index < len(recommendations)}
            if not decisions:
                return recommendations, meta

            curated: list[dict[str, Any]] = []
            for index, rec in enumerate(recommendations):
                decision = decisions.get(index)
                if decision is not None and not decision.keep:
                    continue
                item = dict(rec)
                if decision is not None:
                    if decision.title:
                        item["title"] = decision.title
                    if decision.subtitle:
                        item["subtitle"] = decision.subtitle
                    item["curation_priority"] = decision.priority
                else:
                    item["curation_priority"] = int(rec["score"] * 50)
                curated.append(item)

            # Never let curation empty the dashboard.
            if len(curated) < 3:
                return recommendations, meta

            curated.sort(key=lambda c: c.get("curation_priority", 0), reverse=True)
            meta = {
                "title": curation.dashboard_title or meta["title"],
                "subtitle": curation.dashboard_subtitle or meta["subtitle"],
                "source": f"llm:{self.provider.name}",
            }
            return curated, meta
        except (LLMUnavailable, ValueError) as exc:
            logger.warning("Curadoria via LLM falhou (%s); mantendo ordem do motor.", exc)
            return recommendations, meta

    def _default_title(self, analysis: dict[str, Any]) -> str:
        domain = analysis["domain"]
        if domain["key"] != "generic":
            return f"Dashboard de {domain['label']}"
        return "Dashboard analítico"

    def _default_subtitle(self, profile: dict[str, Any], analysis: dict[str, Any]) -> str:
        overview = profile["overview"]
        pieces = [f"{overview['row_count']:,} registros".replace(",", ".")]
        temporal = analysis["columns"]["temporal"]
        if temporal and analysis.get("trends"):
            trend = analysis["trends"][0]
            pieces.append(f"{trend['points'][0]['label']} – {trend['points'][-1]['label']}")
        pieces.append(f"qualidade {analysis['quality']['score']}/100")
        return " · ".join(pieces)
