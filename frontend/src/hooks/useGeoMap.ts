'use client';

import { useQuery } from '@tanstack/react-query';
import { loadGeoMap, type GeoMapAsset } from '@/lib/geo-maps';
import type { GeoScope } from '@/lib/geo-names';

/**
 * Loads and registers the geometry a choropleth needs.
 *
 * The asset never changes, so it is cached indefinitely and never refetched on
 * focus — the chart only has to wait the first time a map reaches the screen.
 */
export function useGeoMap(scope: GeoScope | null) {
  return useQuery<GeoMapAsset>({
    queryKey: ['geo-map', scope],
    queryFn: () => loadGeoMap(scope as GeoScope),
    enabled: Boolean(scope),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
