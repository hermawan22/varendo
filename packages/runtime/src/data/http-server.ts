import { parseResultEvent, WIRE_LIMITS } from '@varendo/core';
import { DataStreamError, readResultStream } from './stream.js';
import {
  asError,
  canonical,
  diagnostics,
  encoder,
  errorPayload,
  json,
  Lifetime,
  positive,
  readText,
  reject,
  responseHeaders,
  statusFor,
  streamContext,
  unwrap,
  within,
} from './http-common.js';
import {
  parseAcceptedQuery,
  parseCatalogPage,
  parseCatalogRequest,
  parseJSON,
  parsePlanAcceptance,
  parsePlanRequest,
} from './schema.js';
import type {
  AcceptedQuery,
  CatalogRequest,
  DataHttpHandler,
  DataHttpServerOptions,
  DataService,
  HttpDataPaths,
  PlanRequest,
  QueryBudget,
  ReadContext,
} from './types.js';
import { DEFAULT_PATHS } from './http-common.js';

interface ServerConfig {
  readonly paths: HttpDataPaths;
  readonly service: DataService;
  readonly authenticate: DataHttpServerOptions['authenticate'];
  readonly maximumBytes: number;
  readonly milliseconds: number;
  readonly maximumConcurrent: number;
  readonly allowedOrigin: string | undefined;
  active: number;
}

type ServerInput =
  | { readonly kind: 'describe'; readonly value: CatalogRequest }
  | { readonly kind: 'plan'; readonly value: PlanRequest }
  | { readonly kind: 'execute'; readonly value: AcceptedQuery };

type Preflight =
  { readonly kind: 'accepted'; readonly pathname: string } | { readonly kind: 'response'; readonly response: Response };

type Authentication =
  { readonly ok: true; readonly principal?: unknown } | { readonly ok: false; readonly response: Response };

function serverPaths(configured?: Partial<HttpDataPaths>): HttpDataPaths {
  const paths = { ...DEFAULT_PATHS, ...configured };
  if (new Set(Object.values(paths)).size !== 3) throw new TypeError('data service endpoint paths must be distinct.');
  for (const path of Object.values(paths)) validateServerPath(path);
  return paths;
}

function validateServerPath(path: string): void {
  const url = new URL(path, 'https://adc.invalid');
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    url.origin !== 'https://adc.invalid' ||
    url.pathname !== path ||
    url.search ||
    url.hash
  )
    throw new TypeError('data service server paths must be absolute URL paths.');
}

function createServerConfig(options: DataHttpServerOptions): ServerConfig {
  const maximumBytes = positive(options.maxRequestBytes ?? WIRE_LIMITS.bytes, 'maxRequestBytes', WIRE_LIMITS.bytes);
  const milliseconds = positive(options.maxRequestMilliseconds ?? 30_000, 'maxRequestMilliseconds', 86_400_000);
  const maximumConcurrent = positive(options.maxConcurrentRequests ?? 32, 'maxConcurrentRequests', 10_000);
  const allowedOrigin = options.allowedOrigin;
  if (allowedOrigin !== undefined && new URL(allowedOrigin).origin !== allowedOrigin)
    throw new TypeError('allowedOrigin must be one exact HTTP(S) origin.');
  return {
    paths: serverPaths(options.paths),
    service: options.service,
    authenticate: options.authenticate,
    maximumBytes,
    milliseconds,
    maximumConcurrent,
    allowedOrigin,
    active: 0,
  };
}

function preflight(request: Request, config: ServerConfig): Preflight {
  const pathname = new URL(request.url).pathname;
  if (!Object.values(config.paths).includes(pathname)) return { kind: 'response', response: routeFailure() };
  const origin = request.headers.get('origin');
  if (config.allowedOrigin !== undefined && origin !== null && origin !== config.allowedOrigin)
    return { kind: 'response', response: originFailure() };
  if (request.method === 'OPTIONS') return { kind: 'response', response: optionsResponse(config.allowedOrigin) };
  if (request.method !== 'POST')
    return {
      kind: 'response',
      response: requestFailure('data.method', 'The data service endpoint requires POST.', 405, config.allowedOrigin),
    };
  if (!isJsonRequest(request))
    return {
      kind: 'response',
      response: requestFailure(
        'data.content-type',
        'data service requests require application/json.',
        415,
        config.allowedOrigin,
      ),
    };
  if (config.active >= config.maximumConcurrent)
    return {
      kind: 'response',
      response: requestFailure(
        'data.http-busy',
        'The data service host has reached its concurrent request limit.',
        429,
        config.allowedOrigin,
        true,
      ),
    };
  return { kind: 'accepted', pathname };
}

function routeFailure(): Response {
  return json(
    errorPayload('unknown-request', [
      { code: 'data.route', message: 'The data service endpoint was not found.', retryable: false },
    ]),
    404,
  );
}

