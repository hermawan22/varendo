import { useCallback, useSyncExternalStore } from 'react';
import type { RuntimeRegionState } from '@varendo/runtime/app';
import type { WebRenderReceipt } from '@varendo/web/app';
import { useVarendoApp } from './context.js';

const EMPTY_STATE: RuntimeRegionState | undefined = undefined;

export function useVarendoRegionState(regionId: string): RuntimeRegionState | undefined {
  const app = useVarendoApp();
  return useSyncExternalStore(
    useCallback((listener) => app.subscribe(regionId, listener), [app, regionId]),
    useCallback(() => app.snapshot(regionId), [app, regionId]),
    () => EMPTY_STATE,
  );
}

export function useVarendoRender(
  regionId: string,
): (intent: unknown, options?: { readonly signal?: AbortSignal }) => Promise<WebRenderReceipt> {
  const app = useVarendoApp();
  return useCallback(
    (intent, options = {}) =>
      app.render({ regionId, intent, ...(options.signal === undefined ? {} : { signal: options.signal }) }),
    [app, regionId],
  );
}
