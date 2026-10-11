import type { DataService } from '../types.js';

export type SourceRevisionPin =
  { readonly kind: 'absent' } | { readonly kind: 'current'; readonly value: string } | { readonly kind: 'invalid' };

const LOCAL_DATA_SERVICE_READERS = new WeakMap<object, () => unknown>();

export function brandLocalDataService<T extends object>(service: T, readRevision: () => unknown): T {
  LOCAL_DATA_SERVICE_READERS.set(service, readRevision);
  return service;
}

export function readSourceRevisionPin(data: DataService): SourceRevisionPin {
  const read = data !== null && typeof data === 'object' ? LOCAL_DATA_SERVICE_READERS.get(data) : undefined;
  if (read === undefined) return { kind: 'absent' };
  try {
    const value = read();
    return typeof value === 'string' && value.length > 0 ? { kind: 'current', value } : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}
