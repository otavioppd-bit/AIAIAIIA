'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Activity, GitCompare, Layers, TrendingDown, TrendingUp } from 'lucide-react';
import { ChartRenderer } from '@/components/charts/ChartRenderer';
import { InsightCard } from '@/components/charts/InsightCard';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tabs } from '@/components/ui/Tabs';
import { useDataset } from '@/hooks/useDataset';
import { formatDelta, formatValue, humanize, formatInteger } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Trend } from '@/types/api';

export default function AnalyticsPage() {
  const params = useParams<{ id: string }>();
  const { data: dataset } = useDataset(params.id);
  const [tab, setTab] = useState('trends');

  const analysis = dataset?.analysis;
  // A fresh [] on every render would invalidate every downstream memo.
  const columnProfiles = useMemo(() => dataset?.profile.columns ?? [], [dataset]);

  const semanticByColumn = useMemo(() => {
    const map = new Map<string, string>();
    columnProfiles.forEach((column) => map.set(column.name, column.semantic_type));
    return map;
  }, [columnProfiles]);

  if (!dataset || !analysis) return null;

  const tabs = [
    { id: 'trends', label: 'Tendências', count: analysis.trends.length },
    { id: 'correlations', label: 'Correlações', count: analysis.correlations.pairs.length },
    { id: 'breakdowns', label: 'Segmentações', count: analysis.breakdowns.length },
    { id: 'insights', label: 'Insights', count: analysis.insights.length },
  ];

  return (
    <div className="p-4 sm:p-6">
      <header className="mb-5">
        <h2 className="text-xl font-semibold tracking-[-0.02em]">Analytics</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Cada número abaixo foi calculado sobre {formatInteger(dataset.row_count)} registros do seu
          arquivo.
        </p>
      </header>

      <Tabs items={tabs} value={tab} onChange={setTab} className="mb-5" />

      {tab === 'trends' && (
        <section className="space-y-4">
          {analysis.trends.length === 0 ? (
            <EmptyState
              icon={<Activity className="h-5 w-5" />}
              title="Nenhuma série temporal disponível"
              description="Não foi identificada uma coluna de data com períodos suficientes para calcular tendências."
              className="rounded-lg border border-dashed border-line"
            />
          ) : (
            analysis.trends.map((trend) => (
              <TrendCard
                key={`${trend.date_column}-${trend.metric_column}`}
                trend={trend}
                datasetId={dataset.id}
                semanticType={semanticByColumn.get(trend.metric_column)}
                columnProfiles={columnProfiles}
              />
            ))
          )}

          {analysis.anomalies.length > 0 && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Variações atípicas</CardTitle>
                  <CardDescription>
                    Períodos cuja variação está a mais de 2 desvios-padrão da variação típica da série.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {analysis.anomalies.map((anomaly, index) => (
                  <div
                    key={`${anomaly.metric_column}-${anomaly.period}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-sunken p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">
                        {humanize(anomaly.metric_column)} · {anomaly.period}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {formatValue(anomaly.previous_value, 'auto', {
                          semanticType: semanticByColumn.get(anomaly.metric_column) as never,
                        })}{' '}
                        em {anomaly.previous_period} →{' '}
                        {formatValue(anomaly.value, 'auto', {
                          semanticType: semanticByColumn.get(anomaly.metric_column) as never,
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={anomaly.change_pct < 0 ? 'negative' : 'positive'}>
                        {formatDelta(anomaly.change_pct)}
                      </Badge>
                      <span className="text-2xs tabular-nums text-ink-subtle">
                        z = {anomaly.z_score.toFixed(1)}
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {tab === 'correlations' && (
        <section className="space-y-4">
          {analysis.correlations.pairs.length === 0 ? (
            <EmptyState
              icon={<GitCompare className="h-5 w-5" />}
              title="Nenhuma correlação relevante"
              description="Não há pares de colunas numéricas com coeficiente igual ou superior a 0,30."
              className="rounded-lg border border-dashed border-line"
            />
          ) : (
            <>
              {analysis.correlations.columns.length >= 4 && (
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle>Matriz de correlação</CardTitle>
                      <CardDescription>
                        Escala divergente: azul para relação positiva, vermelho para negativa,
                        cinza neutro no meio.
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80">
                      <ChartRenderer
                        datasetId={dataset.id}
                        chartType="heatmap"
                        encoding={{ matrix: 'correlation' }}
                        columnProfiles={columnProfiles}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-3 lg:grid-cols-2">
                {analysis.correlations.pairs.map((pair) => (
                  <Card key={`${pair.x}-${pair.y}`} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold">
                          {humanize(pair.x)} × {humanize(pair.y)}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-subtle">
                          {formatInteger(pair.sample_size)} registros comparáveis
                        </p>
                      </div>
                      <Badge tone={pair.direction === 'positive' ? 'positive' : 'negative'}>
                        {pair.coefficient > 0 ? '+' : ''}
                        {pair.coefficient.toFixed(2)}
                      </Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge tone="neutral">{pair.strength}</Badge>
                      <Badge tone="neutral">
                        {pair.method === 'spearman' ? 'Spearman (postos)' : 'Pearson (linear)'}
                      </Badge>
                      {pair.non_linear && <Badge tone="warning">Não linear</Badge>}
                    </div>

                    {pair.outlier_sensitive && (
                      <p className="mt-2.5 rounded-md bg-surface-sunken p-2 text-xs leading-relaxed text-ink-muted">
                        Pearson cai para {pair.pearson?.toFixed(2)} por efeito de valores extremos.
                        A leitura acima usa Spearman, que é baseado em postos e resistente a outliers.
                      </p>
                    )}

                    <div className="mt-3 h-44">
                      <ChartRenderer
                        datasetId={dataset.id}
                        chartType="scatter"
                        encoding={{ x: pair.x, y: pair.y, agg: 'none' }}
                        columnProfiles={columnProfiles}
                        showTableToggle={false}
                      />
                    </div>
                  </Card>
                ))}
              </div>

              <p className="text-center text-2xs text-ink-subtle">
                Correlação não implica causalidade.
              </p>
            </>
          )}
        </section>
      )}

      {tab === 'breakdowns' && (
        <section className="grid gap-4 lg:grid-cols-2">
          {analysis.breakdowns.length === 0 ? (
            <EmptyState
              icon={<Layers className="h-5 w-5" />}
              title="Nenhuma dimensão disponível"
              description="Não há colunas categóricas com cardinalidade adequada para segmentar."
              className="rounded-lg border border-dashed border-line lg:col-span-2"
            />
          ) : (
            analysis.breakdowns.map((breakdown) => (
              <Card key={`${breakdown.dimension}-${breakdown.metric}`}>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle className="truncate">
                      {breakdown.metric ? humanize(breakdown.metric) : 'Registros'} por{' '}
                      {humanize(breakdown.dimension).toLowerCase()}
                    </CardTitle>
                    <CardDescription>
                      {breakdown.distinct} valores distintos · os 3 maiores somam{' '}
                      {(breakdown.top3_share * 100).toFixed(0)}% do total
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ChartRenderer
                      datasetId={dataset.id}
                      chartType={breakdown.distinct > 6 ? 'bar_horizontal' : 'bar'}
                      encoding={{
                        x: breakdown.dimension,
                        y: breakdown.metric,
                        agg: breakdown.agg,
                        limit: 12,
                      }}
                      columnProfiles={columnProfiles}
                    />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </section>
      )}

      {tab === 'insights' && (
        <section className="grid gap-3 lg:grid-cols-2">
          {analysis.insights.map((insight, index) => (
            <InsightCard key={`${insight.kind}-${index}`} insight={insight} />
          ))}
        </section>
      )}
    </div>
  );
}

function TrendCard({
  trend,
  datasetId,
  semanticType,
  columnProfiles,
}: {
  trend: Trend;
  datasetId: string;
  semanticType?: string;
  columnProfiles: never[] | import('@/types/api').ColumnProfile[];
}) {
  const up = trend.direction === 'up';
  const flat = trend.direction === 'flat';
  const Icon = flat ? Activity : up ? TrendingUp : TrendingDown;

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="truncate">Evolução de {humanize(trend.metric_column)}</CardTitle>
          <CardDescription>
            {trend.periods} períodos · agregação {trend.agg === 'sum' ? 'soma' : 'média'} ·{' '}
            {trend.points[0]?.label} a {trend.points[trend.points.length - 1]?.label}
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-semibold tabular-nums',
              flat ? 'bg-surface-sunken text-ink-muted' : up ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {formatDelta(trend.change_pct)}
          </span>
        </div>
      </CardHeader>

      <CardContent>
        <div className="h-64">
          <ChartRenderer
            datasetId={datasetId}
            chartType="line"
            encoding={{
              x: trend.date_column,
              y: trend.metric_column,
              agg: trend.agg,
              time_grain: trend.grain,
              limit: 500,
            }}
            columnProfiles={columnProfiles}
          />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 sm:grid-cols-4">
          <Stat label="Início" value={formatValue(trend.first_value, 'auto', { semanticType: semanticType as never, compact: true })} />
          <Stat label="Fim" value={formatValue(trend.last_value, 'auto', { semanticType: semanticType as never, compact: true })} />
          <Stat
            label="Melhor período"
            value={trend.best_period?.label ?? '—'}
            hint={formatValue(trend.best_period?.value ?? null, 'auto', { semanticType: semanticType as never, compact: true })}
          />
          <Stat
            label="Ajuste linear (R²)"
            value={trend.r_squared !== null ? trend.r_squared.toFixed(2) : '—'}
            hint={
              trend.r_squared !== null && trend.r_squared > 0.5
                ? 'tendência consistente'
                : 'variação irregular'
            }
          />
        </dl>

        {/*
          The trimming note used to be repeated here. The chart above now
          reports it itself — the query engine drops the same partial period the
          trend statistics do — and one card should state a fact once.
        */}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-semibold tabular-nums" title={value}>
        {value}
      </dd>
      {hint && <p className="truncate text-2xs text-ink-subtle">{hint}</p>}
    </div>
  );
}
