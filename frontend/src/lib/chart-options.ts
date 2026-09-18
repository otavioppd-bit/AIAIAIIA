/**
 * ECharts option builders.
 *
 * Mark specs applied throughout, per the data-viz method:
 *  - 2px lines, ≥8px markers, 4px rounded bar ends anchored to the baseline
 *  - a 2px surface-coloured gap between adjacent/stacked fills (never a border)
 *  - solid hairline grid one shade off the surface (never dashed)
 *  - a legend whenever there are ≥2 series; selective direct labels only
 *  - crosshair + tooltip on continuous forms, per-mark tooltip elsewhere
 *  - one Y axis. Ever. Different scales are indexed to 100 upstream.
 */
import type { EChartsOption } from 'echarts';
import type { ChartEncoding, ChartType, DataRow, WidgetDataResponse } from '@/types/api';
import {
  ALL_PAIRS_SAFE_SLOTS,
  MAX_CATEGORICAL_SERIES,
  PALETTES,
  createColorScale,
  divergingRamp,
  accentColor,
} from '@/lib/palette';
import { compactNumber, formatValue, humanize, type ValueFormat } from '@/lib/format';
import { normalizeRegionKey, type GeoScope } from '@/lib/geo-names';

export type ThemeMode = 'light' | 'dark';

export interface BuildContext {
  mode: ThemeMode;
  chartType: ChartType;
  data: WidgetDataResponse;
  encoding: ChartEncoding & { [key: string]: unknown };
  style?: {
    showLegend?: boolean;
    showGrid?: boolean;
    showDataLabels?: boolean;
    accent?: string;
    colorScheme?: string;
  };
  /**
   * Every value the colour dimension can take, from the column profile. Lets a
   * filtered view keep the same hues as the unfiltered one.
   */
  colorDomain?: string[];
  valueFormat?: ValueFormat;
  compact?: boolean;
  options?: Record<string, unknown>;
  /** Registered geometry + name aliases, present once a map's asset loaded. */
  geo?: { scope: GeoScope; aliases: Record<string, string> };
}

const AXIS_FONT = 11;
const LABEL_FONT = 11;

function baseTextStyle(mode: ThemeMode) {
  return {
    fontFamily: 'var(--font-sans), Inter, system-ui, sans-serif',
    color: PALETTES[mode].textSecondary,
    fontSize: AXIS_FONT,
  };
}

/**
 * Figures on an axis are instrument output, so they are set in the monospace
 * face: the digits align column to column and the tick labels stop shifting
 * width as the values change.
 */
function numericTextStyle(mode: ThemeMode) {
  return {
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
    color: PALETTES[mode].textMuted,
    fontSize: 10,
  };
}

function tooltipBase(mode: ThemeMode) {
  const palette = PALETTES[mode];
  return {
    backgroundColor: mode === 'dark' ? 'rgba(20,20,20,0.97)' : 'rgba(255,255,255,0.98)',
    borderColor: mode === 'dark' ? 'rgba(128,128,128,0.45)' : 'rgba(0,0,0,0.18)',
    borderWidth: 1,
    padding: [9, 11],
    // A hairline and a tight radius, no drop shadow: the tooltip is another
    // element of the drawing, not a floating card.
    extraCssText: 'border-radius:4px;box-shadow:none;',
    textStyle: { color: palette.textPrimary, fontSize: 12, fontFamily: 'var(--font-sans)' },
  };
}

/** Plot padding. `containLabel` reserves room for the axis band so labels are
 *  never clipped by the card's own height. */
function gridBase() {
  return {
    show: false,
    left: 8,
    right: 16,
    top: 16,
    bottom: 8,
    containLabel: true,
  };
}

function axisLineStyle(mode: ThemeMode) {
  return { show: true, lineStyle: { color: PALETTES[mode].axis, width: 1, type: 'solid' as const } };
}

function splitLineStyle(show: boolean, mode: ThemeMode) {
  // Solid hairline. Dashed gridlines read as "threshold" and add noise.
  return { show, lineStyle: { color: PALETTES[mode].grid, width: 1, type: 'solid' as const } };
}

