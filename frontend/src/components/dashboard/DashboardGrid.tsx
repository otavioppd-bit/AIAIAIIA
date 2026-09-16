'use client';

import { useMemo } from 'react';
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { LayoutGrid } from 'lucide-react';
import { WidgetShell } from './WidgetShell';
import { WidgetContent } from './WidgetContent';
import { EmptyState } from '@/components/ui/EmptyState';
import { useDashboardStore } from '@/store/dashboardStore';
import { cn } from '@/lib/utils';
import type { ColumnProfile, DashboardSpec } from '@/types/api';

interface DashboardGridProps {
  spec: DashboardSpec;
  datasetId: string;
  filters: Record<string, unknown>[];
  columnProfiles: ColumnProfile[];
  rowCount?: number;
  qualityScore?: number;
  className?: string;
  /** Exposed so export can capture the grid element. */
  gridId?: string;
}

export function DashboardGrid({
  spec,
  datasetId,
  filters,
  columnProfiles,
  rowCount,
  qualityScore,
  className,
  gridId = 'dashboard-grid',
}: DashboardGridProps) {
  const editMode = useDashboardStore((state) => state.editMode);
  const selectedWidgetId = useDashboardStore((state) => state.selectedWidgetId);
  const selectWidget = useDashboardStore((state) => state.selectWidget);
  const duplicateWidget = useDashboardStore((state) => state.duplicateWidget);
  const removeWidget = useDashboardStore((state) => state.removeWidget);
  const reorderWidgets = useDashboardStore((state) => state.reorderWidgets);
  const updateWidgetLayout = useDashboardStore((state) => state.updateWidgetLayout);

  const sensors = useSensors(
    // A small activation distance keeps a click on a chart from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const widgetIds = useMemo(() => spec.widgets.map((widget) => widget.id), [spec.widgets]);
  const columns = spec.grid?.columns ?? 12;
  const rowHeight = spec.grid?.rowHeight ?? 132;
  const gap = spec.grid?.gap ?? 16;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderWidgets(String(active.id), String(over.id));
    }
  };

  if (spec.widgets.length === 0) {
    return (
      <EmptyState
        icon={<LayoutGrid className="h-5 w-5" />}
        title="Dashboard vazio"
        description="Adicione um gráfico, KPI ou texto para começar a montar sua visão."
        className={cn('rounded-lg border border-dashed border-line', className)}
      />
    );
  }

  const grid = (
    <div
      id={gridId}
      className={cn('grid w-full auto-rows-min', className)}
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap,
      }}
    >
      {spec.widgets.map((widget) => (
        <WidgetShell
          key={widget.id}
          widget={widget}
          editMode={editMode}
          selected={selectedWidgetId === widget.id}
          columns={columns}
          rowHeight={rowHeight}
          onSelect={() => selectWidget(widget.id)}
          onDuplicate={() => duplicateWidget(widget.id)}
          onRemove={() => removeWidget(widget.id)}
          onResize={(delta) =>
            updateWidgetLayout(widget.id, {
              w: delta.w
                ? Math.min(Math.max(widget.layout.w + delta.w, 2), columns)
                : widget.layout.w,
              h: delta.h ? Math.min(Math.max(widget.layout.h + delta.h, 1), 6) : widget.layout.h,
            })
          }
        >
          <WidgetContent
            widget={widget}
            datasetId={datasetId}
            filters={filters}
            columnProfiles={columnProfiles}
            rowCount={rowCount}
            qualityScore={qualityScore}
          />
        </WidgetShell>
      ))}
    </div>
  );

  if (!editMode) return grid;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={widgetIds} strategy={rectSortingStrategy}>
        {grid}
      </SortableContext>
    </DndContext>
  );
}
