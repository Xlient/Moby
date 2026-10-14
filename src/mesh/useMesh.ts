import { useEffect, useState } from 'react';
import { getMeshSnapshot, subscribeMesh, type MeshSnapshot } from './meshService';

/** Live mesh status for screens. Also refreshes every few seconds, because "phones
 *  nearby" goes down on its own as phones leave. */
export function useMesh(): MeshSnapshot {
  const [snap, setSnap] = useState(getMeshSnapshot);
  useEffect(() => {
    const refresh = () => setSnap(getMeshSnapshot());
    const unsubscribe = subscribeMesh(refresh);
    const timer = setInterval(refresh, 5_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);
  return snap;
}
