'use client';

import { useId, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Download, Lightbulb, Plus, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { EChart } from '@/components/charts/EChart';
import { DataTable } from '@/components/charts/DataTable';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChartSkeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Controls';
import { api, ApiError } from '@/lib/api';
import { buildChartOption } from '@/lib/chart-options';
import { exportRowsToCsv } from '@/lib/export';
import { useDataset } from '@/hooks/useDataset';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import {
  AGGREGATION_LABELS, TIME_GRAIN_LABELS, humanize,
} from '@/lib/format';
import type { Aggregation, ChartType, ExploreFilter, TimeGrain } from '@/types/api';

const CHART_LABELS: Record<string, string> = {
  line: 'Linha', area: 'Área', bar: 'Barras', bar_horizontal: 'Barras horizontais',
  stacked_bar: 'Empilhadas', scatter: 'Dispersão', donut: 'Rosca', pie: 'Pizza',
  histogram: 'Histograma', box_plot: 'Box plot', heatmap: 'Mapa de calor',
  treemap: 'Treemap', radar: 'Radar', funnel: 'Funil', table: 'Tabela',
};

interface FilterDraft extends ExploreFilter {
  key: string;
}

export default function ExplorePage() {
  const params = useParams<{ id: string }>();
  const { data: dataset } = useDataset(params.id);
  const { mode } = useTheme();

  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [series, setSeries] = useState('');
  const [agg, setAgg] = useState<Aggregation>('sum');
  const [grain, setGrain] = useState<TimeGrain>('month');
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [limit, setLimit] = useState(20);
  const [sortDesc, setSortDesc] = useState(true);
  const [filters, setFilters] = useState<FilterDraft[]>([]);
  const [autoChart, setAutoChart] = useState(true);

  const fields = useQuery({
    queryKey: ['explore-fields', params.id],
    queryFn: () => api.explore.fields(params.id),
    enabled: Boolean(params.id),
    staleTime: 15 * 60_000,
  });

  const columnProfiles = useMemo(() => dataset?.profile.columns ?? [], [dataset]);
  const xIsTemporal = columnProfiles.find((column) => column.name === x)?.role === 'temporal';

  const requestBody = useMemo(
    () => ({
      x: x || null,
      y: y || null,
      series: series || null,
      agg,
      time_grain: xIsTemporal ? grain : null,
      filters: filters
        .filter((filter) => filter.column && filter.value !== '' && filter.value !== null)
        .map(({ key, ...rest }) => rest),
      sort_desc: sortDesc,
      limit,
      chart_type: chartType,
    }),
    [x, y, series, agg, grain, xIsTemporal, filters, sortDesc, limit, chartType],
  );

  const result = useQuery({
    queryKey: ['explore', params.id, requestBody],
    queryFn: () => api.explore.run(params.id, requestBody),
    enabled: Boolean(params.id) && Boolean(x || y),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });

  // The suggestion is advisory: it updates the chart type only while the user
  // has not overridden it.
  const effectiveChartType = autoChart && result.data ? result.data.suggested_chart : chartType;

  const option = useMemo(() => {
    if (!result.data || result.data.rows.length === 0) return null;
    const profile = columnProfiles.find((column) => column.name === y);
    return buildChartOption({
      mode,
      chartType: effectiveChartType,
      data: result.data,
      encoding: { x: x || null, y: y || null, series: series || null, agg },
      style: { showLegend: true, showGrid: true },
      valueFormat:
        agg === 'count'
          ? 'integer'
          : profile?.semantic_type === 'currency'
            ? 'currency'
            : profile?.semantic_type === 'percentage'
              ? 'percent'
              : 'decimal',
    });
  }, [result.data, mode, effectiveChartType, x, y, series, agg, columnProfiles]);

  if (!dataset || !fields.data) {
    return (
      <div className="p-6">
        <ChartSkeleton className="h-96" />
      </div>
    );
  }

  const datasetName = dataset.name;

  const fieldOptions = (names: string[]) =>
    names.map((name) => ({ value: name, label: humanize(name) }));

  const dimensionOptions = fieldOptions([...fields.data.temporal, ...fields.data.dimensions]);
  const metricOptions = fieldOptions(fields.data.metrics);

  function addFilter() {
    const first = fields.data?.columns[0];
    if (!first) return;
    setFilters((current) => [
      ...current,
      { key: `${Date.now()}`, column: first.name, op: 'eq', value: '' },
    ]);
  }

  function handleExport() {
    if (!result.data) return;
    exportRowsToCsv(result.data.columns, result.data.rows, `explore-${datasetName}`);
    toast.success('CSV exportado.');
  }

  return (
    <div className="flex flex-col lg:flex-row">
      <aside className="shrink-0 border-b border-line bg-surface/40 p-4 lg:w-[19rem] lg:border-b-0 lg:border-r">
        <div className="mb-4">
          <p className="eyebrow text-ink-subtle">Consulta</p>
          <h2 className="mt-1 text-base font-semibold tracking-[-0.01em]">Explore</h2>
        </div>

        {/*
          Nine controls at one visual weight read as a list of nine equally
          important decisions. They are not: the query is chosen first, its
          form second, its slice third. The groups say so.
        */}
        <div className="space-y-5">
          <ControlGroup title="Dados">
            <Select
              label="Eixo X / Dimensão"
              value={x}
              placeholder="Selecione"
              options={effectiveChartType === 'scatter' ? metricOptions : dimensionOptions}
              onChange={(event) => setX(event.target.value)}
            />

            <Select
              label="Eixo Y / Métrica"
              value={y}
              placeholder="Contagem de registros"
              options={metricOptions}
              onChange={(event) => {
                setY(event.target.value);
                const field = fields.data?.columns.find((column) => column.name === event.target.value);
                // Follow the column's own additivity so the default never sums a
                // unit price or a rate.
                if (field?.default_agg) setAgg(field.default_agg);
              }}
            />

            <Select
              label="Série / Segmentação"
              value={series}
              placeholder="Nenhuma"
              options={fieldOptions(fields.data.dimensions)}
              onChange={(event) => setSeries(event.target.value)}
            />

            <Select
              label="Agregação"
              value={agg}
              options={fields.data.aggregations.map((value) => ({
                value,
                label: AGGREGATION_LABELS[value] ?? value,
              }))}
              onChange={(event) => setAgg(event.target.value as Aggregation)}
            />

            {xIsTemporal && (
              <Select
                label="Granularidade"
                value={grain}
                options={Object.entries(TIME_GRAIN_LABELS).map(([value, label]) => ({ value, label }))}
                onChange={(event) => setGrain(event.target.value as TimeGrain)}
              />
            )}
          </ControlGroup>

          <ControlGroup title="Forma" defaultCollapsed>
            <Select
              label="Tipo de gráfico"
              value={effectiveChartType}
              options={fields.data.chart_types.map((value) => ({
                value,
                label: CHART_LABELS[value] ?? value,
              }))}
              onChange={(event) => {
                setAutoChart(false);
                setChartType(event.target.value as ChartType);
              }}
            />

            <Switch
              label="Sugerir automaticamente"
              description="Escolhe o tipo a partir dos campos selecionados."
              checked={autoChart}
              onChange={setAutoChart}
            />
          </ControlGroup>

          <ControlGroup title="Recorte" defaultCollapsed>
            <Input
              label="Limite de resultados"
              type="number"
              min={3}
              max={500}
              value={limit}
              onChange={(event) => setLimit(Math.max(3, Math.min(500, Number(event.target.value) || 20)))}
            />

            <Switch label="Ordem decrescente" checked={sortDesc} onChange={setSortDesc} />
          </ControlGroup>

          <ControlGroup
            title="Filtros"
            action={
              <Button size="xs" variant="ghost" icon={<Plus className="h-3 w-3" />} onClick={addFilter}>
                Adicionar
              </Button>
            }
          >
            {filters.length === 0 ? (
              <p className="text-xs leading-relaxed text-ink-subtle">
                Nenhum filtro. A consulta considera todas as linhas.
              </p>
            ) : (
              filters.map((filter, index) => (
                <div key={filter.key} className="rounded-md border border-line bg-surface p-2">
                  <div className="mb-1.5 flex items-center justify-between gap-1">
                    <select
                      value={filter.column}
                      aria-label="Coluna do filtro"
                      onChange={(event) =>
                        setFilters((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, column: event.target.value } : item,
                          ),
                        )
                      }
                      className="min-w-0 flex-1 truncate bg-transparent text-xs font-medium outline-none"
                    >
                      {fields.data!.columns.map((column) => (
                        <option key={column.name} value={column.name}>
                          {humanize(column.name)}
                        </option>
                      ))}
                    </select>
                    <IconButton
                      label="Remover filtro"
                      size="xs"
                      onClick={() => setFilters((current) => current.filter((_, i) => i !== index))}
                    >
                      <X className="h-3 w-3" />
                    </IconButton>
                  </div>
                  <div className="flex gap-1">
                    <select
                      value={filter.op}
                      aria-label="Operador do filtro"
                      onChange={(event) =>
                        setFilters((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, op: event.target.value as ExploreFilter['op'] } : item,
                          ),
                        )
                      }
                      className="w-20 rounded-sm border border-line bg-surface-sunken px-1 text-2xs outline-none"
                    >
                      <option value="eq">=</option>
                      <option value="neq">≠</option>
                      <option value="gt">&gt;</option>
                      <option value="gte">≥</option>
                      <option value="lt">&lt;</option>
                      <option value="lte">≤</option>
                      <option value="contains">contém</option>
                    </select>
                    <input
                      value={String(filter.value ?? '')}
                      aria-label="Valor do filtro"
                      onChange={(event) =>
                        setFilters((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, value: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder="valor"
                      className="min-w-0 flex-1 rounded-sm border border-line bg-surface-sunken px-1.5 py-1 text-2xs outline-none focus:border-primary"
                    />
                  </div>
                </div>
              ))
            )}
          </ControlGroup>
        </div>
      </aside>

      <section className="min-w-0 flex-1 p-4 sm:p-6" aria-label="Resultado da exploração">
        {!x && !y ? (
          <EmptyState
            icon={<Sparkles className="h-5 w-5" />}
            title="Monte sua própria visualização"
            description="Escolha uma dimensão e uma métrica à esquerda. O tipo de gráfico é sugerido automaticamente a partir dos campos."
            className="explore-canvas rounded-lg border border-dashed border-line"
          />
        ) : result.isError ? (
          <EmptyState
            title="Não foi possível executar a consulta"
            description={
              result.error instanceof ApiError ? result.error.message : 'Erro inesperado.'
            }
            className="explore-canvas rounded-lg border border-dashed border-line"
          />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="primary">{CHART_LABELS[effectiveChartType] ?? effectiveChartType}</Badge>
                {result.data && (
                  <Badge tone="neutral">
                    {result.data.row_count} {result.data.row_count === 1 ? 'grupo' : 'grupos'}
                  </Badge>
                )}
                {result.data?.truncated && <Badge tone="warning">Resultado truncado</Badge>}
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Download className="h-3.5 w-3.5" />}
                disabled={!result.data || result.data.rows.length === 0}
                onClick={handleExport}
              >
                Exportar CSV
              </Button>
            </div>

            {result.data?.rationale && autoChart && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-line bg-surface-sunken p-3">
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <p className="text-xs leading-relaxed text-ink-muted">{result.data.rationale}</p>
              </div>
            )}

            <Card className="flex flex-col p-4">
              {result.isFetching && !result.data ? (
                <ChartSkeleton className="explore-canvas w-full" />
              ) : !result.data || result.data.rows.length === 0 ? (
                <EmptyState
                  compact
                  title="Sem resultados"
                  description="Nenhum registro atende à combinação de campos e filtros."
                  className="explore-canvas"
                />
              ) : effectiveChartType === 'table' ? (
                <div className="explore-canvas">
                  <DataTable
                    columns={result.data.columns}
                    rows={result.data.rows}
                    columnProfiles={columnProfiles}
                    maxHeight="fill"
                  />
                </div>
              ) : (
                option && (
                  <div className="explore-canvas">
                    <EChart option={option} resetKey={`${effectiveChartType}-${x}-${y}-${series}`} />
                  </div>
                )
              )}

              {result.data && result.data.notes.length > 0 && (
                <p className="mt-2 text-2xs text-ink-subtle">{result.data.notes.join(' ')}</p>
              )}
            </Card>

            {result.data && result.data.rows.length > 0 && effectiveChartType !== 'table' && (
              <Card className="mt-4 p-4">
                <p className="mb-2.5 text-[13px] font-medium text-ink-muted">Dados da consulta</p>
                <DataTable
                  columns={result.data.columns}
                  rows={result.data.rows}
                  columnProfiles={columnProfiles}
                  maxHeight={280}
                />
              </Card>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/**
 * A titled band of related controls.
 *
 * Grouping is the whole point: the sidebar asks for the query first, its form
 * second and its slice third, and a reader should be able to see that order
 * without reading every label. On a narrow viewport the sidebar becomes a
 * banner above the canvas, so the fields lay out in columns rather than one
 * tall stack that pushes the chart off the screen.
 */
function ControlGroup({
  title,
  action,
  defaultCollapsed = false,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  /** Whether the group starts folded away on a narrow viewport. */
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const id = useId();

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={id}
          onClick={() => setCollapsed((value) => !value)}
          className="flex min-w-0 items-center gap-1.5 text-left lg:pointer-events-none"
        >
          <ChevronDown
            className={cn(
              'h-3 w-3 shrink-0 text-ink-subtle transition-transform duration-150 lg:hidden',
              collapsed && '-rotate-90',
            )}
            aria-hidden
          />
          <span className="mono-label text-[10px] text-ink-subtle">{title}</span>
        </button>
        {action}
      </div>
      <div className="rule-dashed mb-3 mt-1.5 opacity-70" />
      <div
        id={id}
        className={cn(
          'grid gap-3 sm:grid-cols-2 lg:grid-cols-1',
          // Folded only on the narrow layout, where the sidebar stacks above the
          // canvas and an unfolded column of nine fields would push the chart a
          // full screen down. The desktop rail always shows everything.
          collapsed && 'max-lg:hidden',
        )}
      >
        {children}
      </div>
    </section>
  );
}
