/**
 * Palette guarantees.
 *
 * The blueprint palette separates series by lightness and temperature rather
 * than by hue, which is what lets a near-monochromatic set stay readable for
 * colour-blind users. That only holds if the numbers hold, so they are measured
 * here rather than asserted in a comment: a future "just one more series" or a
 * nudged hex that breaks separation fails the build.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_CATEGORICAL_SERIES, PALETTES } from '../src/lib/palette';

type RGB = [number, number, number];

function toRgb(hex: string): RGB {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
}

function linear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function toLab(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map(linear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Linear approximations of the three dichromacies, good enough to gate on. */
const CVD_MATRICES: Record<string, number[][]> = {
  protanopia: [
    [0.152, 1.053, -0.205],
    [0.115, 0.786, 0.099],
    [-0.004, -0.048, 1.052],
  ],
  deuteranopia: [
    [0.367, 0.861, -0.228],
    [0.28, 0.673, 0.047],
    [-0.012, 0.043, 0.969],
  ],
  tritanopia: [
    [1.256, -0.077, -0.179],
    [-0.078, 0.931, 0.148],
    [0.005, 0.691, 0.304],
  ],
};

function simulate(hex: string, kind: string): string {
  const [r, g, b] = toRgb(hex);
  return `#${CVD_MATRICES[kind]
    .map((row) => Math.round(Math.max(0, Math.min(255, row[0] * r + row[1] * g + row[2] * b))))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

function minimumPairDistance(colors: string[]): number {
  let worst = Infinity;
  for (let i = 0; i < colors.length; i += 1) {
    for (let j = i + 1; j < colors.length; j += 1) {
      worst = Math.min(worst, deltaE(colors[i], colors[j]));
    }
  }
  return worst;
}

const SURFACES = {
  light: ['#ffffff'],
  // Charts sit on Carbon cards, but a presentation-mode widget can land
  // straight on the Void canvas — both have to clear the gate.
  dark: ['#1c1c1c', '#000000'],
} as const;

for (const mode of ['light', 'dark'] as const) {
  test(`paleta ${mode}: cada série tem contraste suficiente contra a superfície`, () => {
    for (const surface of SURFACES[mode]) {
      for (const color of PALETTES[mode].categorical) {
        const ratio = contrast(color, surface);
        assert.ok(
          ratio >= 3,
          `${color} sobre ${surface} tem contraste ${ratio.toFixed(2)}, abaixo de 3:1`,
        );
      }
    }
  });

  test(`paleta ${mode}: nenhuma dupla de séries é confundível`, () => {
    const distance = minimumPairDistance([...PALETTES[mode].categorical]);
    assert.ok(distance >= 10, `menor ΔE entre pares é ${distance.toFixed(1)}, abaixo de 10`);
  });

  test(`paleta ${mode}: separação sobrevive a daltonismo`, () => {
    for (const kind of Object.keys(CVD_MATRICES)) {
      const simulated = PALETTES[mode].categorical.map((c) => simulate(c, kind));
      const distance = minimumPairDistance(simulated);
      assert.ok(
        distance >= 10,
        `sob ${kind} o menor ΔE cai para ${distance.toFixed(1)}, abaixo de 10`,
      );
    }
  });

  test(`paleta ${mode}: a rampa sequencial é monotônica`, () => {
    // A ramp that reverses direction would read a larger value as smaller.
    const ramp = PALETTES[mode].sequential.map(relativeLuminance);
    const ascending = ramp.every((v, i) => i === 0 || v >= ramp[i - 1]);
    const descending = ramp.every((v, i) => i === 0 || v <= ramp[i - 1]);
    assert.ok(ascending || descending, 'a rampa sequencial muda de direção no meio');
  });
}

test('o teto de séries corresponde ao que a paleta realmente entrega', () => {
  // Raising the ceiling without adding validated slots would silently start
  // cycling colours, giving two different series the same hue.
  for (const mode of ['light', 'dark'] as const) {
    assert.equal(
      PALETTES[mode].categorical.length,
      MAX_CATEGORICAL_SERIES,
      `a paleta ${mode} não tem exatamente ${MAX_CATEGORICAL_SERIES} slots`,
    );
  }
});
