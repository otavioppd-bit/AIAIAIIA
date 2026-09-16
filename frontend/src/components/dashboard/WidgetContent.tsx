'use client';

import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { ChartRenderer } from '@/components/charts/ChartRenderer';
import { DataTable } from '@/components/charts/DataTable';
import { InsightCard } from '@/components/charts/InsightCard';
import { KpiCard } from '@/components/charts/KpiCard';
import { LazyDataOrb } from '@/components/three/LazyDataOrb';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ColumnProfile, Widget } from '@/types/api';

interface WidgetContentProps {
  widget: Widget;
  datasetId: string;
  filters: Record<string, unknown>[];
  columnProfiles: ColumnProfile[];
  rowCount?: number;
  qualityScore?: number;
}

export function WidgetContent({
  widget,
  datasetId,
  filters,
  columnProfiles,
  rowCount = 0,
  qualityScore = 100,
}: WidgetContentProps) {
  switch (widget.type) {
    case 'kpi':
      return widget.config.kpi ? (
        <KpiCard kpi={widget.config.kpi} accent={widget.config.style.accent} />
      ) : (
        <EmptyState compact title="KPI sem configuração" />
      );

    case 'narrative':
      return <NarrativeWidget widget={widget} />;

    case 'insights':
      return (
        <div className="scroll-fade grid h-full gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {(widget.config.insights ?? []).map((insight, index) => (
            <InsightCard key={`${insight.kind}-${index}`} insight={insight} />
          ))}
        </div>
      );

    case 'table':
      return (
        <TableWidget
          datasetId={datasetId}
          columns={widget.config.encoding.columns ?? []}
          columnProfiles={columnProfiles}
          pageSize={widget.config.table?.pageSize ?? 25}
        />
      );

    case 'text':
      return (
        <div
          className={cn(
            'prose-sm h-full whitespace-pre-wrap text-[13px] leading-relaxed text-ink-muted',
            widget.config.text?.align === 'center' && 'text-center',
            widget.config.text?.align === 'right' && 'text-right',
          )}
        >
          {widget.config.text?.content || 'Clique para editar este texto.'}
        </div>
      );

    case 'image':
      return widget.config.image?.url ? (
        <img
          src={widget.config.image.url}
          alt={widget.config.image.alt || ''}
          className={cn(
            'h-full w-full rounded-md',
            widget.config.image.fit === 'contain' ? 'object-contain' : 'object-cover',
          )}
          loading="lazy"
        />
      ) : (
        <EmptyState compact title="Sem imagem" description="Informe uma URL nas configurações." />
      );

    case 'scene3d':
      return (
        <LazyDataOrb
          className="h-full w-full"
          recordCount={rowCount}
          coherence={qualityScore / 100}
        />
      );

    case 'chart':
    default:
      return (
        <ChartRenderer
          datasetId={datasetId}
          chartType={widget.config.chart_type}
          encoding={widget.config.encoding}
          filters={filters}
          style={widget.config.style}
          options={widget.config.options}
          columnProfiles={columnProfiles}
        />
      );
  }
}

function NarrativeWidget({ widget }: { widget: Widget }) {
  const narrative = widget.config.narrative;
  if (!narrative) return <EmptyState compact title="Sem resumo disponível" />;

  const fromModel = narrative.source?.startsWith('llm');

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <p className="text-[13.5px] leading-relaxed text-ink-muted">{narrative.summary}</p>

      {narrative.sections.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {narrative.sections.map((section) => (
            <div key={section.heading} className="rounded-md border border-line bg-surface-sunken p-3">
              <p className="text-[13px] font-semibold leading-snug">{section.heading}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{section.body}</p>
            </div>
          ))}
        </div>
      )}

      {narrative.watch_items.length > 0 && (
        <div>
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
            Pontos de atenção
          </p>
          <ul className="space-y-1">
            {narrative.watch_items.map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs text-ink-muted">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-auto flex items-center gap-1.5 pt-1 text-2xs text-ink-subtle">
        <Sparkles className="h-3 w-3" aria-hidden />
        {fromModel
          ? 'Texto redigido por modelo a partir dos números calculados pelo motor de análise.'
          : 'Texto composto diretamente a partir dos números calculados pelo motor de análise.'}
      </p>
    </div>
  );
}

function TableWidget({
  datasetId,
  columns,
  columnProfiles,
  pageSize,
}: {
  datasetId: string;
  columns: string[];
  columnProfiles: ColumnProfile[];
  pageSize: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['dataset-rows', datasetId, pageSize],
    queryFn: () => api.datasets.rows(datasetId, Math.min(pageSize * 4, 200), 0),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <Skeleton className="h-full w-full" />;
  if (!data) return <EmptyState compact title="Sem dados" />;

  const visible = columns.length > 0 ? columns.filter((c) => data.columns.includes(c)) : data.columns;

  return (
    <DataTable
      columns={visible}
      rows={data.rows}
      columnProfiles={columnProfiles}
      maxHeight="fill"
      className="h-full border-0"
    />
  );
}
