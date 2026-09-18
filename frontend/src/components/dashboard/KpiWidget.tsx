'use client';

import { KpiCard } from '@/components/charts/KpiCard';
import { useWidgetData } from '@/hooks/useWidgetData';
import type { Kpi } from '@/types/api';

interface KpiWidgetProps {
  kpi: Kpi;
  datasetId: string;
  filters: Record<string, unknown>[];
  accent?: string;
}

/**
 * A KPI that answers for the filtered dashboard rather than the stored one.
 *
 * The spec persists the figure the analysis computed, which is correct only
 * while nothing is filtered — narrow the dashboard to one state and every other
 * widget re-queries while the headline number keeps reporting the whole
 * dataset. So the value is recomputed whenever a filter is active, through the
 * same engine and the same payload every chart uses.
 *
 * The stored delta is deliberately dropped in that case. It compares two
 * periods of the *unfiltered* series, and pairing a filtered figure with an
 * unfiltered comparison would state a change that never happened.
 */
export function KpiWidget({ kpi, datasetId, filters, accent }: KpiWidgetProps) {
  const filtered = filters.length > 0;

  const query = useWidgetData({
    datasetId,
    chartType: 'kpi',
    encoding: { y: kpi.column ?? undefined, agg: kpi.agg },
    filters,
    limit: 1,
    // Unfiltered, the stored figure is already the right answer; asking again
    // would add a request per KPI to every dashboard load for nothing.
    enabled: filtered,
  });

  if (!filtered) return <KpiCard kpi={kpi} accent={accent} />;

  const row = query.data?.rows?.[0];
  const value = row ? Number(Object.values(row)[0]) : NaN;

  return (
    <KpiCard
      accent={accent}
      kpi={{
        ...kpi,
        value: Number.isFinite(value) ? value : kpi.value,
        delta: null,
      }}
      pending={query.isFetching && !row}
    />
  );
}
