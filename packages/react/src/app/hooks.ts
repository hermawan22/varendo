import { useCallback, useSyncExternalStore } from 'react';
import type { RuntimeRegionState } from '@varendo/runtime/app';
import type { WebRenderReceipt } from '@varendo/web/app';
import { useAeliqoApp } from './context.js';

const EMPTY_STATE: RuntimeRegionState | undefined = undefined;

export function useAeliqoRegionState(regionId: string): RuntimeRegionState | undefined {
  const app = useAeliqoApp();
  return useSyncExternalStore(
    useCallback((listener) => app.subscribe(regionId, listener), [app, regionId]),
    useCallback(() => app.snapshot(regionId), [app, regionId]),
    () => EMPTY_STATE,
  );
}

export function useAeliqoRender(
  regionId: string,
): (intent: unknown, options?: { readonly signal?: AbortSignal }) => Promise<WebRenderReceipt> {
  const app = useAeliqoApp();
  return useCallback(
    (intent, options = {}) =>
      app.render({ regionId, intent, ...(options.signal === undefined ? {} : { signal: options.signal }) }),
    [app, regionId],
  );
}
