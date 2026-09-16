'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { DashboardToolbar } from '@/components/dashboard/DashboardToolbar';
import { FilterBar } from '@/components/dashboard/FilterBar';
import { PresentationMode } from '@/components/dashboard/PresentationMode';
import { WidgetEditor } from '@/components/dashboard/WidgetEditor';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useDataset, usePrimaryDashboard } from '@/hooks/useDataset';
import { buildFilterPayload, useDashboardStore } from '@/store/dashboardStore';
import { cn } from '@/lib/utils';

const GRID_ID = 'dashboard-grid';

export default function OverviewPage() {
  const params = useParams<{ id: string }>();
  const { data: dataset } = useDataset(params.id);
  const { dashboard, isLoading, refetch } = usePrimaryDashboard(params.id);

  const spec = useDashboardStore((state) => state.spec);
  const load = useDashboardStore((state) => state.load);
  const editMode = useDashboardStore((state) => state.editMode);
  const presentationMode = useDashboardStore((state) => state.presentationMode);
  const setPresentationMode = useDashboardStore((state) => state.setPresentationMode);
  const setFilterValue = useDashboardStore((state) => state.setFilterValue);
  const resetFilters = useDashboardStore((state) => state.resetFilters);
  const setEditMode = useDashboardStore((state) => state.setEditMode);

  // Load the stored spec once per dashboard.
  //
  // Depending on the spec object itself would reload on every refetch — React
  // Query hands back a new object each time — and `load` resets the undo stack
  // and the saved baseline, silently discarding whatever the user was editing.
  // The id is what identifies "a different dashboard".
  const loadedDashboardId = useRef<string | null>(null);
  useEffect(() => {
    if (!dashboard?.spec) return;
    if (loadedDashboardId.current === dashboard.id) return;
    loadedDashboardId.current = dashboard.id;
    load(dashboard.spec);
  }, [dashboard?.id, dashboard?.spec, load]);

  // Leaving this screen should never strand the user in edit mode.
  useEffect(() => {
    return () => {
      setEditMode(false);
      setPresentationMode(false);
    };
  }, [setEditMode, setPresentationMode]);

  const filters = useMemo(() => buildFilterPayload(spec), [spec]);
  const columnProfiles = dataset?.profile.columns ?? [];

  if (isLoading || !dataset) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-ink-subtle" />
      </div>
    );
  }

  if (!dashboard || !spec) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<AlertCircle className="h-5 w-5" />}
          title="Nenhum dashboard encontrado"
          description="Gere um dashboard a partir da análise deste conjunto de dados."
          action={
            <Button size="sm" variant="secondary" onClick={() => refetch()}>
              Recarregar
            </Button>
          }
        />
      </div>
    );
  }

  const gridContent = (
    <DashboardGrid
      spec={spec}
      datasetId={dataset.id}
      filters={filters}
      columnProfiles={columnProfiles}
      rowCount={dataset.row_count}
      qualityScore={dataset.quality_score}
      gridId={GRID_ID}
    />
  );

  return (
    <>
      <div className="flex">
        <div className="min-w-0 flex-1 p-4 sm:p-6">
          <div className="presentation-hide mb-5 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold tracking-[-0.02em]">{spec.title}</h2>
              {spec.subtitle && (
                <p className="mt-0.5 truncate text-[13px] text-ink-muted">{spec.subtitle}</p>
              )}
            </div>
            <DashboardToolbar
              dashboardId={dashboard.id}
              datasetId={dataset.id}
              datasetName={dataset.name}
              columnProfiles={columnProfiles}
              gridElementId={GRID_ID}
            />
          </div>

          <FilterBar
            filters={spec.filters}
            onChange={setFilterValue}
            onReset={resetFilters}
            className="presentation-hide mb-5"
          />

          {dataset.analysis.warnings.length > 0 && (
            <div className="presentation-hide mb-5 flex items-start gap-2 rounded-md border border-warning/25 bg-warning/10 p-3 text-xs text-warning">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{dataset.analysis.warnings.join(' ')}</span>
            </div>
          )}

          {gridContent}

          <p className="presentation-hide mt-6 flex items-center justify-center gap-1.5 text-2xs text-ink-subtle">
            <Sparkles className="h-3 w-3" />
            Todos os valores exibidos são calculados diretamente do arquivo enviado.
          </p>
        </div>

        {editMode && (
          <aside
            className={cn(
              'presentation-hide sticky top-14 hidden h-[calc(100vh-3.5rem)] w-72 shrink-0',
              'border-l border-line bg-surface xl:block',
            )}
            aria-label="Propriedades do widget"
          >
            <WidgetEditor columnProfiles={columnProfiles} />
          </aside>
        )}
      </div>

      <PresentationMode
        active={presentationMode}
        onExit={() => setPresentationMode(false)}
        title={spec.title}
        subtitle={spec.subtitle}
      >
        {gridContent}
      </PresentationMode>
    </>
  );
}
