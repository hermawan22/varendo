import type { Diagnostic, Outcome } from '@varendo/core';
import { WIRE_LIMITS } from '@varendo/core';
import { readResultStream } from './stream.js';
import type { ResultStreamLimits } from './stream.js';
import {
  asError,
  canonical,
  DEFAULT_PATHS,
  DEFAULT_RESPONSE_LIMITS,
  diagnostics,
  failure,
  Lifetime,
  originUrl,
  positive,
  readText,
  reject,
  streamContext,
  unwrap,
  within,
} from './http-common.js';
import {
  parseAcceptedQuery,
  parseCatalogPage,
  parseCatalogRequest,
  parseDataError,
  parseJSON,
  parsePlanAcceptance,
  parsePlanRequest,
} from './schema.js';
import type {
  AcceptedQuery,
  CatalogPage,
  CatalogRequest,
  DataService,
  HttpDataPaths,
  HttpDataServiceOptions,
  PlanAcceptance,
  PlanRequest,
  QueryBudget,
  ReadContext,
  ResultEvent,
} from './types.js';

interface ClientConfig {
  readonly base: URL;
  readonly paths: HttpDataPaths;
  readonly fetcher: typeof globalThis.fetch;
  readonly headers: Headers;
  readonly milliseconds: number;
  readonly limits: ResultStreamLimits;
}

function clientPaths(base: URL, custom?: Partial<HttpDataPaths>): HttpDataPaths {
  const configured = { ...DEFAULT_PATHS, ...custom };
  const paths = {} as Record<keyof HttpDataPaths, string>;
  for (const key of Object.keys(configured) as (keyof HttpDataPaths)[]) {
    const url = originUrl(new URL(configured[key], base).href);
    if (url.origin !== base.origin)
      throw new TypeError('data service endpoint overrides must stay on the configured origin.');
    paths[key] = url.href;
  }
  return paths;
}

function clientLimits(custom: HttpDataServiceOptions['responseLimits']): ResultStreamLimits {
  const limits = { ...DEFAULT_RESPONSE_LIMITS, ...custom };
  for (const [name, value] of Object.entries(limits)) {
    const ceiling = name === 'messageBytes' ? WIRE_LIMITS.bytes : Number.MAX_SAFE_INTEGER;
    positive(value, name, ceiling);
  }
  return limits;
}

function clientConfig(options: HttpDataServiceOptions): ClientConfig {
  const base = originUrl(options.baseUrl);
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new TypeError('An HTTP fetch implementation is required.');
  const configuredFetcher = fetcher === globalThis.fetch ? fetcher.bind(globalThis) : fetcher;
  const headers = new Headers(options.headers);
  headers.set('content-type', 'application/json');
  return {
    base,
    paths: clientPaths(base, options.paths),
    fetcher: configuredFetcher,
    headers,
    milliseconds: positive(options.maxRequestMilliseconds ?? 30_000, 'maxRequestMilliseconds', 86_400_000),
    limits: clientLimits(options.responseLimits),
  };
}

function maximumResponseBytes(limits: ResultStreamLimits, budget: QueryBudget): number {
  return Math.min(limits.bytes, budget.maxBytes);
}

function hasJsonContentType(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().startsWith('application/json') === true;
}

function hasStreamContentType(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().startsWith('application/x-ndjson') === true;
}

function discoveryMatches(request: CatalogRequest, response: CatalogPage): boolean {
  return (
    response.requestId === request.requestId &&
    canonical(response.target) === canonical(request.target) &&
    (request.catalogRevision === null || response.catalogRevision === request.catalogRevision) &&
    response.catalog.revision === response.catalogRevision &&
    within(response.effectiveBudget, request.budget)
  );
}

function planMatches(request: PlanRequest, response: PlanAcceptance): boolean {
  return (
    response.requestId === request.requestId &&
    response.catalogRevision === request.catalogRevision &&
    canonical(response.target) === canonical(request.target) &&
    canonical(response.query) === canonical(request.query) &&
    within(response.effectiveBudget, request.budget)
  );
}

class HttpDataServiceImpl implements DataService {
  private readonly config: ClientConfig;

  constructor(options: HttpDataServiceOptions) {
    this.config = clientConfig(options);
  }

  private async send(path: string, value: unknown, accept: string, life: Lifetime): Promise<Response> {
    const outgoingHeaders = new Headers(this.config.headers);
    outgoingHeaders.set('accept', accept);
    const response = await life.wait(() => this.fetchResponse(path, value, outgoingHeaders, life));
    if (response.redirected || (response.url && new URL(response.url).origin !== this.config.base.origin)) {
      void response.body?.cancel().catch(() => {});
      reject('data.http-origin', 'The data service response came from an unexpected redirect or origin.');
    }
    return response;
  }

