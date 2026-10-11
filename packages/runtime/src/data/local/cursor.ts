import { canonical } from './shared.js';

export interface CursorValue {
  readonly version: 1;
  readonly mode: 'snapshot' | 'keyset';
  readonly kind: 'catalog' | 'data';
  readonly catalogRevision?: string;
  readonly target?: string;
  readonly queryDigest?: string;
  readonly scopeDigest?: string;
  readonly policyRevision?: string;
  readonly sourceRevision?: string;
  readonly sourceLineage?: string;
  readonly snapshotId?: string;
  readonly orderDigest?: string;
  readonly expiresAt?: number;
  readonly anchor?: readonly (null | boolean | number | string | { readonly decimal: string })[];
  readonly offset: number;
}

interface StoredCursor {
  readonly value: CursorValue;
  readonly partition: string;
}

export type CursorStore = Map<string, StoredCursor>;

export function issueCursor(
  value: CursorValue,
  partition: string,
  store: CursorStore,
  now: number,
  maxEntries: number,
): string {
  reapCursors(store, now);
  const existing = existingCursor(value, partition, store);
  if (existing !== undefined) return existing;
  while (store.size >= maxEntries) {
    const oldest = store.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  let token = opaqueToken();
  while (store.has(token)) token = opaqueToken();
  store.set(token, { value: Object.freeze({ ...value }), partition });
  return token;
}

function existingCursor(value: CursorValue, partition: string, store: CursorStore): string | undefined {
  const serialized = canonical(value);
  for (const [token, cursor] of store) {
    if (cursor.partition === partition && canonical(cursor.value) === serialized) return token;
  }
  return undefined;
}

export function resolveCursor(
  token: string | undefined,
  partition: string,
  store: CursorStore,
  now: number,
): CursorValue | undefined {
  if (token === undefined) return undefined;
  const stored = store.get(token);
  if (stored === undefined) return undefined;
  if (stored.value.expiresAt !== undefined && stored.value.expiresAt <= now) {
    store.delete(token);
    return undefined;
  }
  return stored.partition === partition ? stored.value : undefined;
}

export function isSnapshotCursor(cursor: CursorValue | undefined, kind: CursorValue['kind']): cursor is CursorValue {
  if (cursor === undefined) return false;
  if (cursor.kind !== kind) return false;
  return cursor.mode === 'snapshot';
}

function reapCursors(store: CursorStore, now: number): void {
  for (const [token, cursor] of store) {
    if (cursor.value.expiresAt !== undefined && cursor.value.expiresAt <= now) store.delete(token);
  }
}

function opaqueToken(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return `cursor-${crypto.randomUUID()}`;
  if (typeof crypto?.getRandomValues !== 'function')
    throw new TypeError('A cryptographically random cursor token is required.');
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return `cursor-${base64Url(bytes)}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
