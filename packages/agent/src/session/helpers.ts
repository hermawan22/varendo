import { parseWireValue } from '@varendo/core';

const DEADLINE = Symbol('agent-session-deadline');
const ABORTED = Symbol('agent-session-aborted');

export function safeNow(now: () => number): number {
  try {
    const value = now();
    return Number.isFinite(value) ? value : Date.now();
  } catch {
    return Date.now();
  }
}

export function bytes(value: unknown): number {
  const parsed = parseWireValue(value);
  if (!parsed.ok) return 0;
  try {
    return new TextEncoder().encode(JSON.stringify(parsed.value)).byteLength;
  } catch {
    return 0;
  }
}

function canonicalValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(object[key])}`)
    .join(',')}}`;
}

export function fingerprint(value: unknown): string {
  const parsed = parseWireValue(value);
  let canonical: string;
  if (!parsed.ok) {
    try {
      canonical = `invalid:${String(value)}`;
    } catch {
      canonical = 'invalid:candidate';
    }
  } else canonical = canonicalValue(parsed.value);
  let hash = 2166136261;
  for (const character of canonical) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return `session-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function elapsed(start: number, now: () => number): number {
  return Math.max(0, safeNow(now) - start);
}

export type BoundaryResult<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'deadline' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'failed' };

export async function awaitBoundary<T>(
  work: (signal: AbortSignal) => T | PromiseLike<T>,
  parent: AbortSignal,
  milliseconds: number,
): Promise<BoundaryResult<T>> {
  if (parent.aborted) return { kind: 'aborted' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof DEADLINE>((resolve) => {
    timer = setTimeout(
      () => {
        controller.abort();
        resolve(DEADLINE);
      },
      Math.max(0, milliseconds),
    );
  });
  let removeParent = (): void => undefined;
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    const onAbort = (): void => {
      controller.abort();
      resolve(ABORTED);
    };
    parent.addEventListener('abort', onAbort, { once: true });
    removeParent = () => parent.removeEventListener('abort', onAbort);
  });
  const pending = Promise.resolve().then(() => work(controller.signal));
  try {
    const result = await Promise.race([pending, deadline, aborted]);
    if (result === DEADLINE) return { kind: 'deadline' };
    if (result === ABORTED) return { kind: 'aborted' };
    return { kind: 'value', value: result as T };
  } catch {
    return parent.aborted ? { kind: 'aborted' } : { kind: 'failed' };
  } finally {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
    removeParent();
  }
}
