'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BarChart3, Check, Download, FileImage, FileText, FileType,
  History, Image as ImageIcon, LayoutGrid, Maximize, Pencil,
  Plus, Redo2, Save, Sheet, Type, Undo2, X, Box,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { useDashboardStore, DEFAULT_WIDGET_STYLE } from '@/store/dashboardStore';
import { api } from '@/lib/api';
import { exportElementToPdf, exportElementToPng } from '@/lib/export';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ColumnProfile, DashboardSpec, DashboardVersion, Widget } from '@/types/api';

interface DashboardToolbarProps {
  dashboardId: string;
  datasetId: string;
  datasetName: string;
  columnProfiles: ColumnProfile[];
  gridElementId: string;
  onSaved?: (spec: DashboardSpec) => void;
}

export function DashboardToolbar({
  dashboardId,
  datasetId,
  datasetName,
  columnProfiles,
  gridElementId,
  onSaved,
}: DashboardToolbarProps) {
  const spec = useDashboardStore((state) => state.spec);
  const editMode = useDashboardStore((state) => state.editMode);
  const setEditMode = useDashboardStore((state) => state.setEditMode);
  const setPresentationMode = useDashboardStore((state) => state.setPresentationMode);
  const undo = useDashboardStore((state) => state.undo);
  const redo = useDashboardStore((state) => state.redo);
  const addWidget = useDashboardStore((state) => state.addWidget);
  const markSaved = useDashboardStore((state) => state.markSaved);
  const past = useDashboardStore((state) => state.past);
  const future = useDashboardStore((state) => state.future);
  const savedSpec = useDashboardStore((state) => state.savedSpec);

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  const dirty = spec && savedSpec ? JSON.stringify(spec) !== JSON.stringify(savedSpec) : false;

  // Keyboard shortcuts mirror what people already expect from editors.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      } else if (meta && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (meta && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
        event.preventDefault();
        redo();
      } else if (event.key === 'e' && !meta) {
        setEditMode(!editMode);
      } else if (event.key === 'p' && !meta) {
        setPresentationMode(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, spec]);

  async function handleSave(label?: string) {
    if (!spec) return;
    setSaving(true);
    try {
      const updated = await api.dashboards.update(dashboardId, {
        spec,
        name: spec.title,
        theme: spec.theme,
        save_version: Boolean(label),
        version_label: label ?? '',
      });
      markSaved(updated.spec);
      onSaved?.(updated.spec);
      toast.success(label ? `Versão “${label}” salva.` : 'Dashboard salvo.');
    } catch {
      toast.error('Não foi possível salvar o dashboard.');
    } finally {
      setSaving(false);
    }
  }

  async function handleExport(kind: 'png' | 'pdf' | 'csv' | 'report') {
    setExporting(true);
    try {
      if (kind === 'csv') {
        await api.exports.download(api.exports.csvUrl(datasetId), `${datasetName}.csv`);
      } else if (kind === 'report') {
        await api.exports.download(api.exports.reportUrl(datasetId), `${datasetName}-insights.md`);
      } else {
        const element = document.getElementById(gridElementId);
        if (!element) throw new Error('Dashboard não encontrado na página.');
        if (kind === 'png') {
          await exportElementToPng(element, spec?.title ?? datasetName);
        } else {
          await exportElementToPdf(element, spec?.title ?? datasetName, {
            title: spec?.title ?? datasetName,
          });
        }
      }
      toast.success('Arquivo gerado.');
      setShowExport(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao exportar.');
    } finally {
      setExporting(false);
    }
  }

  function handleAddWidget(kind: Widget['type']) {
    const metrics = columnProfiles.filter((column) => column.is_aggregatable);
    const dimensions = columnProfiles.filter((column) => column.role === 'dimension');

    const base = {
      title: 'Novo widget',
      subtitle: '',
      layout: { x: 0, y: 0, w: 6, h: 2 },
      rationale: 'Widget adicionado manualmente.',
      principle: '',
      locked: false,
    };

    const widgets: Record<string, Omit<Widget, 'id'>> = {
      chart: {
        ...base,
        type: 'chart',
        title: 'Novo gráfico',
        config: {
          chart_type: 'bar',
          encoding: {
            x: dimensions[0]?.name ?? null,
            y: metrics[0]?.name ?? null,
            agg: (metrics[0]?.detail?.default_agg as 'sum') ?? 'sum',
            limit: 12,
          },
          style: { ...DEFAULT_WIDGET_STYLE },
        },
      },
      text: {
        ...base,
        type: 'text',
        title: 'Texto',
        layout: { x: 0, y: 0, w: 4, h: 1 },
        config: {
          chart_type: 'text',
          encoding: {},
          text: { content: 'Escreva aqui uma anotação ou conclusão.', align: 'left' },
          style: { ...DEFAULT_WIDGET_STYLE, showLegend: false, showGrid: false },
        },
      },
      image: {
        ...base,
        type: 'image',
        title: 'Imagem',
        layout: { x: 0, y: 0, w: 4, h: 2 },
        config: {
          chart_type: 'image',
          encoding: {},
          image: { url: '', alt: '', fit: 'cover' },
          style: { ...DEFAULT_WIDGET_STYLE, showLegend: false, showGrid: false },
        },
      },
      table: {
        ...base,
        type: 'table',
        title: 'Tabela de dados',
        layout: { x: 0, y: 0, w: 12, h: 3 },
        config: {
          chart_type: 'table',
          encoding: { columns: columnProfiles.slice(0, 8).map((column) => column.name) },
          table: { pageSize: 25, virtualized: true },
          style: { ...DEFAULT_WIDGET_STYLE, showLegend: false },
        },
      },
      scene3d: {
        ...base,
        type: 'scene3d',
        title: 'Volume de dados',
        subtitle: 'Densidade de partículas proporcional ao número de registros',
        layout: { x: 0, y: 0, w: 4, h: 2 },
        config: {
          chart_type: 'scene3d',
          encoding: {},
          scene: { variant: 'sphere', intensity: 1 },
          style: { ...DEFAULT_WIDGET_STYLE, showLegend: false, showGrid: false },
        },
      },
      kpi: {
        ...base,
        type: 'kpi',
        title: 'Novo KPI',
        layout: { x: 0, y: 0, w: 3, h: 1 },
        config: {
          chart_type: 'kpi',
          encoding: { y: metrics[0]?.name ?? null, agg: 'sum' },
          kpi: {
            id: 'custom',
            label: metrics[0]?.name ?? 'Registros',
            value: 0,
            format: 'decimal',
            column: metrics[0]?.name ?? null,
            agg: 'sum',
            delta: null,
            rationale: 'KPI adicionado manualmente.',
          },
          style: { ...DEFAULT_WIDGET_STYLE, showLegend: false, showGrid: false },
        },
      },
    };

    const widget = widgets[kind] ?? widgets.chart;
    addWidget(widget);
    setShowAdd(false);
    if (!editMode) setEditMode(true);
    toast.success('Widget adicionado. Configure-o no painel lateral.');
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {editMode && (
          <>
            <IconButton label="Desfazer" size="sm" variant="secondary" disabled={past.length === 0} onClick={undo}>
              <Undo2 className="h-4 w-4" />
            </IconButton>
            <IconButton label="Refazer" size="sm" variant="secondary" disabled={future.length === 0} onClick={redo}>
              <Redo2 className="h-4 w-4" />
            </IconButton>
            <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowAdd(true)}>
              Adicionar
            </Button>
            <IconButton label="Versões salvas" size="sm" variant="secondary" onClick={() => setShowVersions(true)}>
              <History className="h-4 w-4" />
            </IconButton>
          </>
        )}

        <Button
          size="sm"
          variant={editMode ? 'primary' : 'secondary'}
          icon={editMode ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
          onClick={() => setEditMode(!editMode)}
        >
          {editMode ? 'Concluir' : 'Editar'}
        </Button>

        {dirty && (
          <Button size="sm" loading={saving} icon={<Save className="h-3.5 w-3.5" />} onClick={() => handleSave()}>
            Salvar
          </Button>
        )}

        <IconButton label="Exportar" size="sm" variant="secondary" onClick={() => setShowExport(true)}>
          <Download className="h-4 w-4" />
        </IconButton>
        <IconButton label="Modo apresentação" size="sm" variant="secondary" onClick={() => setPresentationMode(true)}>
          <Maximize className="h-4 w-4" />
        </IconButton>
      </div>

      <AddWidgetDialog open={showAdd} onClose={() => setShowAdd(false)} onPick={handleAddWidget} />

      <Dialog
        open={showExport}
        onClose={() => setShowExport(false)}
        title="Exportar"
        description="Escolha o formato de saída."
        size="sm"
      >
        <div className="space-y-2">
          <ExportOption
            icon={<FileImage className="h-4 w-4" />}
            title="Imagem PNG"
            description="Captura do dashboard como está na tela."
            disabled={exporting}
            onClick={() => handleExport('png')}
          />
          <ExportOption
            icon={<FileType className="h-4 w-4" />}
            title="Documento PDF"
            description="Página A4 paisagem, pronta para enviar."
            disabled={exporting}
            onClick={() => handleExport('pdf')}
          />
          <ExportOption
            icon={<Sheet className="h-4 w-4" />}
            title="Dados em CSV"
            description="Conjunto de dados tratado, com tipos já convertidos."
            disabled={exporting}
            onClick={() => handleExport('csv')}
          />
          <ExportOption
            icon={<FileText className="h-4 w-4" />}
            title="Relatório de insights"
            description="Markdown com achados, tendências, correlações e qualidade."
            disabled={exporting}
            onClick={() => handleExport('report')}
          />
        </div>
      </Dialog>

      <VersionsDialog
        open={showVersions}
        onClose={() => setShowVersions(false)}
        dashboardId={dashboardId}
        onSaveVersion={(label) => handleSave(label)}
      />
    </>
  );
}