/** Truncate long category labels; the tooltip always carries the full text. */
function truncate(value: string, max = 16): string {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function axisValueFormatter(format: ValueFormat, compact = true) {
  return (value: number) => {
    if (!Number.isFinite(value)) return '';
    if (format === 'percent') return `${compactNumber(value)}%`;
    if (format === 'currency') {
      return Math.abs(value) >= 1000 ? `R$ ${compactNumber(value)}` : `R$ ${value.toFixed(0)}`;
    }
    return compact ? compactNumber(value) : String(value);
  };
}

function measureColumns(ctx: BuildContext): string[] {
  const { data, encoding } = ctx;
  const groupColumns = new Set(
    [encoding.x, encoding.series].filter((c): c is string => Boolean(c)),
  );
  return data.columns.filter((c) => !groupColumns.has(c));
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function buildChartOption(ctx: BuildContext): EChartsOption {
  return withToolbox(ctx, buildChartOptionInner(ctx));
}

function buildChartOptionInner(ctx: BuildContext): EChartsOption {
  switch (ctx.chartType) {
    case 'line':
    case 'area':
      return buildLine(ctx, ctx.chartType === 'area');
    case 'bar':
      return buildBar(ctx, 'vertical', false);
    case 'bar_horizontal':
      return buildBar(ctx, 'horizontal', false);
    case 'stacked_bar':
      return buildBar(ctx, 'vertical', true);
    case 'donut':
      return buildPie(ctx, true);
    case 'pie':
      return buildPie(ctx, false);
    case 'scatter':
      return buildScatter(ctx);
    case 'histogram':
      return buildHistogram(ctx);
    case 'box_plot':
      return buildBoxPlot(ctx);
    case 'heatmap':
      return buildHeatmap(ctx);
    case 'treemap':
      return buildTreemap(ctx);
    case 'radar':
      return buildRadar(ctx);
    case 'funnel':
      return buildFunnel(ctx);
    case 'map':
      return buildMap(ctx);
    default:
      return buildBar(ctx, 'vertical', false);
  }
}

/**
 * Restore + save-as-image on every chart. The zoom toggle only makes sense
 * where a `dataZoom` was actually wired in (see buildLine/buildBar/buildScatter);
 * offering it elsewhere would open a brush that does nothing.
 *
 * Positioned left of the card's own "view as table" toggle (top-right, ~28px)
 * so the two overlays never collide.
 */
function withToolbox(ctx: BuildContext, option: EChartsOption): EChartsOption {
  const palette = PALETTES[ctx.mode];
  const hasZoom = Boolean((option as { dataZoom?: unknown }).dataZoom);
  return {
    ...option,
    toolbox: {
      show: true,
      top: 2,
      right: 34,
      itemSize: 13,
      itemGap: 6,
      iconStyle: { borderColor: palette.textMuted, borderWidth: 1.5 },
      emphasis: { iconStyle: { borderColor: palette.textPrimary } },
      tooltip: { ...tooltipBase(ctx.mode), padding: [4, 8] },
      feature: {
        ...(hasZoom
          ? {
              // Inherits the axis indices from the `dataZoom` array each
              // builder already wired (category axis for bar, both for
              // scatter) — no override needed here.
              dataZoom: { show: true, title: { zoom: 'Zoom', back: 'Restaurar zoom' } },
            }
          : {}),
        restore: { show: true, title: 'Restaurar' },
        saveAsImage: { show: true, title: 'Salvar imagem', pixelRatio: 2 },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Line / area
// ---------------------------------------------------------------------------

function buildLine(ctx: BuildContext, filled: boolean): EChartsOption {
  const { mode, data, encoding, style = {}, valueFormat = 'decimal' } = ctx;
  const palette = PALETTES[mode];
  const xKey = encoding.x ?? data.columns[0];
  const seriesKey = encoding.series;
  const measures = measureColumns(ctx);
  const showLegend = style.showLegend !== false;
  const indexed = Boolean(ctx.options?.normalize === 'index_100' || data.meta?.normalized);
  const format: ValueFormat = indexed ? 'decimal' : valueFormat;

  const scale = createColorScale(mode);
  let categories: string[];
  let series: Record<string, unknown>[];

  if (seriesKey) {
    // Long format: one line per distinct value of the series column.
    categories = uniqueValues(data.rows, xKey);
    const groups = uniqueValues(data.rows, seriesKey).slice(0, MAX_CATEGORICAL_SERIES);
    seedStable(scale, groups, ctx.colorDomain);
    const measure = measures[0];
    series = groups.map((group, index) => ({
      name: group,
      type: 'line',
      smooth: 0.24,
      smoothMonotone: 'x',
      symbol: 'circle',
      symbolSize: 8,
      showSymbol: categories.length <= 24,
      sampling: 'lttb',
      lineStyle: { width: 2, color: scale.get(group) },
      itemStyle: { color: scale.get(group), borderWidth: 2, borderColor: palette.surface },
      areaStyle: filled ? areaGradient(scale.get(group), mode, groups.length) : undefined,
      emphasis: { focus: 'series', lineStyle: { width: 3 } },
      data: categories.map((category) => {
        const row = data.rows.find(
          (r) => String(r[xKey]) === category && String(r[seriesKey]) === group,
        );
        return row ? toNumber(row[measure]) : null;
      }),
      z: 10 - index,
    }));
  } else {
    categories = data.rows.map((row) => String(row[xKey] ?? ''));
    const lineMeasures = measures.slice(0, MAX_CATEGORICAL_SERIES);
    seedStable(scale, lineMeasures);
    series = lineMeasures.map((measure, index) => ({
      name: humanize(measure),
      type: 'line',
      smooth: 0.24,
      smoothMonotone: 'x',
      symbol: 'circle',
      symbolSize: 8,
      showSymbol: categories.length <= 24,
      sampling: 'lttb',
      lineStyle: { width: 2, color: scale.get(measure) },
      itemStyle: { color: scale.get(measure), borderWidth: 2, borderColor: palette.surface },
      areaStyle:
        filled && lineMeasures.length === 1
          ? areaGradient(scale.get(measure), mode, 1)
          : undefined,
      emphasis: { focus: 'series', lineStyle: { width: 3 } },
      // Direct-label the final point only — never every point.
      endLabel:
        lineMeasures.length > 1 && lineMeasures.length <= 4
          ? {
              show: true,
              formatter: fmt<MarkParams>((params) => params.seriesName),
              color: scale.get(measure),
              fontSize: LABEL_FONT,
              fontWeight: 600,
              distance: 6,
            }
          : { show: false },
      data: data.rows.map((row) => toNumber(row[measure])),
      z: 10 - index,
    }));
  }

  return {
    animationDuration: 520,
    animationEasing: 'cubicOut',
    grid: { ...gridBase(), right: series.length > 1 ? 54 : 16 },
    legend: legendConfig(showLegend && series.length > 1, mode),
    tooltip: {
      ...tooltipBase(mode),
      trigger: 'axis',
      axisPointer: {
        type: 'line',
        lineStyle: { color: palette.axis, width: 1, type: 'solid' },
        snap: true,
      },
      valueFormatter: (value) =>
        indexed
          ? `${formatValue(toNumber(value), 'decimal')} (base 100)`
          : formatValue(toNumber(value), format),
    },
    xAxis: {
      type: 'category',
      data: categories,
      boundaryGap: false,
      axisLine: axisLineStyle(mode),
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        ...baseTextStyle(mode),
        color: palette.textMuted,
        hideOverlap: true,
        formatter: (value: string) => truncate(value, 12),
      },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: splitLineStyle(style.showGrid !== false, mode),
      axisLabel: {
        ...numericTextStyle(mode),
        formatter: axisValueFormatter(format),
      },
      // Index charts read against their 100 baseline.
      ...(indexed ? { min: 'dataMin' as const } : {}),
    },
    series: series as EChartsOption['series'],
    // A long series is hard to read compressed into one card: scroll/pinch to
    // zoom the time range, drag to pan. No visible slider — this is a
    // compact dashboard tile, not a full-page chart, so the interaction stays
    // invisible until used rather than spending vertical space on a handle.
    dataZoom: categories.length > 24 ? [{ type: 'inside', throttle: 50 }] : undefined,
  };
}

function areaGradient(color: string, mode: ThemeMode, seriesCount: number) {
  const topOpacity = seriesCount > 1 ? 0.18 : 0.26;
  return {
    opacity: 1,
    color: {
      type: 'linear' as const,
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: withAlpha(color, topOpacity) },
        { offset: 1, color: withAlpha(color, 0.02) },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

function buildBar(
  ctx: BuildContext,
  orientation: 'vertical' | 'horizontal',
  stacked: boolean,
): EChartsOption {
  const { mode, data, encoding, style = {}, valueFormat = 'decimal' } = ctx;
  const palette = PALETTES[mode];
  const xKey = encoding.x ?? data.columns[0];
  const seriesKey = encoding.series;
  const measures = measureColumns(ctx);
  const measure = measures[0];
  const horizontal = orientation === 'horizontal';
  const scale = createColorScale(mode);

  // A horizontal ranking reads top-to-bottom, so the rows are reversed.
  const rows = horizontal ? [...data.rows].reverse() : data.rows;

  let categories: string[];
  let series: Record<string, unknown>[];

  if (seriesKey) {
    categories = uniqueValues(rows, xKey);
    const groups = uniqueValues(rows, seriesKey).slice(0, MAX_CATEGORICAL_SERIES);
    seedStable(scale, groups, ctx.colorDomain);
    series = groups.map((group) => ({
      name: group,
      type: 'bar',
      stack: stacked ? 'total' : undefined,
      barMaxWidth: 34,
      barGap: '12%',
      barCategoryGap: '32%',
      itemStyle: {
        color: scale.get(group),
        borderRadius: stacked ? 2 : roundedEnds(horizontal),
        // A 2px surface gap separates fills — never a stroke around the mark.
        borderColor: palette.surface,
        borderWidth: stacked ? 2 : 0,
      },
      emphasis: { focus: 'series' },
      data: categories.map((category) => {
        const row = rows.find(
          (r) => String(r[xKey]) === category && String(r[seriesKey]) === group,
        );
        return row ? toNumber(row[measure]) : null;
      }),
    }));
  } else {
    categories = rows.map((row) => String(row[xKey] ?? ''));
    // One series → one colour for every bar. Never a value-ramp on nominal
    // categories: that double-encodes bar length as hue.
    const color = accentColor(style.accent ?? 'primary', mode);
    series = [
      {
        name: humanize(measure ?? 'valor'),
        type: 'bar',
        barMaxWidth: horizontal ? 22 : 40,
        barCategoryGap: '34%',
        itemStyle: { color, borderRadius: roundedEnds(horizontal) },
        emphasis: { itemStyle: { color: withAlpha(color, 0.85) } },
        label: style.showDataLabels
          ? {
              show: true,
              position: horizontal ? 'right' : 'top',
              color: palette.textSecondary,
              fontSize: LABEL_FONT,
              formatter: fmt<MarkParams>((params) =>
                formatValue(params.value, valueFormat, { compact: true }),
              ),
            }
          : { show: false },
        data: rows.map((row) => toNumber(row[measure])),
      },
    ];
  }

  const categoryAxis = {
    type: 'category' as const,
    data: categories,
    axisLine: axisLineStyle(mode),
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: {
      ...baseTextStyle(mode),
      color: palette.textMuted,
      hideOverlap: true,
      width: horizontal ? 120 : undefined,
      overflow: horizontal ? ('truncate' as const) : undefined,
      formatter: (value: string) => truncate(value, horizontal ? 18 : 12),
      interval: 0,
      rotate: !horizontal && categories.length > 8 ? 30 : 0,
    },
  };

  const valueAxis = {
    type: 'value' as const,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: splitLineStyle(style.showGrid !== false, mode),
    axisLabel: {
      ...numericTextStyle(mode),
      formatter: axisValueFormatter(valueFormat),
    },
  };

  return {
    animationDuration: 460,
    animationEasing: 'cubicOut',
    grid: gridBase(),
    legend: legendConfig(style.showLegend !== false && series.length > 1, mode),
    tooltip: {
      ...tooltipBase(mode),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: withAlpha(palette.textPrimary, 0.05) } },
      valueFormatter: (value) => formatValue(toNumber(value), valueFormat),
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: series as EChartsOption['series'],
    // The category axis is the one worth scrolling through — X normally,
    // but Y once the chart is flipped horizontal — so the zoom targets
    // whichever axis index actually carries the categories.
    dataZoom:
      categories.length > 16
        ? [
            horizontal
              ? { type: 'inside', yAxisIndex: 0, throttle: 50 }
              : { type: 'inside', xAxisIndex: 0, throttle: 50 },
          ]
        : undefined,
  };
}

/** 4px rounded ends on the data end only, anchored to the baseline. */
function roundedEnds(horizontal: boolean): number[] {
  return horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
}

// ---------------------------------------------------------------------------
// Pie / donut
// ---------------------------------------------------------------------------

function buildPie(ctx: BuildContext, donut: boolean): EChartsOption {
  const { mode, data, encoding, style = {}, valueFormat = 'decimal' } = ctx;
  const palette = PALETTES[mode];
  const labelKey = encoding.x ?? data.columns[0];
  const measure = measureColumns(ctx)[0];

  const rows = data.rows.slice(0, MAX_CATEGORICAL_SERIES);
  const scale = createColorScale(mode);
  seedStable(scale, rows.map((row) => String(row[labelKey] ?? '')), ctx.colorDomain);

  const total = rows.reduce((sum, row) => sum + (toNumber(row[measure]) ?? 0), 0);

  return {
    animationDuration: 520,
    legend: legendConfig(style.showLegend !== false, mode, 'right'),
    tooltip: {
      ...tooltipBase(mode),
      trigger: 'item',
      formatter: fmt<MarkParams>(
        (params) =>
          `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(params.name)}</div>` +
          `${formatValue(params.value, valueFormat)} · ${params.percent.toFixed(1)}%`,
      ),
    },
    series: [
      {
        type: 'pie',
        radius: donut ? ['58%', '82%'] : ['0%', '78%'],
        center: ['38%', '52%'],
        avoidLabelOverlap: true,
        padAngle: 1.2,
        itemStyle: {
          // 2px surface gap between slices instead of a stroke.
          borderColor: palette.surface,
          borderWidth: 2,
          borderRadius: 4,
        },
        label: {
          show: donut,
          position: 'center',
          formatter: fmt<MarkParams>(
            () => `{value|${formatValue(total, valueFormat, { compact: true })}}\n{label|Total}`,
          ),
          rich: {
            value: { fontSize: 20, fontWeight: 700, color: palette.textPrimary, lineHeight: 26 },
            label: { fontSize: 11, color: palette.textMuted, lineHeight: 16 },
          },
        },
        emphasis: {
          scale: true,
          scaleSize: 4,
          label: { show: donut },
        },
        labelLine: { show: false },
        data: rows.map((row) => ({
          name: String(row[labelKey] ?? ''),
          value: toNumber(row[measure]) ?? 0,
          itemStyle: { color: scale.get(String(row[labelKey] ?? '')) },
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Scatter
// ---------------------------------------------------------------------------

function buildScatter(ctx: BuildContext): EChartsOption {
  const { mode, data, encoding, style = {}, valueFormat = 'decimal' } = ctx;
  const palette = PALETTES[mode];
  const xKey = encoding.x ?? data.columns[0];
  const yKey = encoding.y ?? data.columns[1];
  const seriesKey = encoding.series;

  const scale = createColorScale(mode);
  const series: Record<string, unknown>[] = [];

  if (seriesKey) {
    // Scatter puts every pair of hues on screen at once, so only the slots
    // that clear the all-pairs gate are used; the rest folds into "Outros".
    const groups = uniqueValues(data.rows, seriesKey).slice(0, ALL_PAIRS_SAFE_SLOTS);
    seedStable(scale, groups, ctx.colorDomain);
    groups.forEach((group) => {
      series.push({
        name: group,
        type: 'scatter',
        symbolSize: 9,
        itemStyle: {
          color: withAlpha(scale.get(group), 0.72),
          borderColor: palette.surface,
          borderWidth: 2,
        },
        emphasis: { focus: 'series', itemStyle: { opacity: 1 } },
        data: data.rows
          .filter((row) => String(row[seriesKey]) === group)
          .map((row) => [toNumber(row[xKey]), toNumber(row[yKey])]),
      });
    });
  } else {
    const color = accentColor(style.accent ?? 'primary', mode);
    series.push({
      name: humanize(yKey ?? 'y'),
      type: 'scatter',
      symbolSize: 9,
      itemStyle: {
        color: withAlpha(color, 0.62),
        borderColor: palette.surface,
        borderWidth: 2,
      },
      data: data.rows.map((row) => [toNumber(row[xKey]), toNumber(row[yKey])]),
    });
  }

  // The fitted line is computed by the backend from the full dataset, not from
  // the sampled points, so it describes the real relationship.
  const regression = data.meta?.regression;
  if (regression && ctx.options?.show_regression !== false) {
    series.push({
      name: 'Tendência linear',
      type: 'line',
      showSymbol: false,
      silent: true,
      lineStyle: { width: 2, color: palette.textMuted, type: 'dashed', opacity: 0.8 },
      data: [
        [regression.x_min, regression.slope * regression.x_min + regression.intercept],
        [regression.x_max, regression.slope * regression.x_max + regression.intercept],
      ],
      z: 1,
    });
  }

  return {
    animationDuration: 420,
    grid: gridBase(),
    legend: legendConfig(style.showLegend !== false && series.length > 1, mode),
    tooltip: {
      ...tooltipBase(mode),
      trigger: 'item',
      formatter: fmt<{ value: [number, number]; seriesName: string; color: string }>(
        (params) =>
          `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">` +
          `<span style="width:8px;height:8px;border-radius:50%;background:${escapeHtml(params.color)}"></span>` +
          `<strong>${escapeHtml(params.seriesName)}</strong></div>` +
          `${escapeHtml(humanize(String(xKey)))}: ${formatValue(params.value[0], 'decimal')}<br/>` +
          `${escapeHtml(humanize(String(yKey)))}: ${formatValue(params.value[1], valueFormat)}`,
      ),
    },
    xAxis: {
      type: 'value',
      name: humanize(String(xKey)),
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { ...baseTextStyle(mode), color: palette.textMuted, fontSize: 11 },
      axisLine: axisLineStyle(mode),
      axisTick: { show: false },
      splitLine: splitLineStyle(style.showGrid !== false, mode),
      axisLabel: { ...numericTextStyle(mode), formatter: axisValueFormatter('decimal') },
      scale: true,
    },
    yAxis: {
      type: 'value',
      name: humanize(String(yKey)),
      nameLocation: 'middle',
      nameGap: 44,
      nameTextStyle: { ...baseTextStyle(mode), color: palette.textMuted, fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: splitLineStyle(style.showGrid !== false, mode),
      axisLabel: { ...numericTextStyle(mode), formatter: axisValueFormatter(valueFormat) },
      scale: true,
    },
    series: series as EChartsOption['series'],
    // A dense point cloud benefits from zooming both axes at once, not just
    // one — pinch/scroll on the plot area, no visible slider.
    dataZoom:
      data.rows.length > 60
        ? [
            { type: 'inside', xAxisIndex: 0, throttle: 50 },
            { type: 'inside', yAxisIndex: 0, throttle: 50 },
          ]
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

function buildHistogram(ctx: BuildContext): EChartsOption {
  const { mode, data, style = {} } = ctx;
  const palette = PALETTES[mode];
  const color = accentColor(style.accent ?? 'primary', mode);

  return {
    animationDuration: 420,
    grid: gridBase(),
    legend: { show: false },
    tooltip: {
      ...tooltipBase(mode),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: withAlpha(palette.textPrimary, 0.05) } },
      formatter: fmt<MarkParams[]>((params) => {
        const first = params[0];
        return `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(first.name)}</div>${formatValue(
          first.value,
          'integer',
        )} registros`;
      }),
    },
    xAxis: {
      type: 'category',
      data: data.rows.map((row) => String(row.label ?? '')),
      axisLine: axisLineStyle(mode),
      axisTick: { show: false },
      axisLabel: {
        ...baseTextStyle(mode),
        color: palette.textMuted,
        hideOverlap: true,
        formatter: (value: string) => value.split(' – ')[0],
      },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: splitLineStyle(style.showGrid !== false, mode),
      axisLabel: { ...numericTextStyle(mode), formatter: axisValueFormatter('integer') },
    },
    series: [
      {
        type: 'bar',
        // Bins are contiguous, so a 1px gap keeps the distribution's shape
        // readable without implying separate categories.
        barCategoryGap: '2%',
        itemStyle: { color, borderRadius: [3, 3, 0, 0] },
        emphasis: { itemStyle: { color: withAlpha(color, 0.82) } },
        data: data.rows.map((row) => toNumber(row.count)),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Box plot
// ---------------------------------------------------------------------------

function buildBoxPlot(ctx: BuildContext): EChartsOption {
  const { mode, data, style = {}, valueFormat = 'decimal' } = ctx;
  const palette = PALETTES[mode];
  const color = accentColor(style.accent ?? 'primary', mode);

  // A box needs a complete five-number summary; incomplete groups are skipped
  // rather than rendered with gaps.
  const complete = data.rows.filter((row) =>
    ['min', 'q1', 'median', 'q3', 'max'].every((key) => toNumber(row[key]) !== null),
  );
  const categories = complete.map((row) => String(row.label ?? ''));
  const boxes: number[][] = complete.map((row) => [
    toNumber(row.min) as number,
    toNumber(row.q1) as number,
    toNumber(row.median) as number,
    toNumber(row.q3) as number,
    toNumber(row.max) as number,
  ]);
  const outliers: [number, number][] = [];
  complete.forEach((row, index) => {
    const values = (row as unknown as { outliers?: number[] }).outliers ?? [];
    values.forEach((value) => outliers.push([index, value]));
  });

  return {
    animationDuration: 420,
    grid: gridBase(),
    legend: { show: false },
    tooltip: {
      ...tooltipBase(mode),
      trigger: 'item',
      formatter: fmt<{ name: string; value: number[]; seriesType: string }>((params) => {
        if (params.seriesType === 'scatter') {
          return `Outlier: ${formatValue(params.value[1], valueFormat)}`;
        }
        const [, min, q1, median, q3, max] = params.value;
        return (
          `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(params.name)}</div>` +
          `Máximo: ${formatValue(max, valueFormat)}<br/>` +
          `Q3: ${formatValue(q3, valueFormat)}<br/>` +
          `<strong>Mediana: ${formatValue(median, valueFormat)}</strong><br/>` +
          `Q1: ${formatValue(q1, valueFormat)}<br/>` +
          `Mínimo: ${formatValue(min, valueFormat)}`
        );
      }),
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLine: axisLineStyle(mode),
      axisTick: { show: false },
      axisLabel: {
        ...baseTextStyle(mode),
        color: palette.textMuted,
        hideOverlap: true,
        formatter: (value: string) => truncate(value, 14),
      },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: splitLineStyle(style.showGrid !== false, mode),
      axisLabel: { ...numericTextStyle(mode), formatter: axisValueFormatter(valueFormat) },
      scale: true,
    },
    series: [
      {
        name: 'Distribuição',
        type: 'boxplot',
        data: boxes,
        boxWidth: ['28%', '48%'],
        itemStyle: { color: withAlpha(color, 0.22), borderColor: color, borderWidth: 2 },
        emphasis: { itemStyle: { borderWidth: 2.5 } },
      },
      {
        name: 'Outliers',
        type: 'scatter',
        data: outliers,
        symbolSize: 8,
        itemStyle: {
          color: withAlpha(PALETTES[mode].status.negative, 0.7),
          borderColor: palette.surface,
          borderWidth: 2,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

function buildHeatmap(ctx: BuildContext): EChartsOption {
  const { mode, data, encoding, style = {}, valueFormat = 'decimal' } = ctx;
  const palette = PALETTES[mode];
  const isCorrelation = encoding.matrix === 'correlation' || data.meta?.scale === 'diverging';

  const xKey = isCorrelation ? 'x' : (encoding.x ?? data.columns[0]);
  const yKey = isCorrelation ? 'y' : (encoding.series ?? data.columns[1]);
  const valueKey = isCorrelation ? 'value' : measureColumns(ctx)[0];

  const xCategories = uniqueValues(data.rows, xKey);
  const yCategories = uniqueValues(data.rows, yKey);

  const values = data.rows
    .map((row) => toNumber(row[valueKey]))
    .filter((v): v is number => v !== null);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);

  const cells = data.rows.map((row) => [
    xCategories.indexOf(String(row[xKey])),
    yCategories.indexOf(String(row[yKey])),
    toNumber(row[valueKey]),
  ]);

  return {
    animationDuration: 420,
    grid: { ...gridBase(), bottom: 8, right: 8, top: 8 },
    tooltip: {
      ...tooltipBase(mode),
      trigger: 'item',
      formatter: fmt<{ value: [number, number, number] }>((params) => {
        const [xi, yi, value] = params.value;
        const label = isCorrelation
          ? `r = ${value === null ? '—' : value.toFixed(2)}`
          : formatValue(value, valueFormat);
        return `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(
          humanize(xCategories[xi] ?? ''),
        )} × ${escapeHtml(humanize(yCategories[yi] ?? ''))}</div>${label}`;
      }),
    },
    // Correlation is polarity: diverging, two opposite hues, neutral midpoint.
    // Cross-tab magnitude is sequential: one hue, light → dark.
    visualMap: {
      type: 'continuous',
      min: isCorrelation ? -1 : min,
      max: isCorrelation ? 1 : max,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 90,
      textStyle: { ...baseTextStyle(mode), color: palette.textMuted },
      inRange: {
        color: isCorrelation ? divergingRamp(mode) : PALETTES[mode].sequential,
      },
    },
    xAxis: {
      type: 'category',
      data: xCategories.map((c) => humanize(c)),
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        ...baseTextStyle(mode),
        color: palette.textMuted,
        hideOverlap: true,
        rotate: xCategories.length > 6 ? 32 : 0,
        formatter: (value: string) => truncate(value, 14),
      },
    },
    yAxis: {
      type: 'category',
      data: yCategories.map((c) => humanize(c)),
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        ...baseTextStyle(mode),
        color: palette.textMuted,
        formatter: (value: string) => truncate(value, 14),
      },
    },
    series: [
      {
        type: 'heatmap',
        data: cells,
        // 2px surface gap between cells rather than an outline.
        itemStyle: { borderColor: palette.surface, borderWidth: 2, borderRadius: 3 },
        label: {
          show: isCorrelation && xCategories.length <= 8,
          fontSize: 10,
          color: palette.textPrimary,
          formatter: fmt<{ value: [number, number, number] }>((params) =>
            params.value[2] === null ? '' : params.value[2].toFixed(2),
          ),
        },
        emphasis: { itemStyle: { borderColor: palette.textPrimary, borderWidth: 2 } },
        progressive: 400,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Choropleth map
// ---------------------------------------------------------------------------

/**
 * Principle: a value that belongs to a place is read fastest in that place.
 *
 * The geometry and the alias table arrive together from `useGeoMap`; until they
 * do, or when not one value resolves to a region, this falls back to the
 * ranking bar rather than drawing an empty continent.
 */
function buildMap(ctx: BuildContext): EChartsOption {
  const { mode, data, encoding, geo, valueFormat = 'decimal' } = ctx;
  const palette = PALETTES[mode];
  const regionKey = encoding.x ?? data.columns[0];
  const measure = measureColumns(ctx)[0];

  if (!geo) return buildBar(ctx, 'horizontal', false);

  // Two spellings can land on one region ("SP" and "São Paulo"). Collapsing
  // them has to respect the aggregation: totals add up, averages do not.
  const additive = !encoding.agg || encoding.agg === 'sum' || encoding.agg === 'count';
  const accumulated = new Map<string, { total: number; count: number }>();
  let unmatched = 0;

  for (const row of data.rows) {
    const label = String(row[regionKey] ?? '').trim();
    if (!label) continue;
    const region = geo.aliases[normalizeRegionKey(label)];
    if (!region) {
      unmatched += 1;
      continue;
    }
    const value = toNumber(row[measure]);
    if (value === null) continue;
    const entry = accumulated.get(region) ?? { total: 0, count: 0 };
    entry.total += value;
    entry.count += 1;
    accumulated.set(region, entry);
  }

  if (accumulated.size === 0) return buildBar(ctx, 'horizontal', false);

  const points = [...accumulated.entries()].map(([name, { total, count }]) => ({
    name,
    value: additive ? total : total / count,
  }));

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A single region, or a flat measure, would collapse the ramp to one step.
  const spread = max - min || Math.abs(max) || 1;
  const diverging = min < 0 && max > 0;

  return {
    animationDuration: 520,
    tooltip: {
      ...tooltipBase(mode),
      trigger: 'item',
      formatter: fmt<{ name: string; value: number | undefined }>((params) => {
        const value =
          params.value === undefined || Number.isNaN(params.value)
            ? 'sem dados'
            : formatValue(params.value, valueFormat);
        return (
          `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(params.name)}</div>` +
          `${value}`
        );
      }),
    },
    visualMap: {
      type: 'continuous',
      min: diverging ? -Math.max(Math.abs(min), Math.abs(max)) : min,
      max: diverging ? Math.max(Math.abs(min), Math.abs(max)) : min + spread,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 90,
      textStyle: { ...baseTextStyle(mode), color: palette.textMuted },
      formatter: (value: number) => compactNumber(value),
      inRange: { color: diverging ? divergingRamp(mode) : PALETTES[mode].sequential },
    },
    series: [
      {
        type: 'map',
        map: geo.scope,
        // Scroll to zoom, drag to pan — the whole point of a map is looking
        // closer at one region.
        roam: true,
        scaleLimit: { min: 1, max: 8 },
        // Leaves room for the visual map's legend at the bottom of the card.
        top: 6,
        bottom: 26,
        data: points,
        itemStyle: {
          areaColor: palette.grid,
          borderColor: palette.surface,
          borderWidth: 0.6,
        },
        emphasis: {
          label: { show: false },
          itemStyle: { borderColor: palette.textPrimary, borderWidth: 1 },
        },
        select: { disabled: true },
      },
    ],
    // Surfaced rather than silently dropped: a reader has to know the map is
    // not showing everything the table has. Sits top-left, the one corner the
    // toolbox and the visual map both leave empty.
    graphic:
      unmatched > 0
        ? [
            {
              type: 'text',
              left: 4,
              top: 2,
              silent: true,
              style: {
                text: `${unmatched} fora do mapa`,
                fill: palette.textMuted,
                fontSize: 10,
                fontFamily: 'var(--font-sans), Inter, system-ui, sans-serif',
              },
            },
          ]
        : undefined,
  } as EChartsOption;
}

// ---------------------------------------------------------------------------
// Treemap
// ---------------------------------------------------------------------------

function buildTreemap(ctx: BuildContext): EChartsOption {
  const { mode, data, encoding, valueFormat = 'decimal' } = ctx;
  const palette = PALETTES[mode];
  const labelKey = encoding.x ?? data.columns[0];
  const measure = measureColumns(ctx)[0];
  const scale = createColorScale(mode);
  const labels = data.rows.map((row) => String(row[labelKey] ?? ''));
  seedStable(scale, labels.slice(0, MAX_CATEGORICAL_SERIES), ctx.colorDomain);

  return {
    animationDuration: 500,
    tooltip: {
      ...tooltipBase(mode),
      formatter: fmt<MarkParams>(
        (params) =>
          `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(params.name)}</div>${formatValue(
            params.value,
            valueFormat,
          )}`,
      ),
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        itemStyle: { borderColor: palette.surface, borderWidth: 2, gapWidth: 2, borderRadius: 4 },
        label: {
          show: true,
          fontSize: 11,
          color: '#ffffff',
          overflow: 'truncate',
          formatter: fmt<MarkParams>((params) => params.name),
        },
        upperLabel: { show: false },
        emphasis: { itemStyle: { borderColor: palette.textPrimary } },
        data: data.rows.map((row, index) => ({
          name: String(row[labelKey] ?? ''),
          value: toNumber(row[measure]) ?? 0,
          itemStyle: {
            color:
              index < MAX_CATEGORICAL_SERIES
                ? scale.get(String(row[labelKey] ?? ''))
                : withAlpha(PALETTES[mode].categorical[0], 0.35),
          },
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Radar
// ---------------------------------------------------------------------------

interface RadarIndicatorMeta {
  key: string;
  label: string;
  additive?: boolean;
}

function buildRadar(ctx: BuildContext): EChartsOption {
  const indicators = ctx.data.meta?.indicators as RadarIndicatorMeta[] | undefined;
  // The backend emits two distinct shapes under the same chart type: a
  // multi-metric comparison (several entities, several normalised axes) when
  // the recommender produced it, and a single-metric "profile" (one shape,
  // one spoke per category) when a person builds it by hand in the widget
  // editor. `meta.indicators` is only ever present on the former.
  return Array.isArray(indicators) && indicators.length > 0
    ? buildMultiMetricRadar(ctx, indicators)
    : buildSingleMetricRadar(ctx);
}

/** Several entities, one polygon each, one axis per metric — all metrics
 * normalised to a common 0-100 scale so a millions-scale metric never
 * visually erases a single-digit one. Raw values ride along for the tooltip. */
function buildMultiMetricRadar(ctx: BuildContext, indicators: RadarIndicatorMeta[]): EChartsOption {
  const { mode, data, encoding, style = {} } = ctx;
  const palette = PALETTES[mode];
  const entityKey = encoding.x ?? 'entity';
  const rows = data.rows.slice(0, 6);

  const scale = createColorScale(mode);
  seedStable(scale, rows.map((row) => String(row[entityKey] ?? '')), ctx.colorDomain);

  const series = rows.map((row) => {
    const entity = String(row[entityKey] ?? '');
    const color = scale.get(entity);
    return {
      name: entity,
      value: indicators.map((ind) => toNumber(row[ind.key]) ?? 0),
      rawValues: indicators.map((ind) => toNumber(row[`${ind.key}_raw`])),
      itemStyle: { color },
      lineStyle: { width: 2, color },
      areaStyle: { color: withAlpha(color, rows.length > 1 ? 0.1 : 0.18) },
    };
  });

  return {
    animationDuration: 480,
    tooltip: {
      ...tooltipBase(mode),
      trigger: 'item',
      formatter: fmt<{
        name: string;
        color: string;
        data: { rawValues: (number | null)[] };
      }>((params) => {
        const rows_ = indicators
          .map((ind, i) => {
            const raw = params.data.rawValues[i];
            const formatted =
              raw === null
                ? '—'
                : formatValue(raw, ind.additive === false ? 'decimal' : 'auto', { compact: true });
            return `<div style="display:flex;justify-content:space-between;gap:12px">` +
              `<span>${escapeHtml(ind.label)}</span><strong>${formatted}</strong></div>`;
          })
          .join('');
        return (
          `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">` +
          `<span style="width:8px;height:8px;border-radius:50%;background:${escapeHtml(params.color)}"></span>` +
          `<strong>${escapeHtml(params.name)}</strong></div>${rows_}`
        );
      }),
    },
    legend: legendConfig(rows.length > 1 && style.showLegend !== false, mode, 'right'),
    radar: {
      indicator: indicators.map((ind) => ({ name: truncate(ind.label, 14), max: 100, min: 0 })),
      shape: 'polygon',
      splitNumber: 4,
      radius: rows.length > 1 ? '62%' : '68%',
      center: rows.length > 1 ? ['38%', '52%'] : ['50%', '52%'],
      axisName: { ...baseTextStyle(mode), color: palette.textMuted },
      splitLine: { lineStyle: { color: palette.grid, width: 1 } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: palette.grid } },
    },
    series: [
      {
        type: 'radar',
        symbolSize: 6,
        emphasis: { focus: 'series', lineStyle: { width: 3 } },
        data: series,
      },
    ],
  } as EChartsOption;
}

/** One shape, one spoke per category — an alternative to a bar chart for a
 * single metric across a small set of categories, used by manual/AI-built
 * widgets that pick "Radar" with one X and one Y. */
function buildSingleMetricRadar(ctx: BuildContext): EChartsOption {
  const { mode, data, encoding, style = {}, valueFormat = 'decimal' } = ctx;
  const palette = PALETTES[mode];
  const labelKey = encoding.x ?? data.columns[0];
  const measure = measureColumns(ctx)[0];
  const color = accentColor(style.accent ?? 'primary', mode);

  const rows = data.rows.slice(0, 12);
  const max = Math.max(...rows.map((row) => toNumber(row[measure]) ?? 0), 1);

  return {
    animationDuration: 480,
    tooltip: {
      ...tooltipBase(mode),
      trigger: 'item',
      valueFormatter: (value) => formatValue(toNumber(value), valueFormat),
    },
    legend: { show: false },
    radar: {
      indicator: rows.map((row) => ({ name: truncate(String(row[labelKey] ?? ''), 14), max })),
      shape: 'polygon',
      splitNumber: 4,
      axisName: { ...baseTextStyle(mode), color: palette.textMuted },
      splitLine: { lineStyle: { color: palette.grid, width: 1 } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: palette.grid } },
    },
    series: [
      {
        type: 'radar',
        symbolSize: 8,
        lineStyle: { width: 2, color },
        itemStyle: { color, borderColor: palette.surface, borderWidth: 2 },
        areaStyle: { color: withAlpha(color, 0.18) },
        data: [
          {
            value: rows.map((row) => toNumber(row[measure]) ?? 0),
            name: humanize(measure ?? 'valor'),
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

function buildFunnel(ctx: BuildContext): EChartsOption {
  const { mode, data, encoding, style = {}, valueFormat = 'decimal' } = ctx;
  const palette = PALETTES[mode];
  const labelKey = encoding.x ?? data.columns[0];
  const measure = measureColumns(ctx)[0];

  // Funnel stages are ordered, so an ordinal ramp is the correct encoding —
  // not categorical hues. Steps stay above the 2:1 surface floor.
  const ramp = PALETTES[mode].sequential;
  const start = mode === 'light' ? 3 : 0;
  const usable = mode === 'light' ? ramp.slice(start) : ramp.slice(0, ramp.length - 2);
  const rows = data.rows.slice(0, 10);

  return {
    animationDuration: 500,
    legend: legendConfig(style.showLegend !== false, mode, 'right'),
    tooltip: {
      ...tooltipBase(mode),
      trigger: 'item',
      formatter: fmt<MarkParams>(
        (params) =>
          `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(params.name)}</div>` +
          `${formatValue(params.value, valueFormat)} · ${params.percent.toFixed(1)}%`,
      ),
    },
    series: [
      {
        type: 'funnel',
        left: '6%',
        right: '6%',
        top: 12,
        bottom: 12,
        minSize: '22%',
        gap: 2,
        label: {
          show: true,
          position: 'inside',
          color: '#ffffff',
          fontSize: 11,
          overflow: 'truncate',
        },
        labelLine: { show: false },
        itemStyle: { borderColor: palette.surface, borderWidth: 2, borderRadius: 3 },
        emphasis: { label: { fontWeight: 600 } },
        data: rows.map((row, index) => ({
          name: String(row[labelKey] ?? ''),
          value: toNumber(row[measure]) ?? 0,
          itemStyle: {
            color: usable[Math.min(Math.round((index / Math.max(rows.length - 1, 1)) * (usable.length - 1)), usable.length - 1)],
          },
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function legendConfig(show: boolean, mode: ThemeMode, position: 'top' | 'right' = 'top') {
  const palette = PALETTES[mode];
  if (!show) return { show: false };
  const shared = {
    show: true,
    icon: 'roundRect' as const,
    itemWidth: 9,
    itemHeight: 9,
    itemGap: 14,
    textStyle: { ...baseTextStyle(mode), color: palette.textSecondary, fontSize: 11 },
    inactiveColor: palette.textMuted,
  };
  if (position === 'right') {
    return { ...shared, orient: 'vertical' as const, right: 8, top: 'middle' as const };
  }
  return { ...shared, top: 0, left: 0, padding: [0, 0, 8, 0] };
}

/**
 * Seeds a colour scale so a slot belongs to the entity, not to the query.
 *
 * Sorting the visible keys is not enough on its own: filtering a series out
 * changes the *set*, which would shift every survivor by one slot. So the
 * column's full domain — which the profile already knows — is seeded first
 * when it is available. A reader who learned "Sudeste is blue" keeps that
 * regardless of sort order or which other regions are on screen.
 *
 * Beyond the profiled domain (a very high-cardinality dimension) the visible
 * keys govern, which is the best that can be done without a stored mapping.
 */
function seedStable(
  scale: ReturnType<typeof createColorScale>,
  keys: string[],
  domain?: string[],
): void {
  const byName = (a: string, b: string) => a.localeCompare(b, 'pt-BR');
  if (domain && domain.length > 0) {
    scale.seed([...new Set(domain)].sort(byName));
  }
  scale.seed([...new Set(keys)].sort(byName));
}

/**
 * Escapes text that is interpolated into a tooltip.
 *
 * ECharts renders a tooltip formatter's return value as HTML, and category
 * labels come straight from the uploaded file — so a cell containing markup
 * would otherwise execute in the page. Values reaching a tooltip pass through
 * here; everything drawn on the canvas (axes, legends, data labels) is painted
 * as text and needs no escaping.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * ECharts declares tooltip and label formatter params as a broad union that
 * cannot be narrowed generically. These adapters perform the cast once, so
 * each formatter below is written against the shape it actually receives.
 */
function fmt<P>(fn: (params: P) => string): (params: unknown) => string {
  return fn as unknown as (params: unknown) => string;
}

interface MarkParams {
  name: string;
  value: number;
  percent: number;
  seriesName: string;
  seriesType: string;
  color: string;
  dataIndex: number;
}

function uniqueValues(rows: DataRow[], key: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  rows.forEach((row) => {
    const value = String(row[key] ?? '');
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  });
  return result;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (color.startsWith('rgba')) return color.replace(/[\d.]+\)$/, `${alpha})`);
  if (color.startsWith('rgb')) return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  return color;
}

export { toNumber, withAlpha, uniqueValues };
