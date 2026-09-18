/**
 * Number and date formatting, pt-BR by default.
 *
 * Formatting never changes a value — it only renders it. Compact notation is
 * used above a million so KPI cards stay readable, and the full value is always
 * available via `formatFull` for tooltips.
 */
import type { Aggregation, SemanticType } from '@/types/api';

const LOCALE = 'pt-BR';

const decimalFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const integerFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const currencyFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});

export type ValueFormat = 'currency' | 'percent' | 'integer' | 'decimal' | 'auto';

export function formatNumber(value: number | null | undefined, maxDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: maxDigits }).format(value);
}

export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return integerFormatter.format(Math.round(value));
}

export function formatCurrency(value: number | null | undefined, compact = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (compact && Math.abs(value) >= 1_000_000) {
    return `R$ ${compactNumber(value)}`;
  }
  return currencyFormatter.format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)}%`;
}

/** Ratio in 0–1 rendered as a percentage. */
export function formatRatio(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return formatPercent(value * 100, digits);
}

export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${decimalFormatter.format(value / 1_000_000_000)} bi`;
  if (abs >= 1_000_000) return `${decimalFormatter.format(value / 1_000_000)} mi`;
  if (abs >= 10_000) return `${decimalFormatter.format(value / 1000)} mil`;
  return decimalFormatter.format(value);
}

export function formatValue(
  value: number | string | null | undefined,
  format: ValueFormat = 'auto',
  options: { compact?: boolean; semanticType?: SemanticType } = {},
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '—';

  const resolved = format === 'auto' ? inferFormat(options.semanticType) : format;
  switch (resolved) {
    case 'currency':
      return formatCurrency(value, options.compact);
    case 'percent':
      return formatPercent(value);
    case 'integer':
      return options.compact && Math.abs(value) >= 100_000
        ? compactNumber(value)
        : formatInteger(value);
    default:
      return options.compact && Math.abs(value) >= 100_000
        ? compactNumber(value)
        : formatNumber(value);
  }
}

function inferFormat(semanticType?: SemanticType): ValueFormat {
  switch (semanticType) {
    case 'currency':
      return 'currency';
    case 'percentage':
      return 'percent';
    case 'integer':
      return 'integer';
    default:
      return 'decimal';
  }
}

/** The full, uncompacted rendering used in tooltips. */
export function formatFull(value: number | null | undefined, format: ValueFormat = 'decimal'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (format === 'currency') return currencyFormatter.format(value);
  if (format === 'percent') return formatPercent(value, 2);
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 4 }).format(value);
}

export function formatDelta(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(value)}%`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${decimalFormatter.format(bytes / 1024 ** index)} ${units[index]}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short' }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

/**
 * A raw cell value as a reader should see it.
 *
 * The table used to print whatever the API sent, so a date column showed
 * "2025-08-27T00:00:00" and a boolean showed "true" — machine values in a
 * document meant for a person. Numbers keep going through `formatValue`, which
 * knows about currency and percentages.
 */
export function formatCellValue(value: unknown, semanticType?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') return formatValue(value, 'auto', { semanticType: semanticType as never });

  const text = String(value);
  if (semanticType === 'datetime' || semanticType === 'date') {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      // Midnight almost always means the source carried a date, not an instant.
      const midnight =
        date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
      return midnight ? formatDate(date) : formatDateTime(date);
    }
  }
  if (semanticType === 'boolean') {
    const lowered = text.toLowerCase();
    if (lowered === 'true') return 'Sim';
    if (lowered === 'false') return 'Não';
  }
  return text;
}

export function formatRelativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  const thresholds: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [604800, 'day'],
    [2629800, 'week'],
    [31557600, 'month'],
  ];
  const abs = Math.abs(seconds);
  if (abs < 60) return formatter.format(seconds, 'second');
  for (let i = 1; i < thresholds.length; i += 1) {
    const [limit, unit] = thresholds[i];
    if (abs < limit) {
      const divisor = thresholds[i - 1][0];
      return formatter.format(Math.round(seconds / divisor), unit);
    }
  }
  return formatter.format(Math.round(seconds / 31557600), 'year');
}

/** valor_total → Valor total. Mirrors the backend's `humanize`. */
export function humanize(name: string): string {
  if (!name) return '';
  const text = name
    .replace(/[_-]+/g, ' ')
    .replace(/(?<=[a-z0-9])(?=[A-Z])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return name;
  const words = text.split(' ').map((w) => (w.toUpperCase() === w && w.length <= 4 ? w : w.toLowerCase()));
  words[0] = words[0].toUpperCase() === words[0] ? words[0] : words[0][0].toUpperCase() + words[0].slice(1);
  return words.join(' ');
}

export const AGGREGATION_LABELS: Record<Aggregation, string> = {
  sum: 'Soma',
  mean: 'Média',
  median: 'Mediana',
  count: 'Contagem',
  min: 'Mínimo',
  max: 'Máximo',
  nunique: 'Distintos',
  std: 'Desvio padrão',
};

export const SEMANTIC_TYPE_LABELS: Record<string, string> = {
  integer: 'Inteiro',
  float: 'Decimal',
  currency: 'Moeda',
  percentage: 'Percentual',
  boolean: 'Booleano',
  datetime: 'Data',
  categorical: 'Categoria',
  text: 'Texto',
  identifier: 'Identificador',
  geo: 'Geográfico',
  email: 'E-mail',
  url: 'URL',
};

export const ROLE_LABELS: Record<string, string> = {
  metric: 'Métrica',
  dimension: 'Dimensão',
  temporal: 'Temporal',
  identity: 'Identificador',
  free_text: 'Texto livre',
};

export const TIME_GRAIN_LABELS: Record<string, string> = {
  hour: 'Hora',
  day: 'Dia',
  week: 'Semana',
  month: 'Mês',
  quarter: 'Trimestre',
  year: 'Ano',
};
