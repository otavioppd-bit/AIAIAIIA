/**
 * Geographic map registry.
 *
 * Each scope's geometry ships as a static asset instead of a bundled import:
 * together they are ~170KB and most dashboards never render a map, so the cost
 * is paid only when one appears on screen. The alias table travels inside the
 * same asset — name matching is useless without the geometry and vice versa.
 *
 * Geometry sources, both simplified to a few thousand points so a card-sized
 * choropleth stays sharp without shipping megabytes:
 *  - world: Natural Earth (public domain), via johan/world.geo.json
 *  - brazil: IBGE state boundaries, via codeforamerica/click_that_hood (MIT)
 */
import echarts from '@/lib/echarts';
import type { GeoScope } from '@/lib/geo-names';

export interface GeoMapAsset {
  /** Normalised spelling → the region name the GeoJSON itself carries. */
  aliases: Record<string, string>;
  geojson: unknown;
}

const ASSETS: Record<GeoScope, string> = {
  brazil: '/maps/brazil-states.json',
  world: '/maps/world-countries.json',
};

const cache = new Map<GeoScope, Promise<GeoMapAsset>>();

/**
 * Fetches a scope's asset once and registers its geometry with ECharts.
 *
 * The in-flight promise is cached so twelve map widgets mounting at once issue
 * a single request; a failure drops the entry so a later render can retry
 * rather than inheriting the rejection forever.
 */
export function loadGeoMap(scope: GeoScope): Promise<GeoMapAsset> {
  const cached = cache.get(scope);
  if (cached) return cached;

  const pending = fetch(ASSETS[scope])
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Mapa indisponível (HTTP ${response.status}).`);
      }
      const asset = (await response.json()) as GeoMapAsset;
      echarts.registerMap(scope, asset.geojson as never);
      return asset;
    })
    .catch((error) => {
      cache.delete(scope);
      throw error;
    });

  cache.set(scope, pending);
  return pending;
}
