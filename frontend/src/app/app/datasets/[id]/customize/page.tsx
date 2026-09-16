'use client';

import { useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Check, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { WidgetEditor } from '@/components/dashboard/WidgetEditor';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { api } from '@/lib/api';
import { useDataset, usePrimaryDashboard } from '@/hooks/useDataset';
import { useTheme } from '@/hooks/useTheme';
import { buildFilterPayload, useDashboardStore } from '@/store/dashboardStore';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export default function CustomizePage() {
  const params = useParams<{ id: string }>();
  const { data: dataset } = useDataset(params.id);
  const { dashboard } = usePrimaryDashboard(params.id);
  const { theme, themes, setTheme } = useTheme();

  const spec = useDashboardStore((state) => state.spec);
  const load = useDashboardStore((state) => state.load);
  const updateSpec = useDashboardStore((state) => state.updateSpec);
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
      <div className="min-w-0 flex-1 p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.02em]">Customize</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              Clique em qualquer card para editar título, métricas, cores e tamanho.
            </p>
          </div>
          {dirty && (
            <Button loading={saving} icon={<Check className="h-4 w-4" />} onClick={save}>
              Salvar alterações
            </Button>
          )}
        </div>

        <Card className="mb-5">
          <CardHeader>
            <div>
              <CardTitle>Identidade do dashboard</CardTitle>
              <CardDescription>Título, subtítulo e tema aplicado à interface.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
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
              <span className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-ink-muted">
                <Palette className="h-3.5 w-3.5" />
                Tema
              </span>
              <div className="grid gap-2 sm:grid-cols-3">
                {themes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTheme(item.id);
                      updateSpec({ theme: item.id });
                    }}
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-all',
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
          </CardContent>
        </Card>

        <DashboardGrid
          spec={spec}
          datasetId={dataset.id}
          filters={filters}
          columnProfiles={dataset.profile.columns}
          rowCount={dataset.row_count}
          qualityScore={dataset.quality_score}
          gridId="customize-grid"
        />
      </div>

      <aside
        className="shrink-0 border-t border-line bg-surface xl:sticky xl:top-14 xl:h-[calc(100vh-3.5rem)] xl:w-72 xl:border-l xl:border-t-0"
        aria-label="Propriedades do widget"
      >
        <WidgetEditor columnProfiles={dataset.profile.columns} />
      </aside>
    </div>
  );
}
