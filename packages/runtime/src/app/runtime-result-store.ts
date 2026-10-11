import { createResultStore } from '../results/store.js';
import type { ResultHandle, ResultStore } from '../results/types.js';
import type { AeliqoRuntimeOptions } from './types.js';

export interface TrackedResultStore {
  readonly store: ResultStore;
  readonly handles: Set<ResultHandle>;
  readonly owned: boolean;
}

export function createTrackedResultStore(options: AeliqoRuntimeOptions): TrackedResultStore {
  const owned = options.resultStore === undefined;
  const underlying = options.resultStore ?? createResultStore(options.resultStoreOptions);
  const handles = new Set<ResultHandle>();
  const store: ResultStore = {
    begin(input) {
      const handle = underlying.begin(input);
      handles.add(handle);
      return handle;
    },
    get(input) {
      return underlying.get(input);
    },
    revoke(input) {
      underlying.revoke(input);
    },
    dispose() {
      underlying.dispose();
      handles.clear();
    },
  };
  return { store, handles, owned };
}
