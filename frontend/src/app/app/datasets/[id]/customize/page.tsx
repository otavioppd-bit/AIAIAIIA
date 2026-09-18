'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Check, MousePointerClick } from 'lucide-react';
import { toast } from 'sonner';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { WidgetEditor } from '@/components/dashboard/WidgetEditor';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api } from '@/lib/api';
import { useDataset, usePrimaryDashboard } from '@/hooks/useDataset';
import { useTheme } from '@/hooks/useTheme';
import { buildFilterPayload, useDashboardStore } from '@/store/dashboardStore';
import { cn } from '@/lib/utils';

export default function CustomizePage() {
  const params = useParams<{ id: string }>();
  const { data: dataset } = useDataset(params.id);
  const { dashboard } = usePrimaryDashboard(params.id);

  const spec = useDashboardStore((state) => state.spec);
  const load = useDashboardStore((state) => state.load);
  const setEditMode = useDashboardStore((state) => state.setEditMode);
  const markSaved = useDashboardStore((state) => state.markSaved);
  const savedSpec = useDashboardStore((state) => state.savedSpec);
  const [saving, setSaving] = useState(false);

  // Reload only when the dashboard itself changes: a refetch returns a new
  // spec object, and reloading would wipe unsaved edits and the undo stack.
  const loadedDashboardId = useRef<string | null>(null);
  useEffect(() => {
    if (dashboard?.spec && loadedDashboardId.current !== dashboard.id) {
      loadedDashboardId.current = dashboard.id;
      load(dashboard.spec);
    }
    setEditMode(true);
    return () => setEditMode(false);
  }, [dashboard?.id, dashboard?.spec, load, setEditMode]);

  const dirty = spec && savedSpec ? JSON.stringify(spec) !== JSON.stringify(savedSpec) : false;

  async function save() {
    if (!spec || !dashboard) return;
    setSaving(true);
    try {
      const updated = await api.dashboards.update(dashboard.id, {
        spec,
        name: spec.title,
        theme: spec.theme,
      });
      markSaved(updated.spec);
      toast.success('Personalização salva.');
    } catch {
      toast.error('Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  }

  if (!dataset || !spec || !dashboard) return null;

  const filters = buildFilterPayload(spec);

  return (
    <div className="flex flex-col xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6">
        <div className="mb-5">
          <p className="eyebrow text-ink-subtle">Editor</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em]">Customize</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Arraste para reposicionar, clique em um card para editar suas propriedades.
          </p>
        </div>

        {/*
          The dashboard is the subject of this screen, so it starts at the top.
          The settings that used to sit above it — title, subtitle, theme — now
          live in the properties panel, which had nothing to show until a card
          was clicked.
        */}
        <DashboardGrid
          spec={spec}
          datasetId={dataset.id}
          filters={filters}
          columnProfiles={dataset.profile.columns}
          rowCount={dataset.row_count}
          qualityScore={dataset.quality_score}
          gridId="customize-grid"
        />

        {/*
          Editing happens down the page; a save button pinned to the top of the
          document would be off-screen exactly when it is needed. The bar
          appears only when there is something to save.
        */}
        {dirty && (
          <div className="sticky bottom-0 z-20 -mx-4 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
            <p className="text-[13px] text-ink-muted">Alterações não salvas.</p>
            <Button loading={saving} icon={<Check className="h-4 w-4" />} onClick={save}>
              Salvar alterações
            </Button>
          </div>
        )}
      </div>

      <aside
        className="shrink-0 border-t border-line bg-surface xl:sticky xl:top-14 xl:h-[calc(100vh-3.5rem)] xl:w-72 xl:border-l xl:border-t-0"
        aria-label="Propriedades"
      >
        <WidgetEditor
          columnProfiles={dataset.profile.columns}
          fallback={<DashboardIdentityPanel />}
        />
      </aside>
    </div>
  );
}

/**
 * The panel's resting state: what the dashboard as a whole is called and how it
 * is themed. These settings belong to the dashboard, not to any one widget, so
 * they show exactly when no widget is selected.
 */
function DashboardIdentityPanel() {
  const spec = useDashboardStore((state) => state.spec);
  const updateSpec = useDashboardStore((state) => state.updateSpec);
  const { theme, themes, setTheme } = useTheme();

  if (!spec) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3">
        <p className="text-[13px] font-semibold">Dashboard</p>
        <p className="mono-label mt-0.5 text-[10px] text-ink-subtle">Identidade</p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div className="space-y-3">
          <Input
            label="Título"
            value={spec.title}
            onChange={(event) => updateSpec({ title: event.target.value })}
          />
          <Input
            label="Subtítulo"
            value={spec.subtitle}
            onChange={(event) => updateSpec({ subtitle: event.target.value })}
          />
        </div>

        <div>
          <h3 className="mono-label text-[10px] text-ink-subtle">Tema</h3>
          <div className="rule-dashed mb-3 mt-1.5 opacity-70" />
          <div className="grid gap-2">
            {themes.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={theme === item.id}
                onClick={() => {
                  setTheme(item.id);
                  updateSpec({ theme: item.id });
                }}
                className={cn(
                  'flex items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors',
                  theme === item.id
                    ? 'border-primary bg-primary-soft'
                    : 'border-line hover:border-line-strong',
                )}
              >
                <span className="mt-0.5 flex shrink-0 overflow-hidden rounded-sm border border-line">
                  {item.preview.map((color) => (
                    <span key={color} className="h-5 w-2.5" style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{item.name}</span>
                  <span className="mt-0.5 block text-2xs leading-snug text-ink-subtle">
                    {item.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="flex items-start gap-2 border-t border-line px-4 py-3 text-2xs leading-relaxed text-ink-subtle">
        <MousePointerClick className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        Clique em um card do dashboard para editar suas propriedades aqui.
      </p>
    </div>
  );
}
