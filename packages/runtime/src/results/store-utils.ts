import { parseResultEvent, WIRE_LIMITS } from '@varendo/core';
import type { Diagnostic, Result, ResultRef } from '@varendo/core';
import { canonicalJson as canonical } from '../canonical.js';
import type { Outcome } from './internal-types.js';
import type { ResultBeginInput, ResultCacheKey, ResultEvent, ResultStatus } from './types.js';

const REQUIRED_BEGIN_FIELDS = [
  'principalKey',
  'scopeDigest',
  'queryDigest',
  'catalogRevision',
  'functionRegistryDigest',
  'sourceRevision',
  'outputId',
  'taskId',
  'requestId',
] as const;

const OPTIONAL_BEGIN_FIELDS = new Set([
  'policyRevision',
  'populationDigest',
  'sourceLineage',
  'planDigest',
  'resultShape',
  'lineageDigest',
]);
const ALLOWED_BEGIN_FIELDS = new Set([...REQUIRED_BEGIN_FIELDS, ...OPTIONAL_BEGIN_FIELDS]);

export function makeDiagnostic(code: string, message: string): Diagnostic {
  return { code, message, retryable: false };
}

export function failure<T>(code: string, message: string): Outcome<T> {
  return { ok: false, diagnostics: [makeDiagnostic(code, message)] };
}

export function frozen<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const child of value) frozen(child);
    return Object.freeze(value);
  }
  for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
  return Object.freeze(value);
}

/** Parse first, then recursively freeze so callers cannot mutate store state. */
export function parseAndFreezeEvent(input: unknown): Outcome<ResultEvent> {
  const parsed = parseResultEvent(input);
  if (!parsed.ok)
    return failure('data.result-event-shape', 'The result event does not match the canonical bounded contract.');
  return { ok: true, value: frozen(parsed.value) };
}

export async function lineageDigest(
  output: string,
  lineage: readonly { readonly output: string; readonly inputs: readonly unknown[] }[],
): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return undefined;
  const inputs = lineage.flatMap((edge) => edge.inputs);
  const bytes = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(canonical({ output, inputs }))));
  let encoded = '';
  for (const byte of bytes) encoded += byte.toString(16).padStart(2, '0');
  return `lineage-${encoded}`;
}

export function byteLength(value: unknown): number {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? Number.MAX_SAFE_INTEGER : new TextEncoder().encode(encoded).byteLength;
}

function validKeyPart(value: unknown, name: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > WIRE_LIMITS.id ||
    /[\s\u0000-\u001f\u007f]/u.test(value)
  )
    throw new TypeError(`${name} must be a bounded identifier.`);
}

function validatePrincipalKey(value: unknown): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > WIRE_LIMITS.id * 4 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new TypeError('principalKey must be a bounded host-owned cache partition key.');
}

function validateBeginProperty(name: string, value: unknown): void {
  if (OPTIONAL_BEGIN_FIELDS.has(name) && value === undefined) return;
  if (name === 'resultShape') {
    if (value !== 'rows' && value !== 'global-aggregate')
      throw new TypeError('resultShape must be an accepted result shape.');
    return;
  }
  if (name === 'principalKey') {
    validatePrincipalKey(value);
    return;
  }
  validKeyPart(value, name);
}

function validateBeginProperties(input: ResultBeginInput, properties: PropertyDescriptorMap): void {
  for (const name of REQUIRED_BEGIN_FIELDS) {
    if (!Object.hasOwn(properties, name)) throw new TypeError(`${name} is required.`);
  }
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !ALLOWED_BEGIN_FIELDS.has(key))
      throw new TypeError('Unknown result input property.');
    const property = properties[key]!;
    if (!Object.hasOwn(property, 'value')) throw new TypeError('Result inputs cannot contain accessors.');
    validateBeginProperty(key, property.value);
  }
}

export function validateBeginInput(input: ResultBeginInput): void {
  if (input === null || typeof input !== 'object') throw new TypeError('A result begin input is required.');
  validateBeginProperties(input, Object.getOwnPropertyDescriptors(input));
}

