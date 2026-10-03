import { useRef } from 'react';

export function useNewAlertIds(alertIds: string[]): Set<string> {
  const prevIds = useRef<Set<string> | null>(null);
  const newIds = useRef<Set<string>>(new Set());

  if (prevIds.current === null) {
    prevIds.current = new Set(alertIds);
    newIds.current = new Set();
    return newIds.current;
  }

  const arriving = new Set<string>();
  for (const id of alertIds) {
    if (!prevIds.current.has(id)) {
      arriving.add(id);
    }
  }

  prevIds.current = new Set(alertIds);

  if (arriving.size > 0) {
    newIds.current = arriving;
  }

  return newIds.current;
}
