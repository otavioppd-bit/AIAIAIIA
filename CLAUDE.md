# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Prisma Analytics: upload a CSV, get an automatically generated, fully editable dashboard. Backend is FastAPI + Pandas; frontend is Next.js 14 + TypeScript + ECharts. The full user-facing description and setup docs are in `README.md` — read that first for product framing, security posture, and known limitations.

## The one rule that shapes the whole codebase

**The LLM never produces a number.** A deterministic engine (`backend/app/services/`) computes everything — profiling, statistics, correlations, trends, outliers, quality score, and chart selection — before an LLM is ever consulted. The LLM layer (`backend/app/ai/`) receives only pre-computed facts and does three things: curate which charts appear, write narrative text, and translate a natural-language question into a validated query plan. It never sees raw rows and never executes anything from the CSV or from its own output.

Consequence: **the app is 100% functional with zero API keys configured** (`LLM_PROVIDER=heuristic` or no key set → `NullProvider`). Every LLM call site has a deterministic fallback — a rules-based NL parser (`app/ai/nl_query.py`) and templated narration — that must keep working. When touching `app/ai/analyst.py`, never remove or weaken a fallback path; test it via `NullProvider` (see `tests/test_ai_layer.py` for the pattern: a `FakeProvider` that returns malformed/hallucinated/failing responses, verifying the system degrades to rules rather than breaking).

## Commands

### Backend (`backend/`)
```bash
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                  # works with zero keys filled in

uvicorn app.main:app --reload --port 8000              # dev server, http://localhost:8000/docs

pytest -q                                               # full suite (83 tests)
pytest tests/test_analysis.py -q                        # one file
pytest tests/test_analysis.py::test_name -q              # one test
ruff check app tests                                     # lint (config in pyproject.toml)

alembic revision --autogenerate -m "description"          # after changing app/models/entities.py
alembic upgrade head                                       # non-SQLite only; SQLite auto-creates tables
```

### Frontend (`frontend/`)
```bash
npm install
cp .env.example .env.local                             # NEXT_PUBLIC_API_URL=http://localhost:8000

npm run dev                                              # http://localhost:3000
npm run typecheck                                        # tsc --noEmit
npm run lint                                              # next lint
npm test                                                  # node --test over tests/*.test.ts (chart-options, export escaping)
npm run build && npm start                                # then, with API running:
npm run e2e                                               # Playwright walkthrough, 30 checks (see e2e/walkthrough.mjs)
```

### Both at once
```bash
./scripts/dev.sh          # or: ./scripts/dev.sh api   /   ./scripts/dev.sh web
```

### CORS note for local dev
If port 3000 is taken, Next.js silently moves to 3001+, and the backend's `CORS_ORIGINS` in `backend/.env` must include that origin or every request fails preflight with 400. Default covers `:3000` on both `localhost`/`127.0.0.1` only.

## Backend architecture: the analysis pipeline

Everything flows through `app/services/analyzer.py::analyse_csv_bytes`, which chains, in order:

