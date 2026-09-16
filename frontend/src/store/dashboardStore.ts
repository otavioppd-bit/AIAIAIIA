'use client';

import { create } from 'zustand';
import { createId } from '@/lib/utils';
import type { DashboardSpec, Widget, WidgetLayout, WidgetStyle } from '@/types/api';

const MAX_HISTORY = 40;

export const DEFAULT_WIDGET_STYLE: WidgetStyle = {
  accent: 'primary',
  background: 'surface',
  border: true,
  shadow: 'sm',
  radius: 'lg',
  padding: 'md',
  showLegend: true,
  showGrid: true,
  showDataLabels: false,
  titleSize: 'md',
  fontFamily: 'sans',
  colorScheme: 'default',
};

interface DashboardState {
  spec: DashboardSpec | null;
  /** Server-side state, used to decide whether there is anything to save. */
  savedSpec: DashboardSpec | null;
  selectedWidgetId: string | null;
  editMode: boolean;
  presentationMode: boolean;
  past: DashboardSpec[];
  future: DashboardSpec[];

  load: (spec: DashboardSpec) => void;
  markSaved: (spec: DashboardSpec) => void;
  setEditMode: (value: boolean) => void;
  setPresentationMode: (value: boolean) => void;
  selectWidget: (id: string | null) => void;

