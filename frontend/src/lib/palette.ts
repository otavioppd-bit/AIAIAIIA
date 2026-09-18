/**
 * Chart palette — blueprint edition.
 *
 * The chrome is monochromatic by design rule; data marks are the one place
 * where that rule has to bend, because encoding demands difference. The bend is
 * disciplined: two families only — a cool periwinkle pen and a warm graphite
 * pencil — walking a single monotonic lightness ladder. Series are told apart
 * by value first and temperature second, never by hue alone, which is what
 * makes the set hold up under colour-vision deficiency.
 *
 * Every claim here is enforced by tests/palette.test.ts rather than asserted:
 * contrast >= 3:1 against both chart surfaces, all-pairs dE >= 10, and the same
 * floor under simulated protanopia, deuteranopia and tritanopia.
 *
 * Six slots is the honest ceiling for this band — an eighth step would collapse
 * either contrast or separation — so the query engine folds the tail into
 * "Outros" rather than shipping two series a reader cannot tell apart.
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
export const MAX_CATEGORICAL_SERIES = 6;

const LIGHT_CATEGORICAL = [
  '#4a5f8a', // 1 periwinkle — the annotation pen leads
  '#211f1c', // 2 graphite, near-black
  '#7d8ca6', // 3 periwinkle, lifted
  '#6b645b', // 4 graphite, warm mid
  '#2e3b56', // 5 periwinkle, deep
  '#8c877e', // 6 graphite, warm light
];

const DARK_CATEGORICAL = [
  '#7089ba', // 1 periwinkle — the annotation pen leads
  '#ece8e1', // 2 graphite, near-paper
  '#5c6e94', // 3 periwinkle, deep
  '#a59e93', // 4 graphite, warm mid
  '#b0bfdd', // 5 periwinkle, lifted
  '#6d6862', // 6 graphite, warm deep
];

// One hue, walked end to end. Never a rainbow.
const LIGHT_SEQUENTIAL = [
  '#e6eaf2', '#d5dce8', '#c4cdde', '#b2bfd4', '#a1b1ca',
  '#8fa2c0', '#7e94b6', '#6d85ac', '#5c7099', '#455780', '#2e3b56',
];
const DARK_SEQUENTIAL = [
  '#1d2433', '#26304a', '#2f3b5c', '#3a4a6f', '#465a86',
  '#54699a', '#6379ac', '#7089ba', '#8a9fca', '#a6b7da', '#c6d2e9',
];

/*
 * Two pens that read as opposite without either being alarming: the cool
 * annotation against the warm pencil, through a neutral graphite midpoint.
 */
const DIVERGING_LIGHT = {
  negative: ['#5c3a30', '#7a4e41', '#9a6a5b', '#b98d7f', '#d6b4a8'],
  neutral: '#e9e7e3',
  positive: ['#dbe2ef', '#b0bfdd', '#7089ba', '#4a5f8a', '#2c3a58'],
};
const DIVERGING_DARK = {
  negative: ['#4a2f27', '#653f34', '#845549', '#a37264', '#c29a8b'],
  neutral: '#3a3835',
  positive: ['#26304a', '#3d4d72', '#5c6e94', '#7089ba', '#b0bfdd'],
};

export const PALETTES: Record<'light' | 'dark', PaletteSet> = {
  light: {
    categorical: LIGHT_CATEGORICAL,
    sequential: LIGHT_SEQUENTIAL,
    diverging: DIVERGING_LIGHT,
    status: {
      positive: '#4a5f8a',
      warning: '#806838',
      negative: '#964e44',
      info: '#4a5f8a',
    },
    surface: '#ffffff',
    grid: 'rgba(0,0,0,0.08)',
    axis: 'rgba(0,0,0,0.22)',
    textPrimary: 'rgba(0,0,0,0.92)',
    textSecondary: 'rgba(0,0,0,0.58)',
    textMuted: 'rgba(0,0,0,0.40)',
  },
  dark: {
    categorical: DARK_CATEGORICAL,
    sequential: DARK_SEQUENTIAL,
    diverging: DIVERGING_DARK,
    status: {
      positive: '#7089ba',
      warning: '#a89060',
      negative: '#b4746a',
      info: '#7089ba',
    },
    surface: '#1c1c1c',
    grid: 'rgba(255,255,255,0.07)',
    axis: 'rgba(255,255,255,0.20)',
    textPrimary: 'rgba(255,255,255,0.94)',
    textSecondary: 'rgba(255,255,255,0.62)',
    textMuted: 'rgba(255,255,255,0.42)',
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
  // The legacy accent names survive as stored widget settings; each resolves
  // into the blueprint set rather than reviving the hue it was named after.
  const map: Record<string, string> = {
    primary: palette.categorical[0],
    violet: palette.categorical[2],
    teal: palette.categorical[4],
    amber: palette.categorical[3],
    rose: palette.categorical[5],
    sky: palette.categorical[1],
  };
  return map[accent] ?? palette.categorical[0];
}
