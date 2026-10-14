import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { env } from '@/config/env';

/**
 * Basemap for the MapLibre preview (issue #21).
 *
 * - Default: OpenFreeMap vector styles (OpenStreetMap data, free, no key). Supports
 *   offline packs.
 * - Mainland China, with EXPO_PUBLIC_TIANDITU_KEY: Tianditu (天地图), the government map
 *   service — reachable inside China, approved map content, and in CGCS2000, which
 *   matches WGS84 to within centimetres, so our alert coordinates need no GCJ-02
 *   offset. Raster tiles: road map + English labels.
 */
export interface Basemap {
  kind: 'openfreemap' | 'tianditu';
  mapStyle: string | StyleSpecification;
  /** Offline packs need a style URL (and a provider that allows caching). */
  offline: boolean;
  attribution: string;
}

export function openFreeMap(dark: boolean): Basemap {
  return {
    kind: 'openfreemap',
    mapStyle: `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'liberty'}`,
    offline: true,
    attribution: '© OpenStreetMap contributors · OpenFreeMap',
  };
}

function tiandituTiles(layer: 'vec' | 'eva' | 'cva', key: string): string[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map(
    (n) =>
      `https://t${n}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
      `&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles` +
      `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${key}`,
  );
}

export function tianditu(key: string): Basemap {
  const style: StyleSpecification = {
    version: 8,
    sources: {
      roads: { type: 'raster', tiles: tiandituTiles('vec', key), tileSize: 256, maxzoom: 18 },
      // 'eva' = English annotation (place names); 'cva' would be Chinese.
      labels: { type: 'raster', tiles: tiandituTiles('eva', key), tileSize: 256, maxzoom: 18 },
    },
    layers: [
      { id: 'roads', type: 'raster', source: 'roads' },
      { id: 'labels', type: 'raster', source: 'labels' },
    ],
  };
  return { kind: 'tianditu', mapStyle: style, offline: false, attribution: '© Tianditu (天地图)' };
}

/** Pick the basemap for where the phone is. */
export function basemapFor(country: string | undefined, dark: boolean): Basemap {
  if (country === 'CN' && env.tiandituKey) return tianditu(env.tiandituKey);
  return openFreeMap(dark);
}

/** Open elevation tiles (AWS Terrain Tiles, Terrarium encoding) for hillshading. */
export const TERRAIN_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];
