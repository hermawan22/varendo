import type { Diagnostic, Outcome } from '@varendo/core';
import { WIRE_LIMITS } from '@varendo/core';
import { DataStreamError } from './stream.js';
import type { ResultStreamContext, ResultStreamLimits } from './stream.js';
import type { AcceptedQuery, DataErrorPayload, HttpDataPaths, QueryBudget, ResultEvent } from './types.js';

export const DEFAULT_PATHS: HttpDataPaths = Object.freeze({
  describe: '/adc/describe',
  plan: '/adc/plan',
  execute: '/adc/execute',
});

export const DEFAULT_RESPONSE_LIMITS = Object.freeze({
  bytes: WIRE_LIMITS.bytes,
  messageBytes: WIRE_LIMITS.bytes,
  messages: 64,
  rows: 10_000,
});

export const encoder = new TextEncoder();

export const failure = (code: string, message: string): Outcome<never> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false }],
});

export function reject(code: string, message: string): never {
  throw new DataStreamError(code, message);
}

export function diagnostics(error: unknown): readonly [Diagnostic, ...Diagnostic[]] {
  const diagnostic =
    error instanceof DataStreamError
      ? error.diagnostic
      : {
          code: 'data.http-network',
          message: 'The data service transport failed before completion.',
          retryable: false,
        };
  return [diagnostic];
}

export function positive(value: number, name: string, ceiling = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling)
    throw new TypeError(`${name} must be a bounded positive integer.`);
  return value;
}

/**
 * Canonical form for data-service wire-correlation equality only. Unlike
 * ../canonical.js this normalizes `-0` exactly as the JSON transport does, so
 * a request object still matches the peer's echoed (wire-normalized) copy.
 * Do not use for persisted evidence or digests.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

export function within(effective: QueryBudget, requested: QueryBudget): boolean {
  return (Object.keys(effective) as (keyof QueryBudget)[]).every((key) => effective[key] <= requested[key]);
}

/** All pending host/transport calls race one deadline; callbacks receive its signal. */
export class Lifetime {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  readonly startedAt = performance.now();
  private deadline: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private code = 'data.aborted';
  private readonly requests = new Set<Request>();
  private readonly external: AbortSignal | undefined;
  private readonly forward = () => this.controller.abort();

  constructor(milliseconds: number, signal?: AbortSignal) {
    this.deadline = this.startedAt + milliseconds;
    this.external = signal;
    signal?.addEventListener('abort', this.forward, { once: true });
    if (signal?.aborted) this.forward();
    this.arm();
  }

  private arm(): void {
    clearTimeout(this.timer);
    const remaining = this.deadline - performance.now();
    if (remaining <= 0) {
      this.expire();
      return;
    }
    this.timer = setTimeout(() => this.expire(), remaining);
  }

  private expire(): void {
    this.code = 'data.http-timeout';
    this.controller.abort();
  }

  tighten(milliseconds: number): void {
    this.deadline = Math.min(this.deadline, this.startedAt + milliseconds);
    this.arm();
    this.check();
  }

  check(): void {
    if (performance.now() >= this.deadline && !this.signal.aborted) this.expire();
    if (!this.signal.aborted) return;
    const message =
      this.code === 'data.aborted'
        ? 'The data service request was cancelled.'
        : 'The data service transport deadline expired.';
    reject(this.code, message);
  }

  async wait<T>(operation: () => T | PromiseLike<T>): Promise<T> {
    this.check();
    return new Promise<T>((resolve, rejectPromise) => {
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        this.signal.removeEventListener('abort', abort);
        action();
      };
      const abort = (): void =>
        finish(() => {
          try {
            this.check();
          } catch (error) {
            rejectPromise(error);
          }
        });
      this.signal.addEventListener('abort', abort, { once: true });
      try {
        Promise.resolve(operation()).then(
          (value) =>
            finish(() => {
              try {
                this.check();
                resolve(value);
              } catch (error) {
                rejectPromise(error);
              }
            }),
          (error) => finish(() => rejectPromise(error)),
        );
      } catch (error) {
        finish(() => rejectPromise(error));
      }
    });
  }

  retainRequest(request: Request): void {
    this.requests.add(request);
  }

  cancel(): void {
    this.controller.abort();
  }

  dispose(): void {
    this.requests.clear();
    clearTimeout(this.timer);
    this.external?.removeEventListener('abort', this.forward);
  }
}

