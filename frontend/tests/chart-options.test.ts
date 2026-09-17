/**
 * Chart option builders.
 *
 * The security assertions here matter most: ECharts renders a tooltip
 * formatter's return value as HTML, and every label in it originates in an
 * uploaded file.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildChartOption } from '../src/lib/chart-options';
import type { WidgetDataResponse } from '../src/types/api';

const HOSTILE = '<img src=x onerror="alert(1)">';

function data(rows: Record<string, string | number>[], columns: string[]): WidgetDataResponse {
  return { columns, rows, row_count: rows.length, truncated: false, notes: [], meta: {} };
}

/** Invokes a tooltip formatter the way ECharts would. */
function runFormatter(option: unknown, params: unknown): string {
  const tooltip = (option as { tooltip?: { formatter?: unknown } }).tooltip;
  const formatter = tooltip?.formatter;
  assert.equal(typeof formatter, 'function', 'o gráfico não define um formatter');
  return (formatter as (p: unknown) => string)(params);
}

const CHART_CASES = [
  {
    name: 'donut',
    type: 'donut' as const,
    params: { name: HOSTILE, value: 10, percent: 50 },
  },
  {
    name: 'treemap',
    type: 'treemap' as const,
    params: { name: HOSTILE, value: 10 },
  },
  {
    name: 'funnel',
    type: 'funnel' as const,
    params: { name: HOSTILE, value: 10, percent: 50 },
  },
  {
    name: 'histogram',
    type: 'histogram' as const,
    params: [{ name: HOSTILE, value: 10 }],
  },
];

for (const testCase of CHART_CASES) {
  test(`tooltip do ${testCase.name} escapa rótulos vindos do arquivo`, () => {
    const option = buildChartOption({
      mode: 'dark',
      chartType: testCase.type,
      data: data([{ categoria: HOSTILE, valor: 10 }], ['categoria', 'valor']),
      encoding: { x: 'categoria', y: 'valor', agg: 'sum' },
    });
    const html = runFormatter(option, testCase.params);
    assert.ok(!html.includes('<img'), `${testCase.name} injetou markup cru: ${html}`);
    assert.ok(html.includes('&lt;img'), `${testCase.name} não escapou o rótulo: ${html}`);
  });
}

