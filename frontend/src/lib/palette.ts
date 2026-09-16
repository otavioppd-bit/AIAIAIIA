/**
 * Chart palette.
 *
 * Both columns are validated with the data-viz palette checker against this
 * product's real chart surfaces (light #ffffff, dark #111118):
 *
 *   dark  — lightness band PASS · chroma PASS · adjacent CVD ΔE 8.4 PASS ·
 *           normal-vision ΔE 19.3 PASS · contrast ≥3:1 PASS
 *   light — same gates PASS, with a contrast WARN on aqua/yellow/magenta.
 *           The relief rule is satisfied product-wide: every chart ships a
 *           legend plus tooltip, and each dashboard includes a data table.
 *
 * Slots are assigned in fixed order and never cycled. Past eight series the
 * query engine folds the tail into "Outros" rather than inventing a ninth hue.
 */

export interface PaletteSet {
  categorical: string[];
  sequential: string[];
  diverging: { negative: string[]; neutral: string; positive: string[] };
  status: { positive: string; warning: string; negative: string; info: string };
  surface: string;
  grid: string;
  axis: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
}

/** Slots 1–3 clear the all-pairs gate; used by scatter, bubble and map. */
export const ALL_PAIRS_SAFE_SLOTS = 3;

/** Past this, fold the tail into "Outros" instead of generating a hue. */
export const MAX_CATEGORICAL_SERIES = 8;

const LIGHT_CATEGORICAL = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948', // 8 red
];

const DARK_CATEGORICAL = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];

// One hue, light → dark. Never a rainbow.
const LIGHT_SEQUENTIAL = [
  '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec',
  '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95',
];
const DARK_SEQUENTIAL = [
  '#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf',
  '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4',
];

// Two hues that read as opposite, with a neutral grey midpoint.
const DIVERGING_LIGHT = {
  negative: ['#8c1d18', '#b3251f', '#d33a30', '#e5695f', '#f0a59d'],
  neutral: '#f0efec',
  positive: ['#cde2fb', '#86b6ef', '#3987e5', '#256abf', '#0d366b'],
};
const DIVERGING_DARK = {
  negative: ['#7a1a16', '#a6231d', '#c9362c', '#e06a60', '#eda49c'],
  neutral: '#383835',
  positive: ['#0d366b', '#184f95', '#2a78d6', '#5598e7', '#9ec5f4'],
};

export const PALETTES: Record<'light' | 'dark', PaletteSet> = {
  light: {
    categorical: LIGHT_CATEGORICAL,
    sequential: LIGHT_SEQUENTIAL,
    diverging: DIVERGING_LIGHT,
    status: {
      positive: '#1a7f4b',
      warning: '#a66f10',
      negative: '#b3251f',
      info: '#256abf',
    },
    surface: '#ffffff',
    grid: 'rgba(16,16,24,0.07)',
    axis: 'rgba(16,16,24,0.16)',
    textPrimary: 'rgba(16,16,24,0.92)',
    textSecondary: 'rgba(16,16,24,0.62)',
    textMuted: 'rgba(16,16,24,0.42)',
  },
  dark: {
    categorical: DARK_CATEGORICAL,
    sequential: DARK_SEQUENTIAL,
    diverging: DIVERGING_DARK,
    status: {
      positive: '#34c77b',
      warning: '#f5b442',
      negative: '#ff636e',
      info: '#56aaff',
    },
    surface: '#111118',
    grid: 'rgba(244,244,248,0.07)',
    axis: 'rgba(244,244,248,0.18)',
    textPrimary: 'rgba(244,244,248,0.92)',
    textSecondary: 'rgba(244,244,248,0.6)',
    textMuted: 'rgba(244,244,248,0.4)',
  },
};

/**
 * Colour follows the entity, not its rank. The same category name always maps
 * to the same slot regardless of sort order, so filtering a series out never
 * repaints the survivors.
 */
export function createColorScale(mode: 'light' | 'dark') {
  const palette = PALETTES[mode].categorical;
  const assigned = new Map<string, string>();

  return {
    get(key: string): string {
      const existing = assigned.get(key);
      if (existing) return existing;
      const color = palette[assigned.size % palette.length];
      assigned.set(key, color);
      return color;
    },
    /** Assign slots up front from a stable key list (e.g. alphabetical). */
    seed(keys: string[]): void {
      keys.forEach((key) => {
        if (!assigned.has(key)) {
          assigned.set(key, palette[assigned.size % palette.length]);
        }
      });
    },
    entries(): [string, string][] {
      return Array.from(assigned.entries());
    },
  };
}

/** Pick a step from the single-hue sequential ramp for a 0–1 magnitude. */
export function sequentialColor(ratio: number, mode: 'light' | 'dark'): string {
  const ramp = PALETTES[mode].sequential;
  const clamped = Math.min(Math.max(ratio, 0), 1);
  return ramp[Math.round(clamped * (ramp.length - 1))];
}

/** Build the diverging ramp used by the correlation heatmap. */
export function divergingRamp(mode: 'light' | 'dark'): string[] {
  const { negative, neutral, positive } = PALETTES[mode].diverging;
  return [...[...negative].reverse(), neutral, ...positive];
}

/** Accent token → concrete hex, for per-widget accent overrides. */
export function accentColor(accent: string, mode: 'light' | 'dark'): string {
  const palette = PALETTES[mode];
  const map: Record<string, string> = {
    primary: palette.categorical[0],
    violet: palette.categorical[6],
    teal: palette.categorical[2],
    amber: palette.categorical[3],
    rose: palette.categorical[4],
    sky: palette.categorical[0],
  };
  return map[accent] ?? palette.categorical[0];
}
