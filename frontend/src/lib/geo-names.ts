/**
 * Region name matching.
 *
 * Kept free of any ECharts import on purpose: the chart builders need this to
 * resolve a CSV spelling to a region, and they are exercised in plain Node.
 */

export type GeoScope = 'brazil' | 'world';

/**
 * Collapses a spelling to its comparable form: "São Paulo", "sao paulo" and
 * "SAO-PAULO" all key the same region, which is what a hand-typed CSV column
 * actually looks like.
 */
export function normalizeRegionKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** The scope a column's inferred `geo_kind` should be drawn on. */
export function geoScopeFor(geoKind: unknown): GeoScope {
  return geoKind === 'country' ? 'world' : 'brazil';
}
