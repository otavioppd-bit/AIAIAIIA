'use client';

import { useMemo } from 'react';
import { Palette, Settings2, SlidersHorizontal, Type } from 'lucide-react';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { AccentPicker, SegmentedControl, Slider, Switch } from '@/components/ui/Controls';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { useDashboardStore } from '@/store/dashboardStore';
import { AGGREGATION_LABELS, TIME_GRAIN_LABELS, humanize } from '@/lib/format';
import type { Aggregation, ChartType, ColumnProfile, TimeGrain, Widget } from '@/types/api';
import { useState } from 'react';

const CHART_TYPE_OPTIONS: { value: ChartType; label: string }[] = [
  { value: 'line', label: 'Linha' },
  { value: 'area', label: 'Área' },
  { value: 'bar', label: 'Barras verticais' },
  { value: 'bar_horizontal', label: 'Barras horizontais' },
  { value: 'stacked_bar', label: 'Barras empilhadas' },
  { value: 'scatter', label: 'Dispersão' },
  { value: 'donut', label: 'Rosca' },
  { value: 'pie', label: 'Pizza' },
  { value: 'histogram', label: 'Histograma' },
  { value: 'box_plot', label: 'Box plot' },
  { value: 'heatmap', label: 'Mapa de calor' },
  { value: 'treemap', label: 'Treemap' },
  { value: 'radar', label: 'Radar' },
  { value: 'funnel', label: 'Funil' },
  { value: 'table', label: 'Tabela' },
];

const AGG_OPTIONS = (Object.keys(AGGREGATION_LABELS) as Aggregation[]).map((value) => ({
  value,
  label: AGGREGATION_LABELS[value],
}));

const GRAIN_OPTIONS = (Object.keys(TIME_GRAIN_LABELS) as TimeGrain[]).map((value) => ({
  value,
  label: TIME_GRAIN_LABELS[value],
}));