function originFailure(): Response {
  return json(
    errorPayload('unknown-request', [
      { code: 'data.origin', message: 'The request origin is not allowed.', retryable: false },
    ]),
    403,
  );
}

function requestFailure(
  code: string,
  message: string,
  status: number,
  origin: string | undefined,
  retryable = false,
): Response {
  return json(errorPayload('unknown-request', [{ code, message, retryable }]), status, origin);
}

function optionsResponse(origin: string | undefined): Response {
  const response = responseHeaders('text/plain', origin);
  response.set('access-control-allow-methods', 'POST, OPTIONS');
  response.set('access-control-allow-headers', 'content-type, authorization');
  return new Response(null, { status: 204, headers: response });
}

function isJsonRequest(request: Request): boolean {
  return request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

function inputFromBody(raw: unknown, pathname: string, paths: HttpDataPaths): ServerInput {
  if (pathname === paths.describe) return { kind: 'describe', value: unwrap(parseCatalogRequest(raw)) };
  if (pathname === paths.plan) return { kind: 'plan', value: unwrap(parsePlanRequest(raw)) };
  return { kind: 'execute', value: unwrap(parseAcceptedQuery(raw)) };
}

function requestBudget(input: ServerInput): QueryBudget {
  return input.kind === 'execute' ? input.value.effectiveBudget : input.value.budget;
}

function inputRequestId(input: ServerInput): string {
  return input.value.requestId;
}

async function authenticateRequest(
  request: Request,
  life: Lifetime,
  config: ServerConfig,
  requestId: string,
): Promise<Authentication> {
  if (config.authenticate === undefined) return { ok: true };
  const authRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    signal: life.signal,
  });
  life.retainRequest(authRequest);
  let outcome;
  try {
    outcome = await life.wait(() => config.authenticate!(authRequest));
  } catch (error) {
    if (error instanceof DataStreamError) throw error;
    reject('data.authorization', 'The data service authentication failed.');
  }
  if (!outcome.ok)
    return {
      ok: false,
      response: json(
        errorPayload(requestId, outcome.diagnostics),
        statusFor(outcome.diagnostics),
        config.allowedOrigin,
      ),
    };
  return { ok: true, principal: outcome.value.principal };
}

function contextFor(life: Lifetime, principal: unknown): ReadContext {
  return { signal: life.signal, ...(principal === undefined ? {} : { principal }) };
}

async function requestInput(
  request: Request,
  pathname: string,
  config: ServerConfig,
  life: Lifetime,
): Promise<ServerInput> {
  const body = await readText(request.body, config.maximumBytes, life);
  const raw = unwrap(parseJSON(body, 'http-request'));
  const input = inputFromBody(raw, pathname, config.paths);
  life.tighten(requestBudget(input).maxMilliseconds);
  return input;
}

async function metadataResponse(
  input: Exclude<ServerInput, { readonly kind: 'execute' }>,
  context: ReadContext,
  life: Lifetime,
  config: ServerConfig,
): Promise<Response> {
  if (input.kind === 'describe') return describeResponse(input.value, context, life, config);
  return planResponse(input.value, context, life, config);
}

async function describeResponse(
  request: CatalogRequest,
  context: ReadContext,
  life: Lifetime,
  config: ServerConfig,
): Promise<Response> {
  const outcome = await life.wait(() => config.service.describe(request, context));
  if (!outcome.ok)
    return json(
      errorPayload(request.requestId, outcome.diagnostics),
      statusFor(outcome.diagnostics),
      config.allowedOrigin,
    );
  const response = unwrap(parseCatalogPage(outcome.value));
  return encodeMetadataResponse(response, request.requestId, request.target, request.budget, life, config);
}

async function planResponse(
  request: PlanRequest,
  context: ReadContext,
  life: Lifetime,
  config: ServerConfig,
): Promise<Response> {
  const outcome = await life.wait(() => config.service.plan(request, context));
  if (!outcome.ok)
    return json(
      errorPayload(request.requestId, outcome.diagnostics),
      statusFor(outcome.diagnostics),
      config.allowedOrigin,
    );
  const response = unwrap(parsePlanAcceptance(outcome.value));
  return encodeMetadataResponse(response, request.requestId, request.target, request.budget, life, config);
}

function encodeMetadataResponse<
  T extends { readonly requestId: string; readonly target: unknown; readonly effectiveBudget: QueryBudget },
>(
  response: T,
  requestId: string,
  target: unknown,
  budget: QueryBudget,
  life: Lifetime,
  config: ServerConfig,
): Response {
  if (
    response.requestId !== requestId ||
    canonical(response.target) !== canonical(target) ||
    !within(response.effectiveBudget, budget)
  )
    reject('data.http-correlation', 'The data service service response does not match its request.');
  const encoded = JSON.stringify(response);
  if (encoder.encode(encoded).byteLength > Math.min(config.maximumBytes, budget.maxBytes))
    reject('data.http-budget', 'The data service response exceeds its byte budget.');
  life.check();
  return new Response(encoded, {
    status: 200,
    headers: responseHeaders('application/json; charset=utf-8', config.allowedOrigin),
  });
}

