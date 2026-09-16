'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertCircle, AlertTriangle, CheckCircle2, Copy, Database,
  HardDrive, Info, Search, Table2,
} from 'lucide-react';
import { ChartRenderer } from '@/components/charts/ChartRenderer';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Progress } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/EmptyState';
import { useDataset } from '@/hooks/useDataset';
import {
  ROLE_LABELS, SEMANTIC_TYPE_LABELS, formatBytes, formatInteger,
  formatRatio, formatValue, humanize,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ColumnProfile, QualityIssue } from '@/types/api';

const SEVERITY_META: Record<QualityIssue['severity'], { tone: 'negative' | 'warning' | 'info' | 'neutral'; label: string }> = {
  critical: { tone: 'negative', label: 'Crítico' },
  high: { tone: 'negative', label: 'Alto' },
  medium: { tone: 'warning', label: 'Médio' },
  low: { tone: 'info', label: 'Baixo' },
};

export default function QualityPage() {
  const params = useParams<{ id: string }>();
  const { data: dataset } = useDataset(params.id);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ColumnProfile | null>(null);

  const columns = useMemo(() => dataset?.profile.columns ?? [], [dataset]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return columns;
    return columns.filter((column) => column.name.toLowerCase().includes(term));
  }, [columns, search]);

  if (!dataset) return null;

  const { overview } = dataset.profile;
  const quality = dataset.analysis.quality;
  const scoreTone = quality.score >= 80 ? 'positive' : quality.score >= 60 ? 'warning' : 'negative';

  return (
    <div className="p-4 sm:p-6">
      <header className="mb-5">
        <h2 className="text-xl font-semibold tracking-[-0.02em]">Data Quality</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Perfilamento completo do conjunto de dados e problemas que podem distorcer os números.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="pt-5">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border-4',
                  scoreTone === 'positive' && 'border-positive/30 text-positive',
                  scoreTone === 'warning' && 'border-warning/30 text-warning',
                  scoreTone === 'negative' && 'border-negative/30 text-negative',
                )}
              >
                <span className="text-2xl font-semibold tabular-nums leading-none">{quality.score}</span>
                <span className="text-2xs text-ink-subtle">/100</span>
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold">{quality.label}</p>
                <p className="mt-0.5 text-[13px] text-ink-muted">Nota {quality.grade}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(['critical', 'high', 'medium', 'low'] as const).map((severity) =>
                    quality.issue_counts[severity] > 0 ? (
                      <Badge key={severity} tone={SEVERITY_META[severity].tone}>
                        {quality.issue_counts[severity]} {SEVERITY_META[severity].label.toLowerCase()}
                      </Badge>
                    ) : null,
                  )}
                </div>
              </div>
            </div>

            <dl className="mt-5 space-y-3">
              {quality.dimensions.map((dimension) => (
                <div key={dimension.key}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <dt className="text-[13px] text-ink-muted" title={dimension.description}>
                      {dimension.label}
                    </dt>
                    <dd className="text-[13px] font-semibold tabular-nums">{dimension.score}</dd>
                  </div>
                  <Progress
                    value={dimension.score}
                    tone={dimension.score >= 80 ? 'positive' : dimension.score >= 60 ? 'warning' : 'negative'}
                  />
                  <p className="mt-1 text-2xs leading-snug text-ink-subtle">{dimension.description}</p>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile icon={Database} label="Registros" value={formatInteger(overview.row_count)} />
            <MetricTile icon={Table2} label="Colunas" value={formatInteger(overview.column_count)} />
            <MetricTile
              icon={HardDrive}
              label="Memória"
              value={formatBytes(overview.memory_bytes)}
              hint="após conversão de tipos"
            />
            <MetricTile
              icon={Copy}
              label="Duplicadas"
              value={formatInteger(overview.duplicate_rows)}
              hint={formatRatio(overview.duplicate_ratio)}
              tone={overview.duplicate_rows > 0 ? 'warning' : 'neutral'}
            />
            <MetricTile
              icon={AlertCircle}
              label="Células vazias"
              value={formatInteger(overview.missing_cells)}
              hint={formatRatio(overview.missing_ratio)}
              tone={overview.missing_ratio > 0.1 ? 'warning' : 'neutral'}
            />
            <MetricTile
              icon={CheckCircle2}
              label="Linhas completas"
              value={formatInteger(overview.complete_rows)}
              hint={formatRatio(overview.complete_rows / Math.max(overview.row_count, 1))}
            />
            <MetricTile icon={Info} label="Codificação" value={overview.encoding.toUpperCase()} />
            <MetricTile
              icon={Info}
              label="Separador"
              value={overview.delimiter === '\t' ? 'Tab' : overview.delimiter}
            />
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Problemas encontrados</CardTitle>
                <CardDescription>
                  Ordenados por severidade, com a ação recomendada para cada um.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {quality.issues.length === 0 ? (
                <EmptyState
                  compact
                  icon={<CheckCircle2 className="h-4 w-4 text-positive" />}
                  title="Nenhum problema relevante"
                  description="O conjunto de dados passou em todas as verificações."
                />
              ) : (
                quality.issues.map((issue, index) => (
                  <details
                    key={`${issue.category}-${index}`}
                    className="group rounded-lg border border-line bg-surface-sunken p-3"
                  >
                    <summary className="flex cursor-pointer list-none items-start gap-2.5">
                      <AlertTriangle
                        className={cn(
                          'mt-0.5 h-3.5 w-3.5 shrink-0',
                          issue.severity === 'critical' || issue.severity === 'high'
                            ? 'text-negative'
                            : issue.severity === 'medium'
                              ? 'text-warning'
                              : 'text-info',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium">{issue.title}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                          {issue.description}
                        </span>
                      </span>
                      <Badge tone={SEVERITY_META[issue.severity].tone} className="shrink-0">
                        {SEVERITY_META[issue.severity].label}
                      </Badge>
                    </summary>
                    <div className="mt-2.5 rounded-md border border-line bg-surface p-2.5">
                      <p className="text-2xs font-semibold uppercase tracking-wide text-primary">
                        Como resolver
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                        {issue.recommendation}
                      </p>
                      {issue.columns.length > 0 && (
                        <p className="mt-2 font-mono text-2xs text-ink-subtle">
                          {issue.columns.slice(0, 8).join(', ')}
                          {issue.columns.length > 8 && ` +${issue.columns.length - 8}`}
                        </p>
                      )}
                    </div>
                  </details>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle>Perfilamento por coluna</CardTitle>
            <CardDescription>
              Tipo semântico, papel, cardinalidade e estatísticas descritivas de cada coluna.
            </CardDescription>
          </div>
          <Input
            className="max-w-56"
            placeholder="Buscar coluna"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            icon={<Search className="h-3.5 w-3.5" />}
          />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-surface-sunken">
                  {['Coluna', 'Tipo', 'Papel', 'Distintos', 'Vazios', 'Estatísticas'].map((header, index) => (
                    <th
                      key={header}
                      className={cn(
                        'whitespace-nowrap border-b border-line px-3 py-2 font-medium text-ink-muted',
                        index >= 3 ? 'text-right' : 'text-left',
                      )}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((column) => (
                  <tr
                    key={column.name}
                    onClick={() => setSelected(column)}
                    className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-surface-raised"
                  >
                    <td className="max-w-[220px] px-3 py-2">
                      <span className="block truncate font-medium" title={column.name}>
                        {column.name}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone="neutral">
                        {SEMANTIC_TYPE_LABELS[column.semantic_type] ?? column.semantic_type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{ROLE_LABELS[column.role] ?? column.role}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatInteger(column.unique_count)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={cn(column.missing_ratio > 0.15 && 'text-warning')}>
                        {formatRatio(column.missing_ratio)}
                      </span>
                    </td>
                    <td className="max-w-[260px] px-3 py-2 text-right text-xs text-ink-subtle">
                      <span className="block truncate">{summariseColumn(column)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <p className="py-6 text-center text-[13px] text-ink-subtle">
              Nenhuma coluna corresponde à busca.
            </p>
          )}
        </CardContent>
      </Card>

      {selected && (
        <ColumnDetail
          column={selected}
          datasetId={dataset.id}
          columnProfiles={columns}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function summariseColumn(column: ColumnProfile): string {
  const stats = column.stats;
  if (!stats) return '—';
  if (['integer', 'float', 'currency', 'percentage'].includes(column.semantic_type)) {
    return `méd. ${formatValue(stats.mean ?? null, 'auto', { semanticType: column.semantic_type, compact: true })} · med. ${formatValue(stats.median ?? null, 'auto', { semanticType: column.semantic_type, compact: true })}`;
  }
  if (column.semantic_type === 'datetime') {
    return `${stats.span_days ?? 0} dias · ${formatInteger(stats.unique_days ?? 0)} datas`;
  }
  if (stats.mode) {
    return `top: ${stats.mode} (${formatRatio(stats.mode_ratio ?? 0)})`;
  }
  return `${formatInteger(stats.count ?? 0)} valores`;
}

function MetricTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-ink-muted">{label}</p>
        <Icon className={cn('h-3.5 w-3.5 shrink-0', tone === 'warning' ? 'text-warning' : 'text-ink-subtle')} />
      </div>
      <p className="mt-1.5 truncate text-base font-semibold tabular-nums" title={value}>
        {value}
      </p>
      {hint && <p className="text-2xs text-ink-subtle">{hint}</p>}
    </Card>
  );
}

function ColumnDetail({
  column,
  datasetId,
  columnProfiles,
  onClose,
}: {
  column: ColumnProfile;
  datasetId: string;
  columnProfiles: ColumnProfile[];
  onClose: () => void;
}) {
  const numeric = ['integer', 'float', 'currency', 'percentage'].includes(column.semantic_type);
  const stats = column.stats ?? {};

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 max-h-[86vh] w-full max-w-2xl animate-scale-in overflow-y-auto rounded-t-xl border border-line bg-surface p-5 shadow-lg sm:rounded-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{humanize(column.name)}</h3>
            <p className="mt-0.5 font-mono text-xs text-ink-subtle">{column.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[13px] text-ink-muted hover:bg-surface-raised hover:text-ink"
          >
            Fechar
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-1.5">
          <Badge tone="primary">{SEMANTIC_TYPE_LABELS[column.semantic_type] ?? column.semantic_type}</Badge>
          <Badge tone="neutral">{ROLE_LABELS[column.role] ?? column.role}</Badge>
          {column.detail?.additive === false && <Badge tone="warning">Não somável</Badge>}
          {column.detail?.geo_kind && <Badge tone="info">Geográfico</Badge>}
        </div>

        {numeric && (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Média', stats.mean],
                ['Mediana', stats.median],
                ['Mínimo', stats.min],
                ['Máximo', stats.max],
                ['Desvio padrão', stats.std],
                ['Q1', stats.q1],
                ['Q3', stats.q3],
                ['Soma', stats.sum],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-2xs uppercase tracking-wide text-ink-subtle">{label}</dt>
                  <dd className="mt-0.5 truncate text-[13px] font-semibold tabular-nums">
                    {formatValue(value as number | null, 'auto', {
                      semanticType: column.semantic_type,
                      compact: true,
                    })}
                  </dd>
                </div>
              ))}
            </dl>

            {stats.outliers && stats.outliers.count > 0 && (
              <div className="mt-4 rounded-md border border-warning/25 bg-warning/10 p-3">
                <p className="text-[13px] font-medium text-warning">
                  {formatInteger(stats.outliers.count)} valores fora do padrão (
                  {formatRatio(stats.outliers.ratio)})
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  Fora do intervalo de{' '}
                  {formatValue(stats.outliers.lower_bound, 'auto', { semanticType: column.semantic_type, compact: true })} a{' '}
                  {formatValue(stats.outliers.upper_bound, 'auto', { semanticType: column.semantic_type, compact: true })},
                  calculado pelas cercas de Tukey (1,5 × intervalo interquartil).
                </p>
              </div>
            )}

            <div className="mt-4 h-56">
              <ChartRenderer
                datasetId={datasetId}
                chartType="histogram"
                encoding={{ x: column.name }}
                columnProfiles={columnProfiles}
                showTableToggle={false}
              />
            </div>
          </>
        )}

        {!numeric && stats.top_values && stats.top_values.length > 0 && (
          <div className="space-y-1.5">
            {stats.top_values.slice(0, 12).map((entry) => (
              <div key={entry.value} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-[13px]" title={entry.value}>
                  {entry.value}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(entry.ratio * 100, 1.5)}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-xs tabular-nums text-ink-subtle">
                  {formatInteger(entry.count)} · {formatRatio(entry.ratio, 0)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
