'use client';

import { LazyDataOrb } from '@/components/three/LazyDataOrb';
import { useWidgetData } from '@/hooks/useWidgetData';

interface DataSceneWidgetProps {
  datasetId: string;
  filters: Record<string, unknown>[];
  /** Unfiltered dataset size, used until the filtered count lands. */
  rowCount: number;
  qualityScore: number;
}

/**
 * The lattice, bound to what the dashboard is currently showing.
 *
 * Node density is the row count, so leaving it on the dataset total would make
 * the object a static decoration that contradicts the charts beside it the
 * moment a filter is applied. A bare count query is cheap, runs through the
 * same engine and the same filter payload as every widget, and React Query
 * dedupes it — so the structure visibly thins out with the data it describes.
 */
export function DataSceneWidget({
  datasetId,
  filters,
  rowCount,
  qualityScore,
}: DataSceneWidgetProps) {
  const count = useWidgetData({
    datasetId,
    chartType: 'kpi',
    encoding: { agg: 'count' },
    filters,
    limit: 1,
  });

  const filtered = count.data?.rows?.[0];
  const value = filtered ? Number(Object.values(filtered)[0]) : NaN;

  return (
    <LazyDataOrb
      className="h-full w-full"
      recordCount={Number.isFinite(value) ? value : rowCount}
      coherence={qualityScore / 100}
    />
  );
}