function cancelExecution(life: Lifetime, iterator: AsyncIterator<unknown>): void {
  life.cancel();
  try {
    void Promise.resolve(iterator.return?.()).catch(() => {});
  } catch {
    // A host iterator may reject cleanup; cancellation remains nonblocking.
  }
}

async function pullSource(
  controller: ReadableStreamDefaultController<Uint8Array>,
  iterator: AsyncIterator<unknown>,
  life: Lifetime,
  cleanup: () => void,
): Promise<void> {
  try {
    const next = await life.wait(() => iterator.next());
    if (next.done) {
      controller.close();
      return;
    }
    const event = unwrap(parseResultEvent(next.value));
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
  } catch (error) {
    controller.error(error);
    cleanup();
  }
}

function sourceStream(
  iterator: AsyncIterator<unknown>,
  life: Lifetime,
  cleanup: () => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull: (controller) => pullSource(controller, iterator, life, cleanup),
    cancel: cleanup,
  });
}

async function pullValidated(
  controller: ReadableStreamDefaultController<Uint8Array>,
  events: AsyncGenerator<ReturnType<typeof asError>>,
  life: Lifetime,
  requestId: string,
  cleanup: () => void,
  finish: () => void,
  abort: () => void,
): Promise<void> {
  try {
    const next = await life.wait(() => events.next());
    if (next.done) {
      controller.close();
      life.signal.removeEventListener('abort', abort);
      finish();
      return;
    }
    controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
  } catch (error) {
    const terminal = asError(requestId, diagnostics(error));
    controller.enqueue(encoder.encode(`${JSON.stringify(terminal)}\n`));
    controller.close();
    life.signal.removeEventListener('abort', abort);
    cleanup();
    finish();
  }
}

function responseStream(
  events: AsyncGenerator<ReturnType<typeof asError>>,
  life: Lifetime,
  requestId: string,
  cleanup: () => void,
  finish: () => void,
  abort: () => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull: (controller) => pullValidated(controller, events, life, requestId, cleanup, finish, abort),
    cancel: () => {
      life.signal.removeEventListener('abort', abort);
      cleanup();
      void events.return(undefined).catch(() => {});
      finish();
    },
  });
}

function executionResponse(
  accepted: AcceptedQuery,
  context: ReadContext,
  life: Lifetime,
  config: ServerConfig,
  finish: () => void,
): Response {
  const iterator = config.service.execute(accepted, context)[Symbol.asyncIterator]();
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    cancelExecution(life, iterator);
  };
  const raw = sourceStream(iterator, life, cleanup);
  const events = readResultStream(raw, streamContext(accepted, life)) as AsyncGenerator<ReturnType<typeof asError>>;
  const abort = (): void => {
    cleanup();
    finish();
  };
  life.signal.addEventListener('abort', abort, { once: true });
  const body = responseStream(events, life, accepted.requestId, cleanup, finish, abort);
  return new Response(body, {
    status: 200,
    headers: responseHeaders('application/x-ndjson; charset=utf-8', config.allowedOrigin),
  });
}

async function handleAdmittedRequest(request: Request, pathname: string, config: ServerConfig): Promise<Response> {
  const life = new Lifetime(config.milliseconds, request.signal);
  let finished = false;
  let streamed = false;
  let requestId = 'unknown-request';
  const finish = (): void => {
    if (finished) return;
    finished = true;
    config.active -= 1;
    life.dispose();
  };
  try {
    const input = await requestInput(request, pathname, config, life);
    requestId = inputRequestId(input);
    const authentication = await authenticateRequest(request, life, config, requestId);
    if (!authentication.ok) return authentication.response;
    const context = contextFor(life, authentication.principal);
    if (input.kind !== 'execute') return await metadataResponse(input, context, life, config);
    const response = executionResponse(input.value, context, life, config, finish);
    streamed = true;
    return response;
  } catch (error) {
    const errors = diagnostics(error);
    return json(errorPayload(requestId, errors), statusFor(errors), config.allowedOrigin);
  } finally {
    if (!streamed) finish();
  }
}

async function dispatchRequest(request: Request, config: ServerConfig): Promise<Response> {
  const checked = preflight(request, config);
  if (checked.kind === 'response') return checked.response;
  config.active += 1;
  return handleAdmittedRequest(request, checked.pathname, config);
}

export function createDataHttpHandler(options: DataHttpServerOptions): DataHttpHandler {
  const config = createServerConfig(options);
  return (request) => dispatchRequest(request, config);
}
