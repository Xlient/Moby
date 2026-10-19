import { useEffect, useSyncExternalStore } from 'react';
import { getModelState, refreshModelState, subscribeModel, type ModelState } from './model';

/** The on-device model's state (not downloaded / downloading / ready …), kept current. */
export function useModelState(): ModelState {
  const state = useSyncExternalStore(subscribeModel, getModelState, getModelState);
  useEffect(() => {
    void refreshModelState();
  }, []);
  return state;
}