  private async fetchResponse(path: string, value: unknown, headers: Headers, life: Lifetime): Promise<Response> {
    const received = await this.config.fetcher(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(value),
      redirect: 'error',
      signal: life.signal,
    });
    if (life.signal.aborted) {
      void received.body?.cancel().catch(() => {});
      life.check();
    }
    if (received.body === null || received.url === '') return received;
    const readable = received.clone();
    void received.body.cancel().catch(() => {});
    return readable;
  }

  private async errorResponse(
    response: Response,
    requestId: string,
    maximumBytes: number,
    life: Lifetime,
  ): Promise<Outcome<never>> {
    const raw = unwrap(parseJSON(await readText(response.body, maximumBytes, life), 'http-error'));
    const error = unwrap(parseDataError(raw));
    if (error.requestId !== requestId && error.requestId !== 'unknown-request')
      return failure('data.http-correlation', 'The data service error response belongs to another request.');
    return { ok: false, diagnostics: error.diagnostics };
  }

  private async requestJSON<T>(
    path: string,
    value: { readonly requestId: string; readonly budget: QueryBudget },
    parse: (input: unknown) => Outcome<T>,
    context: ReadContext,
  ): Promise<Outcome<T>> {
    const life = new Lifetime(Math.min(this.config.milliseconds, value.budget.maxMilliseconds), context.signal);
    try {
      const response = await this.send(path, value, 'application/json', life);
      const maximumBytes = maximumResponseBytes(this.config.limits, value.budget);
      if (!response.ok) return await this.errorResponse(response, value.requestId, maximumBytes, life);
      if (!hasJsonContentType(response)) {
        void response.body?.cancel().catch(() => {});
        return failure('data.http-content-type', 'The data service host returned an unexpected response format.');
      }
      const text = await readText(response.body, maximumBytes, life);
      const result = parse(unwrap(parseJSON(text, 'http-response')));
      life.check();
      return result;
    } catch (error) {
      return { ok: false, diagnostics: diagnostics(error) };
    } finally {
      life.dispose();
    }
  }

  async describe(request: CatalogRequest, context: ReadContext = {}): Promise<Outcome<CatalogPage>> {
    const parsed = parseCatalogRequest(request);
    if (!parsed.ok) return parsed;
    const result = await this.requestJSON(this.config.paths.describe, parsed.value, parseCatalogPage, context);
    if (!result.ok) return result;
    if (discoveryMatches(parsed.value, result.value)) return result;
    return failure(
      'data.http-correlation',
      'The data service discovery response does not match its request, revision or budget.',
    );
  }

  async plan(request: PlanRequest, context: ReadContext = {}): Promise<Outcome<PlanAcceptance>> {
    const parsed = parsePlanRequest(request);
    if (!parsed.ok) return parsed;
    const result = await this.requestJSON(this.config.paths.plan, parsed.value, parsePlanAcceptance, context);
    if (!result.ok) return result;
    if (planMatches(parsed.value, result.value)) return result;
    return failure(
      'data.http-correlation',
      'The data service plan response does not match its request, query or budget.',
    );
  }

  async *execute(request: AcceptedQuery, context: ReadContext = {}): AsyncGenerator<ResultEvent> {
    const parsed = parseAcceptedQuery(request);
    if (!parsed.ok) {
      yield asError('unknown-request', parsed.diagnostics);
      return;
    }
    yield* this.executeAccepted(parsed.value, context);
  }

  private async *executeAccepted(accepted: AcceptedQuery, context: ReadContext): AsyncGenerator<ResultEvent> {
    const life = new Lifetime(
      Math.min(this.config.milliseconds, accepted.effectiveBudget.maxMilliseconds),
      context.signal,
    );
    let transportComplete = false;
    try {
      const response = await this.send(this.config.paths.execute, accepted, 'application/x-ndjson', life);
      if (!response.ok) {
        yield* this.errorEvents(response, accepted, life);
        return;
      }
      this.assertStreamResponse(response);
      if (response.body === null) reject('data.http-body', 'The data service host returned no result stream.');
      const stream = readResultStream(response.body, streamContext(accepted, life, this.config.limits));
      for await (const event of stream) {
        life.check();
        if (event.kind === 'complete' || event.kind === 'error') transportComplete = true;
        yield event;
      }
    } catch (error) {
      yield asError(accepted.requestId, this.currentDiagnostics(error, life));
    } finally {
      if (!transportComplete) life.cancel();
      life.dispose();
    }
  }

  private async *errorEvents(response: Response, accepted: AcceptedQuery, life: Lifetime): AsyncGenerator<ResultEvent> {
    const error = await this.errorResponse(
      response,
      accepted.requestId,
      maximumResponseBytes(this.config.limits, accepted.effectiveBudget),
      life,
    );
    if (!error.ok) yield asError(accepted.requestId, error.diagnostics);
  }

  private assertStreamResponse(response: Response): void {
    if (hasStreamContentType(response)) return;
    void response.body?.cancel().catch(() => {});
    reject('data.http-content-type', 'The data service host returned an unexpected stream format.');
  }

  private currentDiagnostics(error: unknown, life: Lifetime): readonly [Diagnostic, ...Diagnostic[]] {
    try {
      life.check();
    } catch (reason) {
      return diagnostics(reason);
    }
    return diagnostics(error);
  }
}

export function createHttpDataService(options: HttpDataServiceOptions): DataService {
  return new HttpDataServiceImpl(options);
}

export { DEFAULT_PATHS };