1. **`ingestion.py`** — sniffs encoding/delimiter, neutralizes formula-injection prefixes (`=`, `+`, `-`, `@`), drops empty columns.
2. **`semantics.py`** — infers each column's semantic type (`currency`, `percentage`, `datetime`, `geo`, `identifier`, …) and role (`metric`/`dimension`/`temporal`/`identity`/`free_text`). Also computes **additivity**: whether summing a column is meaningful. Name-based lexicons decide first (`valor_total` → additive, `preco_unitario` → not); when the name is ambiguous, `_distribution_shape()` breaks the tie — tight spread around a non-zero center (a measurement/reading) → mean; right-skewed or zero-heavy (a transactional amount) → sum. This `additive`/`default_agg` flag propagates everywhere downstream (KPIs, chart encodings, the widget editor's warning banner) — never hardcode `agg="sum"` for a column without checking it.
3. **`statistics.py`** — descriptives, Tukey-fence outliers, correlation (see below), and time-series trends. `resample_series` **trims partial boundary periods** (a half-finished month is dropped, not reported as a collapse) — this is load-bearing; don't remove it without understanding why (a real bug it fixed: 95% fake "declines" from incomplete final months).
4. **`domain.py`** — keyword-matches column names against domain lexicons (sales/finance/education/marketing/hr/operations/health) to pick a headline metric and suggested questions.
5. **`quality.py`** — five weighted dimensions → 0-100 score with actionable issues.
6. **`insights.py`** — turns the above into ranked, evidence-carrying findings (each insight embeds the columns and statistical method used — never invent a claim without that evidence trail).
7. **`recommender.py`** — the chart-selection engine. Each rule is grounded in a stated visualization principle (temporal → line, comparison → bar, part-of-whole with ≤6 parts → donut, etc.) and scored; `_deduplicate()` caps repetition and drops redundant chart-type/column-pair combos. **Never recommend a dual-Y-axis chart** — two different-scale metrics on one timeline are indexed to a common base (`normalize: "index_100"`, resolved in `widget_data._index_to_100`) instead of given a second axis; a second axis was flagged in review as fabricating a correlation.
8. **`query_engine.py`** — the only way data ever gets queried. `QueryPlan` is a declarative, Pydantic-validated structure (group-by, metrics, filters, time grain) checked against `SchemaGuard` (the dataset's real columns) before touching Pandas. **No `eval`, no dynamic code execution, anywhere** — this includes the LLM's query plans, which go through the identical validation as a human-typed Explore query.
9. **`dashboard_builder.py`** — assembles the widget layout (grid positions, KPI cards, narrative block, insights list, data table) from the recommendations + KPIs + narrative.

`app/services/widget_data.py` re-resolves a widget's data on every dashboard load (never caches computed rows in the stored spec) — a saved dashboard's *encoding* is persisted, not its numbers, so filters and re-uploads stay live.

## AI layer (`backend/app/ai/`)

- **`base.py` / `providers.py`** — `LLMProvider` interface with `AnthropicProvider`, `OpenAIProvider` (OpenAI-compatible endpoints), `NullProvider`. Swap providers here only; never let a provider-specific detail leak into `analyst.py`.
- **`nl_query.py`** — the deterministic question parser (pt-BR + en keyword matching, synonym expansion, superlative/ranking detection). This is what answers questions when no model is configured, and it's what the model's plan is validated *against* — see `analyst._plan_is_valid`, which rejects any LLM plan referencing a column that doesn't exist in the dataset before it ever reaches the query engine.
- **`analyst.py`** — orchestrates question → plan (LLM or rules) → `query_engine.execute()` → narration (LLM or template). Single-row results render as a stat tile (`chart_type="kpi"`), never a one-bar bar chart — a one-item chart has nothing to compare against.
- **`context.py`** — builds the compact fact-sheets sent to the model (`schema_context`, `dataset_facts`, `answer_facts`). These intentionally exclude raw records; check this file before adding any new LLM call site to make sure you're not accidentally forwarding row-level data.

## Frontend architecture

- **`lib/chart-options.ts`** — builds ECharts option objects for all 14 chart types from a `WidgetDataResponse` + encoding. Categorical color assignment uses `seedStable()` seeded from the column's full profiled domain (`colorDomain`, threaded from `ChartRenderer`) — **not** row order — so a color stays fixed to an entity across sorts/filters (a review-caught bug: seeding from visible rows repainted survivors when a filter changed the row set). All tooltip HTML interpolating file-derived text goes through `escapeHtml()` — ECharts renders tooltip-formatter return values as raw HTML, so an unescaped category label from an uploaded CSV is a stored-XSS vector (this was a real finding, verified by mutation testing in `tests/chart-options.test.ts`: removing the escape makes 7 tests fail).
- **`lib/palette.ts`** — the only categorical/sequential/diverging color source; validated against both theme surfaces for CVD-safety. Don't hand-pick hex values elsewhere.
- **`store/dashboardStore.ts`** — Zustand store with undo/redo for the dashboard editor. `load()` resets the undo stack and saved-baseline, so callers must **guard on dashboard id, not on the spec object** — a React Query refetch hands back a new object every time, and reloading on every render silently discards in-progress edits (see the `loadedDashboardId` ref pattern in `overview/page.tsx` and `customize/page.tsx`).
- **`hooks/useDataset.ts`** — `GET /dashboards` (list) returns `DashboardSummary` (no `spec` field, by design — specs can be large); the full `Dashboard` with `spec` is fetched separately by id via `usePrimaryDashboard`. Don't conflate the two types.
- **Three.js (`components/three/`)** is lazy-loaded (`LazyDataOrb` → dynamic `import()`) — never import `DataOrb`/`Scene` eagerly; it added ~220KB to every route that touched it.
- `lib/export.ts`'s CSV formula-injection guard distinguishes a hostile leading `=`/`+`/`-`/`@` from a legitimate negative number via a numeric-literal regex — don't simplify this to a blanket prefix check on `/^[+-]/`, it was a real bug (exported `-1234.5` as text).

## Testing conventions worth knowing

- Backend tests use a fresh SQLite temp DB per session (`tests/conftest.py`) and `LLM_PROVIDER=heuristic` — no network calls, no real model.
- `tests/test_ai_layer.py`'s `FakeProvider` pattern (canned JSON per system-prompt role, or a `fail=True` flag) is the template for testing any new LLM-dependent code path — always assert the deterministic fallback triggers correctly, not just the happy path.
- Frontend chart/export tests (`frontend/tests/*.test.ts`) run under plain `node --test`, not a framework — they import functions directly from `src/lib/`, including one that regex-extracts a function body out of `export.ts` source (see `loadEscape()` in `export.test.ts`) rather than importing the module, because the module pulls in browser-only helpers at import time.
- `e2e/walkthrough.mjs` is a single sequential script (not a test framework) that drives a real browser through register → upload → dashboard → edit → chat → explore → quality → theme switch → presentation mode → a hostile CSV fixture (`e2e/fixtures/hostil.csv`) checking XSS/formula-injection don't fire live. Requires both servers already running (`npm run build && npm start` for frontend, since dev-mode HMR can race the walkthrough).
