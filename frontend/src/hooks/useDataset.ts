'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Dashboard, DashboardSummary, DatasetDetail } from '@/types/api';

export function useDataset(datasetId: string) {
  return useQuery<DatasetDetail>({
    queryKey: ['dataset', datasetId],
    queryFn: () => api.datasets.get(datasetId),
    enabled: Boolean(datasetId),
    // The analysis document is immutable until an explicit re-analysis, so it
    // never needs refetching during a session.
    staleTime: 15 * 60_000,
  });
}

export function useDashboards(datasetId: string) {
  return useQuery<DashboardSummary[]>({
    queryKey: ['dashboards', datasetId],
    queryFn: () => api.dashboards.list(datasetId),
    enabled: Boolean(datasetId),
    staleTime: 60_000,
  });
}

export function useDashboard(dashboardId: string | null | undefined) {
  return useQuery<Dashboard>({
    queryKey: ['dashboard', dashboardId],
    queryFn: () => api.dashboards.get(dashboardId as string),
    enabled: Boolean(dashboardId),
    staleTime: 60_000,
  });
}

/**
 * Resolves a dataset's main dashboard.
 *
 * The list endpoint returns metadata only — widget specs are large and are not
 * worth shipping for every dashboard a user owns — so the chosen one is then
 * fetched in full by id.
 */
export function usePrimaryDashboard(datasetId: string) {
  const list = useDashboards(datasetId);
  const summary = list.data?.find((item) => item.is_primary) ?? list.data?.[0] ?? null;
  const detail = useDashboard(summary?.id);

  return {
    dashboard: detail.data ?? null,
    summary,
    isLoading: list.isLoading || (Boolean(summary) && detail.isLoading),
    isError: list.isError || detail.isError,
    error: list.error ?? detail.error,
    refetch: async () => {
      await list.refetch();
      if (summary) await detail.refetch();
    },
  };
}