  updateSpec: (patch: Partial<DashboardSpec>) => void;
  updateWidget: (id: string, patch: Partial<Widget>) => void;
  updateWidgetConfig: (id: string, patch: Partial<Widget['config']>) => void;
  updateWidgetStyle: (id: string, patch: Partial<WidgetStyle>) => void;
  updateWidgetLayout: (id: string, patch: Partial<WidgetLayout>) => void;
  addWidget: (widget: Omit<Widget, 'id'> & { id?: string }) => string;
  duplicateWidget: (id: string) => void;
  removeWidget: (id: string) => void;
  reorderWidgets: (fromId: string, toId: string) => void;
  setFilterValue: (filterId: string, value: unknown) => void;
  resetFilters: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  isDirty: () => boolean;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const useDashboardStore = create<DashboardState>((set, get) => {
  /** Applies a change, pushing the previous spec onto the undo stack. */
  const commit = (mutate: (spec: DashboardSpec) => DashboardSpec) => {
    const { spec, past } = get();
    if (!spec) return;
    const next = mutate(clone(spec));
    set({
      spec: next,
      past: [...past, spec].slice(-MAX_HISTORY),
      future: [],
    });
  };

  return {
    spec: null,
    savedSpec: null,
    selectedWidgetId: null,
    editMode: false,
    presentationMode: false,
    past: [],
    future: [],

    load: (spec) => set({ spec: clone(spec), savedSpec: clone(spec), past: [], future: [], selectedWidgetId: null }),
    markSaved: (spec) => set({ savedSpec: clone(spec) }),
    setEditMode: (value) => set({ editMode: value, selectedWidgetId: value ? get().selectedWidgetId : null }),
    setPresentationMode: (value) => set({ presentationMode: value, editMode: value ? false : get().editMode }),
    selectWidget: (id) => set({ selectedWidgetId: id }),

    updateSpec: (patch) => commit((spec) => ({ ...spec, ...patch })),

    updateWidget: (id, patch) =>
      commit((spec) => ({
        ...spec,
        widgets: spec.widgets.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget)),
      })),

    updateWidgetConfig: (id, patch) =>
      commit((spec) => ({
        ...spec,
        widgets: spec.widgets.map((widget) =>
          widget.id === id ? { ...widget, config: { ...widget.config, ...patch } } : widget,
        ),
      })),

    updateWidgetStyle: (id, patch) =>
      commit((spec) => ({
        ...spec,
        widgets: spec.widgets.map((widget) =>
          widget.id === id
            ? { ...widget, config: { ...widget.config, style: { ...widget.config.style, ...patch } } }
            : widget,
        ),
      })),

    updateWidgetLayout: (id, patch) =>
      commit((spec) => ({
        ...spec,
        widgets: spec.widgets.map((widget) =>
          widget.id === id ? { ...widget, layout: { ...widget.layout, ...patch } } : widget,
        ),
      })),

    addWidget: (widget) => {
      const id = widget.id ?? createId();
      commit((spec) => ({
        ...spec,
        widgets: [...spec.widgets, { ...widget, id } as Widget],
      }));
      set({ selectedWidgetId: id });
      return id;
    },

    duplicateWidget: (id) =>
      commit((spec) => {
        const index = spec.widgets.findIndex((widget) => widget.id === id);
        if (index === -1) return spec;
        const source = spec.widgets[index];
        const copy: Widget = {
          ...clone(source),
          id: createId(),
          title: `${source.title} (cópia)`,
        };
        const widgets = [...spec.widgets];
        widgets.splice(index + 1, 0, copy);
        return { ...spec, widgets };
      }),

    removeWidget: (id) => {
      commit((spec) => ({ ...spec, widgets: spec.widgets.filter((widget) => widget.id !== id) }));
      if (get().selectedWidgetId === id) set({ selectedWidgetId: null });
    },

    reorderWidgets: (fromId, toId) =>
      commit((spec) => {
        const from = spec.widgets.findIndex((widget) => widget.id === fromId);
        const to = spec.widgets.findIndex((widget) => widget.id === toId);
        if (from === -1 || to === -1 || from === to) return spec;
        const widgets = [...spec.widgets];
        const [moved] = widgets.splice(from, 1);
        widgets.splice(to, 0, moved);
        return { ...spec, widgets };
      }),

    // Filter changes are not undoable: they are a view state, not an edit.
    setFilterValue: (filterId, value) => {
      const { spec } = get();
      if (!spec) return;
      set({
        spec: {
          ...spec,
          filters: spec.filters.map((filter) =>
            filter.id === filterId ? { ...filter, value } : filter,
          ),
        },
      });
    },

    resetFilters: () => {
      const { spec } = get();
      if (!spec) return;
      set({
        spec: {
          ...spec,
          filters: spec.filters.map((filter) => ({
            ...filter,
            value: filter.kind === 'multi_select' ? [] : null,
          })),
        },
      });
    },

    undo: () => {
      const { past, spec, future } = get();
      if (past.length === 0 || !spec) return;
      const previous = past[past.length - 1];
      set({ spec: previous, past: past.slice(0, -1), future: [spec, ...future].slice(0, MAX_HISTORY) });
    },

    redo: () => {
      const { future, spec, past } = get();
      if (future.length === 0 || !spec) return;
      const [next, ...rest] = future;
      set({ spec: next, future: rest, past: [...past, spec].slice(-MAX_HISTORY) });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
    isDirty: () => {
      const { spec, savedSpec } = get();
      if (!spec || !savedSpec) return false;
      return JSON.stringify(spec) !== JSON.stringify(savedSpec);
    },
  };
});

/** Turns dashboard filter values into the backend's filter payload. */
export function buildFilterPayload(spec: DashboardSpec | null): Record<string, unknown>[] {
  if (!spec) return [];
  const payload: Record<string, unknown>[] = [];

  spec.filters.forEach((filter) => {
    const value = filter.value;
    if (value === null || value === undefined) return;

    if (filter.kind === 'multi_select') {
      const values = Array.isArray(value) ? value : [value];
      if (values.length === 0) return;
      payload.push({ column: filter.column, op: 'in', value: values });
      return;
    }

    if (filter.kind === 'date_range' || filter.kind === 'range') {
      const range = value as [unknown, unknown];
      if (!Array.isArray(range) || range.length !== 2) return;
      const [from, to] = range;
      if (from && to) {
        payload.push({ column: filter.column, op: 'between', value: [from, to] });
      } else if (from) {
        payload.push({ column: filter.column, op: 'gte', value: from });
      } else if (to) {
        payload.push({ column: filter.column, op: 'lte', value: to });
      }
    }
  });

  return payload;
}