function ExportOption({
  icon,
  title,
  description,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-start gap-3 rounded-lg border border-line p-3 text-left transition-all
        hover:border-primary/40 hover:bg-primary-soft/40 disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="mt-0.5 text-primary">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-subtle">{description}</span>
      </span>
    </button>
  );
}

const WIDGET_KINDS: { kind: Widget['type']; label: string; description: string; icon: React.ReactNode }[] = [
  { kind: 'chart', label: 'Gráfico', description: 'Linha, barras, dispersão e mais 11 tipos.', icon: <BarChart3 className="h-4 w-4" /> },
  { kind: 'kpi', label: 'KPI', description: 'Um número em destaque, com variação.', icon: <LayoutGrid className="h-4 w-4" /> },
  { kind: 'table', label: 'Tabela', description: 'Registros detalhados, virtualizados.', icon: <Sheet className="h-4 w-4" /> },
  { kind: 'text', label: 'Texto', description: 'Anotações e conclusões.', icon: <Type className="h-4 w-4" /> },
  { kind: 'image', label: 'Imagem', description: 'Logotipo ou captura externa.', icon: <ImageIcon className="h-4 w-4" /> },
  { kind: 'scene3d', label: 'Objeto 3D', description: 'Treliça de dados que acompanha os filtros.', icon: <Box className="h-4 w-4" /> },
];

function AddWidgetDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (kind: Widget['type']) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Adicionar widget" size="md">
      <div className="grid gap-2 sm:grid-cols-2">
        {WIDGET_KINDS.map((item) => (
          <button
            key={item.kind}
            type="button"
            onClick={() => onPick(item.kind)}
            className="flex items-start gap-3 rounded-lg border border-line p-3 text-left transition-all
              hover:border-primary/40 hover:bg-primary-soft/40"
          >
            <span className="mt-0.5 text-primary">{item.icon}</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{item.label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-ink-subtle">{item.description}</span>
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

function VersionsDialog({
  open,
  onClose,
  dashboardId,
  onSaveVersion,
}: {
  open: boolean;
  onClose: () => void;
  dashboardId: string;
  onSaveVersion: (label: string) => void;
}) {
  const [versions, setVersions] = useState<DashboardVersion[]>([]);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useDashboardStore((state) => state.load);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.dashboards
      .versions(dashboardId)
      .then(setVersions)
      .catch(() => toast.error('Não foi possível carregar as versões.'))
      .finally(() => setLoading(false));
  }, [open, dashboardId]);

  async function restore(versionId: string) {
    try {
      const restored = await api.dashboards.restoreVersion(dashboardId, versionId);
      load(restored.spec);
      toast.success('Versão restaurada.');
      onClose();
    } catch {
      toast.error('Não foi possível restaurar a versão.');
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Versões do dashboard"
      description="Salve um ponto de restauração antes de mudanças grandes."
      size="md"
    >
      <div className="flex gap-2">
        <Input
          placeholder="Nome da versão (ex.: antes da revisão)"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Button
          disabled={!label.trim()}
          onClick={() => {
            onSaveVersion(label.trim());
            setLabel('');
            onClose();
          }}
        >
          Salvar versão
        </Button>
      </div>

      <div className="mt-4 space-y-1.5">
        {loading ? (
          <p className="py-4 text-center text-[13px] text-ink-subtle">Carregando…</p>
        ) : versions.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-ink-subtle">
            Nenhuma versão salva ainda.
          </p>
        ) : (
          versions.map((version) => (
            <div
              key={version.id}
              className="flex items-center justify-between gap-3 rounded-md border border-line p-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{version.label}</p>
                <p className="text-xs text-ink-subtle">
                  v{version.version} · {formatRelativeTime(version.created_at)}
                </p>
              </div>
              <Button size="xs" variant="secondary" onClick={() => restore(version.id)}>
                Restaurar
              </Button>
            </div>
          ))
        )}
      </div>
    </Dialog>
  );
}
