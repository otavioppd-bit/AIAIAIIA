'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ChartEncoding, ChartType, WidgetDataResponse } from '@/types/api';

export interface WidgetDataParams {
  datasetId: string;
  chartType: ChartType | string;
  encoding: ChartEncoding;
  filters?: Record<string, unknown>[];
  limit?: number;
  enabled?: boolean;
}

/**
 * Fetches the rows behind one widget.
 *
 * The query key includes the encoding and the active filters, so React Query
 * dedupes identical widgets and caches each filter combination — a dashboard
 * with twelve charts issues at most twelve requests, and none on a filter
 * combination already seen.
 */
export function useWidgetData({
  datasetId,
  chartType,
  encoding,
  filters = [],
  limit = 200,
  enabled = true,
}: WidgetDataParams) {
  return useQuery<WidgetDataResponse>({
    queryKey: ['widget-data', datasetId, chartType, encoding, filters, limit],
    queryFn: () =>
      api.datasets.widgetData(datasetId, {
        chart_type: chartType,
        encoding,
        filters,
        limit,
      }),
    enabled: Boolean(datasetId) && enabled,
    staleTime: 2 * 60_000,
    placeholderData: (previous) => previous,
  });
}