export async function readText(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  life: Lifetime,
): Promise<string> {
  life.check();
  if (body === null) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await life.wait(() => reader.read());
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) reject('data.http-budget', 'The HTTP body exceeds its byte budget.');
      text += decodeChunk(decoder, chunk.value);
    }
    return text + finishDecoding(decoder);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function decodeChunk(decoder: TextDecoder, chunk: Uint8Array): string {
  try {
    return decoder.decode(chunk, { stream: true });
  } catch {
    return reject('data.http-encoding', 'The HTTP body is not valid UTF-8.');
  }
}

function finishDecoding(decoder: TextDecoder): string {
  try {
    return decoder.decode();
  } catch {
    return reject('data.http-encoding', 'The HTTP body is not valid UTF-8.');
  }
}

export function unwrap<T>(result: Outcome<T>): T {
  if (result.ok) return result.value;
  const first = result.diagnostics[0];
  reject(first.code, first.message);
}

export function errorPayload(requestId: string, errors: readonly Diagnostic[]): DataErrorPayload {
  return {
    version: '1',
    requestId,
    diagnostics: [
      errors[0] ?? { code: 'data.http', message: 'The request failed.', retryable: false },
      ...errors.slice(1),
    ],
  };
}

export function asError(requestId: string, errors: readonly Diagnostic[]): ResultEvent {
  return {
    kind: 'error',
    requestId,
    error: errorPayload(requestId, errors).diagnostics[0],
  };
}

const STATUS_RULES: ReadonlyArray<readonly [RegExp, number]> = [
  [/denied|authorization|origin/, 403],
  [/stale|cursor|expired/, 409],
  [/unsupported/, 422],
  [/budget/, 413],
  [/timeout/, 408],
];

export function statusFor(errors: readonly Diagnostic[]): number {
  const code = errors[0]?.code ?? '';
  for (const [pattern, status] of STATUS_RULES) if (pattern.test(code)) return status;
  return 400;
}

export function responseHeaders(contentType: string, origin?: string): Headers {
  const result = new Headers({ 'content-type': contentType, 'cache-control': 'no-store' });
  if (origin === undefined) return result;
  result.set('access-control-allow-origin', origin);
  result.set('vary', 'Origin');
  return result;
}

export function json(value: unknown, status: number, origin?: string): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders('application/json; charset=utf-8', origin),
  });
}

export function originUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new TypeError('data service endpoints require an HTTP(S) URL without embedded credentials or a fragment.');
  return url;
}

export function streamContext(
  accepted: AcceptedQuery,
  life: Lifetime,
  limits: ResultStreamLimits = DEFAULT_RESPONSE_LIMITS,
): ResultStreamContext {
  return {
    requestId: accepted.requestId,
    queryDigest: accepted.queryDigest,
    scopeDigest: accepted.scopeDigest,
    outputId: accepted.target.outputId,
    sourceRevision: accepted.sourceRevision,
    sourceLineage: accepted.sourceLineage,
    populationDigest: accepted.populationDigest,
    limits: {
      bytes: Math.min(limits.bytes, accepted.effectiveBudget.maxBytes),
      messageBytes: Math.min(limits.messageBytes, accepted.effectiveBudget.maxBytes),
      messages: Math.min(limits.messages, accepted.effectiveBudget.maxMessages),
      rows: Math.min(limits.rows, accepted.effectiveBudget.maxRows),
    },
    signal: life.signal,
  };
}