export function WidgetEditor({ columnProfiles }: { columnProfiles: ColumnProfile[] }) {
  const [tab, setTab] = useState('data');
  const spec = useDashboardStore((state) => state.spec);
  const selectedId = useDashboardStore((state) => state.selectedWidgetId);
  const updateWidget = useDashboardStore((state) => state.updateWidget);
  const updateWidgetConfig = useDashboardStore((state) => state.updateWidgetConfig);
  const updateWidgetStyle = useDashboardStore((state) => state.updateWidgetStyle);
  const updateWidgetLayout = useDashboardStore((state) => state.updateWidgetLayout);

  const widget = useMemo(
    () => spec?.widgets.find((item) => item.id === selectedId) ?? null,
    [spec, selectedId],
  );

  if (!widget) {
    return (
      <EmptyState
        compact
        icon={<SlidersHorizontal className="h-4 w-4" />}
        title="Nenhum widget selecionado"
        description="Clique em um card do dashboard para editar suas propriedades."
      />
    );
  }

  const dimensions = columnProfiles.filter((c) => c.role === 'dimension' || c.role === 'temporal');
  const metrics = columnProfiles.filter((c) => c.is_aggregatable);
  const encoding = widget.config.encoding;
  const style = widget.config.style;
  const isChart = widget.type === 'chart';

  const columnOptions = (list: ColumnProfile[]) =>
    list.map((column) => ({ value: column.name, label: humanize(column.name) }));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3">
        <p className="truncate text-[13px] font-semibold" title={widget.title}>
          {widget.title}
        </p>
        <p className="mt-0.5 text-2xs uppercase tracking-wide text-ink-subtle">
          {widget.type === 'chart' ? widget.config.chart_type : widget.type}
        </p>
      </div>

      <div className="border-b border-line px-4 py-2.5">
        <Tabs
          size="sm"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'data', label: 'Dados', icon: <Settings2 className="h-3 w-3" /> },
            { id: 'style', label: 'Estilo', icon: <Palette className="h-3 w-3" /> },
            { id: 'layout', label: 'Layout', icon: <Type className="h-3 w-3" /> },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {tab === 'data' && (
          <>
            <Input
              label="Título"
              value={widget.title}
              onChange={(event) => updateWidget(widget.id, { title: event.target.value })}
            />
            <Input
              label="Subtítulo"
              value={widget.subtitle}
              placeholder="Opcional"
              onChange={(event) => updateWidget(widget.id, { subtitle: event.target.value })}
            />

            {isChart && (
              <>
                <Select
                  label="Tipo de gráfico"
                  value={widget.config.chart_type}
                  options={CHART_TYPE_OPTIONS}
                  onChange={(event) =>
                    updateWidgetConfig(widget.id, { chart_type: event.target.value as ChartType })
                  }
                />

                <Select
                  label="Dimensão (eixo X)"
                  value={encoding.x ?? ''}
                  placeholder="Nenhuma"
                  options={columnOptions(
                    widget.config.chart_type === 'scatter' ? metrics : dimensions,
                  )}
                  onChange={(event) =>
                    updateWidgetConfig(widget.id, {
                      encoding: { ...encoding, x: event.target.value || null },
                    })
                  }
                />

                <Select
                  label="Métrica (eixo Y)"
                  value={encoding.y ?? ''}
                  placeholder="Contagem de registros"
                  options={columnOptions(metrics)}
                  onChange={(event) =>
                    updateWidgetConfig(widget.id, {
                      encoding: { ...encoding, y: event.target.value || null },
                    })
                  }
                />

                <Select
                  label="Série (segmentação)"
                  value={encoding.series ?? ''}
                  placeholder="Nenhuma"
                  options={columnOptions(dimensions)}
                  onChange={(event) =>
                    updateWidgetConfig(widget.id, {
                      encoding: { ...encoding, series: event.target.value || null },
                    })
                  }
                />

                <Select
                  label="Agregação"
                  value={encoding.agg ?? 'sum'}
                  options={AGG_OPTIONS}
                  onChange={(event) =>
                    updateWidgetConfig(widget.id, {
                      encoding: { ...encoding, agg: event.target.value as Aggregation },
                    })
                  }
                />

                {encoding.x &&
                  columnProfiles.find((c) => c.name === encoding.x)?.role === 'temporal' && (
                    <Select
                      label="Granularidade temporal"
                      value={encoding.time_grain ?? 'month'}
                      options={GRAIN_OPTIONS}
                      onChange={(event) =>
                        updateWidgetConfig(widget.id, {
                          encoding: { ...encoding, time_grain: event.target.value as TimeGrain },
                        })
                      }
                    />
                  )}

                <Slider
                  label="Limite de resultados"
                  value={encoding.limit ?? 20}
                  min={3}
                  max={100}
                  step={1}
                  onChange={(value) =>
                    updateWidgetConfig(widget.id, { encoding: { ...encoding, limit: value } })
                  }
                />

                {/* Additive check mirrors the backend: summing a unit price or
                    a rate is meaningless, so the editor says so. */}
                {encoding.y &&
                  encoding.agg === 'sum' &&
                  columnProfiles.find((c) => c.name === encoding.y)?.detail?.additive === false && (
                    <p className="rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs leading-relaxed text-warning">
                      “{humanize(encoding.y)}” não é uma medida aditiva (preço unitário, taxa ou
                      nota). Somar valores desse tipo produz um número sem significado — prefira
                      média ou mediana.
                    </p>
                  )}
              </>
            )}

            {widget.type === 'text' && (
              <Textarea
                label="Conteúdo"
                rows={6}
                value={widget.config.text?.content ?? ''}
                onChange={(event) =>
                  updateWidgetConfig(widget.id, {
                    text: {
                      content: event.target.value,
                      align: widget.config.text?.align ?? 'left',
                    },
                  })
                }
              />
            )}

            {widget.type === 'image' && (
              <>
                <Input
                  label="URL da imagem"
                  placeholder="https://…"
                  value={widget.config.image?.url ?? ''}
                  onChange={(event) =>
                    updateWidgetConfig(widget.id, {
                      image: {
                        url: event.target.value,
                        alt: widget.config.image?.alt ?? '',
                        fit: widget.config.image?.fit ?? 'cover',
                      },
                    })
                  }
                />
                <Input
                  label="Texto alternativo"
                  hint="Descreve a imagem para leitores de tela."
                  value={widget.config.image?.alt ?? ''}
                  onChange={(event) =>
                    updateWidgetConfig(widget.id, {
                      image: {
                        url: widget.config.image?.url ?? '',
                        alt: event.target.value,
                        fit: widget.config.image?.fit ?? 'cover',
                      },
                    })
                  }
                />
              </>
            )}
          </>
        )}

        {tab === 'style' && (
          <>
            <AccentPicker
              value={style.accent}
              onChange={(accent) => updateWidgetStyle(widget.id, { accent })}
            />

            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">Sombra</span>
              <SegmentedControl
                value={style.shadow}
                onChange={(shadow) => updateWidgetStyle(widget.id, { shadow })}
                options={[
                  { value: 'none', label: 'Nenhuma' },
                  { value: 'sm', label: 'Sutil' },
                  { value: 'md', label: 'Média' },
                  { value: 'lg', label: 'Forte' },
                ]}
              />
            </div>

            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">Cantos</span>
              <SegmentedControl
                value={style.radius}
                onChange={(radius) => updateWidgetStyle(widget.id, { radius })}
                options={[
                  { value: 'sm', label: 'Reto' },
                  { value: 'md', label: 'Leve' },
                  { value: 'lg', label: 'Médio' },
                  { value: 'xl', label: 'Amplo' },
                ]}
              />
            </div>

            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">Espaçamento</span>
              <SegmentedControl
                value={style.padding}
                onChange={(padding) => updateWidgetStyle(widget.id, { padding })}
                options={[
                  { value: 'sm', label: 'Compacto' },
                  { value: 'md', label: 'Normal' },
                  { value: 'lg', label: 'Amplo' },
                ]}
              />
            </div>

            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">Título</span>
              <SegmentedControl
                value={style.titleSize}
                onChange={(titleSize) => updateWidgetStyle(widget.id, { titleSize })}
                options={[
                  { value: 'sm', label: 'P' },
                  { value: 'md', label: 'M' },
                  { value: 'lg', label: 'G' },
                ]}
              />
            </div>

            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">Fonte</span>
              <SegmentedControl
                value={style.fontFamily}
                onChange={(fontFamily) => updateWidgetStyle(widget.id, { fontFamily })}
                options={[
                  { value: 'sans', label: 'Sans' },
                  { value: 'display', label: 'Display' },
                  { value: 'mono', label: 'Mono' },
                ]}
              />
            </div>

            <div className="space-y-3 border-t border-line pt-4">
              <Switch
                label="Borda"
                checked={style.border}
                onChange={(border) => updateWidgetStyle(widget.id, { border })}
              />
              <Switch
                label="Fundo transparente"
                checked={style.background === 'transparent'}
                onChange={(value) =>
                  updateWidgetStyle(widget.id, { background: value ? 'transparent' : 'surface' })
                }
              />
              {isChart && (
                <>
                  <Switch
                    label="Legenda"
                    checked={style.showLegend}
                    onChange={(showLegend) => updateWidgetStyle(widget.id, { showLegend })}
                  />
                  <Switch
                    label="Linhas de grade"
                    checked={style.showGrid}
                    onChange={(showGrid) => updateWidgetStyle(widget.id, { showGrid })}
                  />
                  <Switch
                    label="Rótulos de valor"
                    description="Use com moderação: um número em cada marca vira ruído."
                    checked={style.showDataLabels}
                    onChange={(showDataLabels) => updateWidgetStyle(widget.id, { showDataLabels })}
                  />
                </>
              )}
            </div>
          </>
        )}

        {tab === 'layout' && (
          <>
            <Slider
              label="Largura (colunas)"
              value={widget.layout.w}
              min={2}
              max={spec?.grid?.columns ?? 12}
              step={1}
              formatValue={(value) => `${value} / ${spec?.grid?.columns ?? 12}`}
              onChange={(w) => updateWidgetLayout(widget.id, { w })}
            />
            <Slider
              label="Altura (linhas)"
              value={widget.layout.h}
              min={1}
              max={6}
              step={1}
              onChange={(h) => updateWidgetLayout(widget.id, { h })}
            />
            <div className="rounded-md bg-surface-sunken p-3">
              <p className="text-xs leading-relaxed text-ink-subtle">
                Arraste pelo ícone <span className="font-medium text-ink-muted">⠿</span> no canto do
                card para reorganizar a ordem dos widgets.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
