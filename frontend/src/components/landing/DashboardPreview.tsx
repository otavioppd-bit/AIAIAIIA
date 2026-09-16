'use client';

import { useMemo } from 'react';
import { EChart } from '@/components/charts/EChart';
import { buildChartOption } from '@/lib/chart-options';
import { useTheme } from '@/hooks/useTheme';
import { PALETTES } from '@/lib/palette';
import { cn } from '@/lib/utils';
import type { WidgetDataResponse } from '@/types/api';

/**
 * A static illustration of the product surface.
 *
 * The numbers below are clearly labelled as an example, never presented as a
 * real analysis — the product's whole premise is that displayed values come
 * from the user's own file.
 */
const EXAMPLE_TREND: WidgetDataResponse = {
  columns: ['mês', 'receita'],
  rows: [
    { 'mês': 'jan', receita: 412000 },
    { 'mês': 'fev', receita: 448000 },
    { 'mês': 'mar', receita: 501000 },
    { 'mês': 'abr', receita: 476000 },
    { 'mês': 'mai', receita: 538000 },
    { 'mês': 'jun', receita: 602000 },
    { 'mês': 'jul', receita: 588000 },
    { 'mês': 'ago', receita: 655000 },
    { 'mês': 'set', receita: 712000 },
  ],
  row_count: 9,
  truncated: false,
  notes: [],
  meta: {},
};

const EXAMPLE_BREAKDOWN: WidgetDataResponse = {
  columns: ['canal', 'receita'],
  rows: [
    { canal: 'E-commerce', receita: 1840000 },
    { canal: 'Loja física', receita: 1310000 },
    { canal: 'Marketplace', receita: 890000 },
    { canal: 'Televendas', receita: 402000 },
  ],
  row_count: 4,
  truncated: false,
  notes: [],
  meta: {},
};

export function DashboardPreview({ className }: { className?: string }) {
  const { mode } = useTheme();
  const palette = PALETTES[mode];

  const trendOption = useMemo(
    () =>
      buildChartOption({
        mode,
        chartType: 'area',
        data: EXAMPLE_TREND,
        encoding: { x: 'mês', y: 'receita', agg: 'sum' },
        style: { showLegend: false, showGrid: true },
        valueFormat: 'currency',
      }),
    [mode],
  );

  const breakdownOption = useMemo(
    () =>
      buildChartOption({
        mode,
        chartType: 'bar_horizontal',
        data: EXAMPLE_BREAKDOWN,
        encoding: { x: 'canal', y: 'receita', agg: 'sum' },
        style: { showLegend: false, showGrid: true },
        valueFormat: 'currency',
      }),
    [mode],
  );

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-line bg-surface shadow-lg',
        className,
      )}
      aria-label="Exemplo de dashboard gerado pela plataforma"
    >
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-sunken px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-negative/50" />
        <span className="h-2 w-2 rounded-full bg-warning/50" />
        <span className="h-2 w-2 rounded-full bg-positive/50" />
        <span className="ml-2 text-2xs text-ink-subtle">vendas_2025.csv — exemplo ilustrativo</span>
      </div>

      <div className="grid gap-3 p-3 sm:grid-cols-4">
        {[
          { label: 'Receita total', value: 'R$ 4,44 mi', delta: '+18,4%' },
          { label: 'Pedidos', value: '12.480', delta: '+9,1%' },
          { label: 'Ticket médio', value: 'R$ 356', delta: '+4,2%' },
          { label: 'Qualidade', value: '92/100', delta: null },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-line bg-surface-sunken p-3">
            <p className="truncate text-2xs text-ink-muted">{kpi.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-[-0.02em]">{kpi.value}</p>
            {kpi.delta && (
              <p className="mt-0.5 text-2xs font-medium text-positive tabular-nums">{kpi.delta}</p>
            )}
          </div>
        ))}

        <div className="rounded-lg border border-line bg-surface-sunken p-3 sm:col-span-3">
          <p className="mb-1 text-xs font-medium">Evolução da receita</p>
          <p className="mb-2 text-2xs text-ink-subtle">Série temporal → linha/área</p>
          <div className="h-40">
            <EChart option={trendOption} resetKey="preview-trend" />
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface-sunken p-3">
          <p className="mb-1 text-xs font-medium">Receita por canal</p>
          <p className="mb-2 text-2xs text-ink-subtle">Comparação → barras</p>
          <div className="h-40">
            <EChart option={breakdownOption} resetKey="preview-breakdown" />
          </div>
        </div>
      </div>
    </div>
  );
}
