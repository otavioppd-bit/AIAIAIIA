'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Info, Table2, BarChart3 } from 'lucide-react';
import { EChart } from './EChart';
import { DataTable } from './DataTable';
import { ChartSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/Button';
import { useWidgetData } from '@/hooks/useWidgetData';
import { useGeoMap } from '@/hooks/useGeoMap';
import { buildChartOption } from '@/lib/chart-options';
import { geoScopeFor } from '@/lib/geo-names';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import type {
  ChartEncoding,
  ChartType,
  ColumnProfile,
  WidgetDataResponse,
  WidgetStyle,
} from '@/types/api';
import type { ValueFormat } from '@/lib/format';

interface ChartRendererProps {
  datasetId: string;
  chartType: ChartType;
  encoding: ChartEncoding;
  filters?: Record<string, unknown>[];
  style?: Partial<WidgetStyle>;
  options?: Record<string, unknown>;
  columnProfiles?: ColumnProfile[];
  /** Skips fetching and renders the supplied rows (used by the AI analyst). */
  inlineData?: WidgetDataResponse;
  className?: string;
  showTableToggle?: boolean;
  onInstance?: (instance: unknown) => void;
}

/** Charts whose value axis should carry the metric's own formatting. */
function resolveValueFormat(
  encoding: ChartEncoding,
  columnProfiles: ColumnProfile[],
): ValueFormat {
  if (encoding.agg === 'count') return 'integer';
  const target = encoding.y ?? encoding.x;
  const profile = columnProfiles.find((c) => c.name === target);
  if (!profile) return 'decimal';
  switch (profile.semantic_type) {
    case 'currency':
      return 'currency';
    case 'percentage':
      return 'percent';
    case 'integer':
      return encoding.agg === 'mean' || encoding.agg === 'median' ? 'decimal' : 'integer';
    default:
      return 'decimal';
  }
}

export function ChartRenderer({
  datasetId,
  chartType,
  encoding,
  filters = [],
  style = {},
  options = {},
  columnProfiles = [],
  inlineData,
  className,
  showTableToggle = true,
  onInstance,
}: ChartRendererProps) {
  const { mode } = useTheme();
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const query = useWidgetData({
    datasetId,
    chartType,
    encoding,
    filters,
    limit: encoding.limit ?? 200,
    enabled: !inlineData,
  });

  const data = inlineData ?? query.data;
  const valueFormat = useMemo(
    () => resolveValueFormat(encoding, columnProfiles),
    [encoding, columnProfiles],
  );

  /**
   * The full set of values the colour dimension can take. Passing it keeps a
   * filtered chart painting each category the same hue as the unfiltered one.
   */
  const colorDomain = useMemo(() => {
    const column = encoding.series ?? encoding.x;
    if (!column) return undefined;
    const profile = columnProfiles.find((item) => item.name === column);
    const values = profile?.stats?.top_values ?? profile?.detail?.top_values;
    return values?.map((entry) => entry.value);
  }, [encoding.series, encoding.x, columnProfiles]);

  // Only a map needs geometry, and only the scope its column implies. A widget
  // built by hand in the editor carries no `geo_kind`, so the column's own
  // profile answers for it.
  const geoKind =
    encoding.geo_kind ??
    columnProfiles.find((column) => column.name === encoding.x)?.detail?.geo_kind;
  const geoScope = chartType === 'map' ? geoScopeFor(geoKind) : null;
  const geoMap = useGeoMap(geoScope);

  const option = useMemo(() => {
    if (!data || data.rows.length === 0) return null;
    return buildChartOption({
      mode,
      chartType,
      data,
      encoding,
      style,
      options,
      valueFormat,
      colorDomain,
      geo:
        geoScope && geoMap.data
          ? { scope: geoScope, aliases: geoMap.data.aliases }
          : undefined,
    });
    // `style` and `options` are plain objects rebuilt on each render; their
    // stringified form is what actually changes the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mode, chartType, JSON.stringify(encoding), JSON.stringify(style), JSON.stringify(options), valueFormat, colorDomain, geoScope, geoMap.data]);

  if (!inlineData && query.isLoading) {
    return <ChartSkeleton className={className} />;
  }

  // Without this the card would paint the bar fallback for a frame and then
  // swap to a map once the geometry lands.
  if (geoScope && geoMap.isLoading) {
    return <ChartSkeleton className={className} />;
  }

  if (!inlineData && query.isError) {
    const error = query.error;
    const message =
      error instanceof ApiError ? error.message : 'Não foi possível carregar os dados.';
    return (
      <EmptyState
        compact
        icon={<AlertCircle className="h-4 w-4 text-negative" />}
        title="Erro ao carregar"
        description={message}
        className={className}
      />
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Info className="h-4 w-4" />}
        title="Sem dados"
        description="Nenhum registro atende à configuração atual deste gráfico."
        className={className}
      />
    );
  }

  const tableColumns = data.columns;

  return (
    <div className={cn('relative flex h-full w-full flex-col', className)}>
      {showTableToggle && (
        <div className="presentation-hide absolute right-0 top-0 z-10 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/widget:opacity-100">
          <IconButton
            label={view === 'chart' ? 'Ver como tabela' : 'Ver como gráfico'}
            size="xs"
            variant="secondary"
            onClick={() => setView((value) => (value === 'chart' ? 'table' : 'chart'))}
          >
            {view === 'chart' ? <Table2 className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
          </IconButton>
        </div>
      )}

      {view === 'table' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <DataTable
            columns={tableColumns}
            rows={data.rows}
            columnProfiles={columnProfiles}
            maxHeight="fill"
            className="h-full border-0"
          />
        </div>
      ) : (
        option && (
          <EChart
            option={option}
            resetKey={`${chartType}-${encoding.x}-${encoding.y}-${encoding.series}`}
            onReady={onInstance as never}
            className="min-h-0 flex-1"
          />
        )
      )}

      {data.notes.length > 0 && view === 'chart' && (
        <p className="mt-1.5 shrink-0 text-2xs leading-snug text-ink-subtle" title={data.notes.join(' ')}>
          {data.notes[0]}
        </p>
      )}
    </div>
  );
}
