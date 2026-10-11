import { ResultStoreImpl } from './store-impl.js';
import type { ResultStore, ResultStoreOptions } from './types.js';

export function createResultStore(options: ResultStoreOptions = {}): ResultStore {
  return new ResultStoreImpl(options);
}

export { DEFAULT_MAX_BYTES, DEFAULT_MAX_ENTRIES, DEFAULT_TTL_MS } from './store-defaults.js';
