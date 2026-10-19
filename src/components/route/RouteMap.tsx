import { useMapEngine } from '@/maps/mapEngine';
import { GoogleRouteMap } from './GoogleRouteMap';
import { MapLibreRouteMap } from './MapLibreRouteMap';
import type { RouteMapProps } from './RouteDiagram';

/** The route on whichever map the person chose in Settings (MapLibre by default). */
export function RouteMap(props: RouteMapProps) {
  const [engine] = useMapEngine();
  return engine === 'google' ? <GoogleRouteMap {...props} /> : <MapLibreRouteMap {...props} />;
}
