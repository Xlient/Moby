import { useEffect } from 'react';
import { useUserCenterPassive } from '@/location/UserLocationContext';
import { resumeMeshIfEnabled, setMeshLocation } from './meshService';

/** App-level: restart the mesh if it was on, and keep the gateway's location current. */
export function useMeshLifecycle(): void {
  const center = useUserCenterPassive();
  useEffect(() => {
    resumeMeshIfEnabled();
  }, []);
  useEffect(() => {
    if (center.source === 'device') setMeshLocation(center.lat, center.lon);
  }, [center.lat, center.lon, center.source]);
}