export function slotKey(input: ResultCacheKey): string {
  return canonical([
    input.principalKey,
    input.scopeDigest,
    input.policyRevision ?? null,
    input.populationDigest ?? null,
    input.queryDigest,
    input.catalogRevision,
    input.functionRegistryDigest,
    input.sourceRevision,
    input.sourceLineage ?? null,
    input.planDigest ?? null,
    input.resultShape ?? null,
    input.lineageDigest ?? null,
    input.outputId,
    input.taskId,
  ]);
}

export function sameRef(left: ResultRef, right: ResultRef): boolean {
  return (
    left.id === right.id &&
    left.revision === right.revision &&
    left.sourceLineage === right.sourceLineage &&
    left.outputId === right.outputId &&
    left.queryDigest === right.queryDigest &&
    left.scopeDigest === right.scopeDigest
  );
}

export function sameRefParts(ref: ResultRef, input: ResultCacheKey): boolean {
  return (
    ref.outputId === input.outputId && ref.queryDigest === input.queryDigest && ref.scopeDigest === input.scopeDigest
  );
}

const ERROR_STATUS_CODES: ReadonlyMap<string, ResultStatus> = new Map([
  ['data.aborted', 'cancelled'],
  ['data.cancelled', 'cancelled'],
  ['data.denied', 'denied'],
]);

const ERROR_STATUS_PREFIXES: ReadonlyArray<readonly [string, ResultStatus]> = [
  ['data.authorization', 'denied'],
  ['data.unsupported', 'unsupported'],
  ['data.stale', 'stale'],
];

export function statusForError(code: string): ResultStatus {
  const exact = ERROR_STATUS_CODES.get(code);
  if (exact !== undefined) return exact;
  for (const [prefix, status] of ERROR_STATUS_PREFIXES) if (code.startsWith(prefix)) return status;
  return 'failed';
}

export function preserveOnFailure(status: ResultStatus): boolean {
  return status !== 'denied' && status !== 'cancelled';
}

export function isKnownCoverage(
  value: Result['coverage'],
): value is Exclude<Result['coverage'], { readonly kind: 'unknown' }> {
  return value.kind !== 'unknown';
}

export function sourceIterator(source: AsyncIterable<unknown> | AsyncIterator<unknown>): AsyncIterator<unknown> {
  const candidate = source as AsyncIterable<unknown>;
  if (typeof candidate[Symbol.asyncIterator] === 'function') return candidate[Symbol.asyncIterator]();
  const sync = source as unknown as Iterable<unknown>;
  if (typeof sync[Symbol.iterator] === 'function') {
    const iterator = sync[Symbol.iterator]();
    const adapted: AsyncIterator<unknown> = {
      next: () => Promise.resolve(iterator.next()),
    };
    if (typeof iterator.return === 'function') adapted.return = () => Promise.resolve(iterator.return!());
    if (typeof iterator.throw === 'function')
      adapted.throw = (error?: unknown) => Promise.resolve(iterator.throw!(error));
    return adapted;
  }
  return source as AsyncIterator<unknown>;
}

export function raceAbort<T>(
  pending: Promise<T>,
  signals: readonly (AbortSignal | undefined)[],
): Promise<{ readonly aborted: true } | { readonly aborted: false; readonly value: T }> {
  const activeSignals = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (activeSignals.length === 0) return pending.then((value) => ({ aborted: false, value }) as const);
  if (activeSignals.some((signal) => signal.aborted)) return Promise.resolve({ aborted: true } as const);
  return new Promise((resolve) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      for (const signal of activeSignals) signal.removeEventListener('abort', onAbort);
      resolve({ aborted: true });
    };
    for (const signal of activeSignals) signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => {
        if (settled) return;
        settled = true;
        for (const signal of activeSignals) signal.removeEventListener('abort', onAbort);
        resolve({ aborted: false, value });
      },
      () => {
        if (settled) return;
        settled = true;
        for (const signal of activeSignals) signal.removeEventListener('abort', onAbort);
        // Return source rejection as a fulfilled tagged value so a late source
        // rejection is never left as an unhandled promise.
        resolve({ aborted: false, value: undefined as T });
      },
    );
  });
}