test('tooltip do box plot escapa o rótulo do grupo', () => {
  const option = buildChartOption({
    mode: 'dark',
    chartType: 'box_plot',
    data: data(
      [{ label: HOSTILE, min: 1, q1: 2, median: 3, q3: 4, max: 5 }],
      ['label', 'min', 'q1', 'median', 'q3', 'max'],
    ),
    encoding: { y: 'valor' },
  });
  const html = runFormatter(option, {
    name: HOSTILE,
    value: [0, 1, 2, 3, 4, 5],
    seriesType: 'boxplot',
  });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

test('tooltip do heatmap escapa os rótulos dos dois eixos', () => {
  const option = buildChartOption({
    mode: 'dark',
    chartType: 'heatmap',
    data: data(
      [{ x: HOSTILE, y: HOSTILE, value: 0.5 }],
      ['x', 'y', 'value'],
    ),
    encoding: { matrix: 'correlation' },
  });
  const html = runFormatter(option, { value: [0, 0, 0.5] });
  assert.ok(!html.includes('<img'));
});

test('tooltip da dispersão escapa o nome da série', () => {
  const option = buildChartOption({
    mode: 'dark',
    chartType: 'scatter',
    data: data([{ a: 1, b: 2 }], ['a', 'b']),
    encoding: { x: 'a', y: 'b', agg: 'none' },
  });
  const html = runFormatter(option, {
    value: [1, 2],
    seriesName: HOSTILE,
    color: '"><script>alert(1)</script>',
  });
  assert.ok(!html.includes('<script'), `injetou script: ${html}`);
  assert.ok(!html.includes('<img'));
});

test('nunca gera um segundo eixo Y', () => {
  // Two y-scales invent a correlation the data does not contain; different
  // magnitudes are indexed to a common base upstream instead.
  const types = ['line', 'area', 'bar', 'bar_horizontal', 'stacked_bar', 'scatter'] as const;
  for (const chartType of types) {
    const option = buildChartOption({
      mode: 'dark',
      chartType,
      data: data([{ mes: 'jan', a: 1, b: 900000 }], ['mes', 'a', 'b']),
      encoding: { x: 'mes', y: 'a', y2: 'b', agg: 'sum' },
    }) as { yAxis?: unknown };
    assert.ok(!Array.isArray(option.yAxis), `${chartType} declarou múltiplos eixos Y`);
  }
});

test('barras usam uma única cor por série, sem rampa de valor', () => {
  const option = buildChartOption({
    mode: 'dark',
    chartType: 'bar',
    data: data(
      [
        { categoria: 'A', valor: 10 },
        { categoria: 'B', valor: 80 },
        { categoria: 'C', valor: 45 },
      ],
      ['categoria', 'valor'],
    ),
    encoding: { x: 'categoria', y: 'valor', agg: 'sum' },
  }) as { series?: { data?: unknown[]; itemStyle?: { color?: string } }[] };

  const series = option.series?.[0];
  assert.ok(series, 'sem série');
  assert.equal(typeof series.itemStyle?.color, 'string', 'a cor deveria ser única para a série');
  // Per-point colours would mean the bar length was double-encoded as hue.
  assert.ok(series.data?.every((point) => typeof point === 'number' || point === null));
});

test('a cor acompanha a categoria, não a posição na ordenação', () => {
  // Re-sorting or filtering must never repaint the surviving series: a reader
  // who learned "Beta is orange" would otherwise be misled.
  // The profile knows every category; the chart may show only a subset.
  const DOMAIN = ['Alpha', 'Beta', 'Gama'];
  const build = (rows: Record<string, string | number>[]) =>
    buildChartOption({
      mode: 'dark',
      chartType: 'donut',
      data: data(rows, ['categoria', 'valor']),
      encoding: { x: 'categoria', y: 'valor', agg: 'sum' },
      colorDomain: DOMAIN,
    }) as { series?: { data?: { name: string; itemStyle: { color: string } }[] }[] };

  const colourOf = (option: ReturnType<typeof build>, name: string) =>
    option.series?.[0]?.data?.find((point) => point.name === name)?.itemStyle.color;

  const original = build([
    { categoria: 'Alpha', valor: 10 },
    { categoria: 'Beta', valor: 20 },
    { categoria: 'Gama', valor: 30 },
  ]);
  // Same entities, reversed order — as a descending sort would produce.
  const reversed = build([
    { categoria: 'Gama', valor: 30 },
    { categoria: 'Beta', valor: 20 },
    { categoria: 'Alpha', valor: 10 },
  ]);
  // And with one entity filtered out entirely.
  const filtered = build([
    { categoria: 'Gama', valor: 30 },
    { categoria: 'Alpha', valor: 10 },
  ]);

  for (const name of ['Alpha', 'Beta', 'Gama']) {
    assert.equal(
      colourOf(original, name),
      colourOf(reversed, name),
      `“${name}” trocou de cor ao inverter a ordem das linhas`,
    );
  }
  for (const name of ['Alpha', 'Gama']) {
    assert.equal(
      colourOf(original, name),
      colourOf(filtered, name),
      `“${name}” foi repintada depois de filtrar outra série`,
    );
  }
});

test('séries de linha mantêm a cor quando a ordem das categorias muda', () => {
  const build = (groups: string[]) =>
    buildChartOption({
      mode: 'dark',
      chartType: 'line',
      data: data(
        groups.flatMap((grupo) => [
          { mes: 'jan', grupo, valor: 1 },
          { mes: 'fev', grupo, valor: 2 },
        ]),
        ['mes', 'grupo', 'valor'],
      ),
      encoding: { x: 'mes', y: 'valor', series: 'grupo', agg: 'sum' },
      colorDomain: ['Norte', 'Sul', 'Leste'],
    }) as { series?: { name: string; lineStyle?: { color?: string } }[] };

  const colourOf = (option: ReturnType<typeof build>, name: string) =>
    option.series?.find((serie) => serie.name === name)?.lineStyle?.color;

  const a = build(['Norte', 'Sul', 'Leste']);
  const b = build(['Leste', 'Norte', 'Sul']);
  for (const name of ['Norte', 'Sul', 'Leste']) {
    assert.equal(colourOf(a, name), colourOf(b, name), `“${name}” trocou de cor`);
  }
});

// --- Multi-metric radar -----------------------------------------------

function radarData(rows: Record<string, string | number>[]): WidgetDataResponse {
  return {
    columns: ['entity', 'receita', 'quantidade', 'avaliacao'],
    rows,
    row_count: rows.length,
    truncated: false,
    notes: [],
    meta: {
      indicators: [
        { key: 'receita', label: 'Receita', additive: true },
        { key: 'quantidade', label: 'Quantidade', additive: true },
        { key: 'avaliacao', label: 'Avaliação', additive: false },
      ],
    },
  };
}

test('radar multi-métrica gera um polígono por entidade, valores em 0-100', () => {
  const option = buildChartOption({
    mode: 'dark',
    chartType: 'radar',
    data: radarData([
      { entity: 'Produto A', receita: 100, quantidade: 80, avaliacao: 60, receita_raw: 90000 },
      { entity: 'Produto B', receita: 70, quantidade: 100, avaliacao: 90, receita_raw: 63000 },
    ]),
    encoding: { x: 'entity' },
  }) as { series?: { data?: { name: string; value: number[] }[] }[] };

  const points = option.series?.[0]?.data ?? [];
  assert.equal(points.length, 2);
  for (const point of points) {
    for (const value of point.value) {
      assert.ok(value >= 0 && value <= 100, `valor fora de 0-100: ${value}`);
    }
  }
  assert.deepEqual(
    points.map((p) => p.name),
    ['Produto A', 'Produto B'],
  );
});

test('radar multi-métrica escapa nome de entidade e rótulo hostis no tooltip', () => {
  const option = buildChartOption({
    mode: 'dark',
    chartType: 'radar',
    data: {
      columns: ['entity', 'metrica'],
      rows: [{ entity: HOSTILE, metrica: 100, metrica_raw: 42 }],
      row_count: 1,
      truncated: false,
      notes: [],
      meta: { indicators: [{ key: 'metrica', label: HOSTILE, additive: true }] },
    },
    encoding: { x: 'entity' },
  });
  const html = runFormatter(option, {
    name: HOSTILE,
    color: '"><script>alert(1)</script>',
    data: { rawValues: [42] },
  });
  assert.ok(!html.includes('<img'), `injetou markup cru: ${html}`);
  assert.ok(!html.includes('<script'), `injetou script via cor: ${html}`);
  assert.ok(html.includes('&lt;img'), 'não escapou o nome da entidade');
});

test('radar de métrica única (modo legado) continua funcionando sem meta.indicators', () => {
  const option = buildChartOption({
    mode: 'dark',
    chartType: 'radar',
    data: data(
      [
        { categoria: 'A', valor: 10 },
        { categoria: 'B', valor: 20 },
      ],
      ['categoria', 'valor'],
    ),
    encoding: { x: 'categoria', y: 'valor', agg: 'sum' },
  }) as { series?: { data?: { name: string; value: number[] }[] }[]; legend?: { show?: boolean } };

  assert.equal(option.series?.[0]?.data?.length, 1, 'modo legado é uma única série');
  assert.equal(option.legend?.show, false, 'uma única forma não precisa de legenda');
});

type ToolboxOption = {
  toolbox?: { feature?: { dataZoom?: unknown; restore?: unknown; saveAsImage?: unknown } };
  dataZoom?: unknown[];
};

test('todo gráfico ganha restaurar e salvar imagem na barra de ferramentas', () => {
  const option = buildChartOption({
    mode: 'dark',
    chartType: 'donut',
    data: data([{ categoria: 'A', valor: 10 }], ['categoria', 'valor']),
    encoding: { x: 'categoria', y: 'valor', agg: 'sum' },
  }) as ToolboxOption;

  assert.ok(option.toolbox?.feature?.restore, 'faltou o botão de restaurar');
  assert.ok(option.toolbox?.feature?.saveAsImage, 'faltou o botão de salvar imagem');
});

test('botão de zoom na barra de ferramentas só aparece onde há dataZoom de fato', () => {
  const noZoom = buildChartOption({
    mode: 'dark',
    chartType: 'donut',
    data: data([{ categoria: 'A', valor: 10 }], ['categoria', 'valor']),
    encoding: { x: 'categoria', y: 'valor', agg: 'sum' },
  }) as ToolboxOption;
  assert.equal(noZoom.toolbox?.feature?.dataZoom, undefined, 'donut não deveria oferecer zoom');

  const manyCategories = Array.from({ length: 30 }, (_, i) => ({ categoria: `Item ${i}`, valor: i }));
  const zoomed = buildChartOption({
    mode: 'dark',
    chartType: 'bar',
    data: data(manyCategories, ['categoria', 'valor']),
    encoding: { x: 'categoria', y: 'valor', agg: 'sum' },
  }) as ToolboxOption;
  assert.ok(Array.isArray(zoomed.dataZoom) && zoomed.dataZoom.length > 0, 'faltou dataZoom com muitas categorias');
  assert.ok(zoomed.toolbox?.feature?.dataZoom, 'faltou o botão de zoom na barra de ferramentas');

  const fewCategories = buildChartOption({
    mode: 'dark',
    chartType: 'bar',
    data: data([{ categoria: 'A', valor: 1 }, { categoria: 'B', valor: 2 }], ['categoria', 'valor']),
    encoding: { x: 'categoria', y: 'valor', agg: 'sum' },
  }) as ToolboxOption;
  assert.equal(fewCategories.dataZoom, undefined, 'poucas categorias não deveriam ganhar dataZoom');
  assert.equal(fewCategories.toolbox?.feature?.dataZoom, undefined, 'sem dataZoom, o botão não deveria aparecer');
});

test('barra horizontal com muitas categorias aplica zoom no eixo Y, onde as categorias moram', () => {
  const manyCategories = Array.from({ length: 30 }, (_, i) => ({ categoria: `Item ${i}`, valor: i }));
  const option = buildChartOption({
    mode: 'dark',
    chartType: 'bar_horizontal',
    data: data(manyCategories, ['categoria', 'valor']),
    encoding: { x: 'categoria', y: 'valor', agg: 'sum' },
  }) as { dataZoom?: { yAxisIndex?: number; xAxisIndex?: number }[] };

  assert.equal(option.dataZoom?.[0]?.yAxisIndex, 0, 'zoom deveria indexar o eixo Y na horizontal');
  assert.equal(option.dataZoom?.[0]?.xAxisIndex, undefined, 'não deveria indexar o eixo X na horizontal');
});
