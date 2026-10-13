import type { Outcome, QuerySpec } from '@varendo/core';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import {
  createDataHttpHandler,
  createHttpDataService,
  createLocalDataService,
  type DataHttpHandler,
  type DataRecord,
  type DataService,
  type HttpDataServiceOptions,
  type LocalDataService,
  type QueryBudget,
  type ReadGrant,
  type ReadContext,
  type ResultEvent,
  type AcceptedQuery,
} from '@varendo/runtime/data';
import { peopleFeature, type Person } from './people.js';

export const securityBudget: QueryBudget = Object.freeze({
  maxRows: 10,
  maxBytes: 100_000,
  maxMessages: 16,
  maxMilliseconds: 2_000,
  maxColumns: 10,
});

export interface SecuritySerializedRequest {
  readonly principal: 'tenant-a' | 'tenant-b';
  readonly path: string;
  readonly body: unknown;
}

export interface SecurityInvocation {
  readonly status: 'ok' | 'denied' | 'failed';
  readonly diagnostics: readonly string[];
  readonly rows: readonly DataRecord[];
  readonly cursor?: string;
}

export interface SecurityTenant {
  readonly key: 'tenant-a' | 'tenant-b';
  readonly scopeDigest: string;
  readonly privateRow: Person;
  readonly backend: { readonly effects: readonly DataRecord[] };
  readonly visibleRows: readonly DataRecord[];
  readonly capturedRequest: AcceptedQuery | undefined;
  readonly capturedCursor: string | undefined;
  readonly invoke: (request: AcceptedQuery) => Promise<SecurityInvocation>;
  readonly readPage: (input?: { readonly cursor?: string }) => Promise<SecurityInvocation>;
}

export interface TwoTenantSecurityFixture {
  readonly tenantA: SecurityTenant;
  readonly tenantB: SecurityTenant;
  readonly handler: DataHttpHandler;
  readonly requests: readonly SecuritySerializedRequest[];
  readonly rawRequest: (input: {
    readonly path: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body: unknown;
    readonly method?: string;
  }) => Promise<Response>;
  readonly dispose: () => Promise<void>;
}

type TenantKey = SecurityTenant['key'];

interface Principal {
  readonly key: TenantKey;
  readonly scopeDigest: string;
  readonly cursorPartition: string;
  readonly policyRevision: string;
}

const principals: Readonly<Record<string, Principal>> = Object.freeze({
  'Bearer tenant-a': Object.freeze({
    key: 'tenant-a',
    scopeDigest: 'security-scope-tenant-a',
    cursorPartition: 'security-partition-tenant-a',
    policyRevision: 'security-policy-1',
  }),
  'Bearer tenant-b': Object.freeze({
    key: 'tenant-b',
    scopeDigest: 'security-scope-tenant-b',
    cursorPartition: 'security-partition-tenant-b',
    policyRevision: 'security-policy-1',
  }),
});

const rows: readonly DataRecord[] = Object.freeze([
  Object.freeze({ id: 'tenant-a-private', name: 'A private row', team: 'Design' }),
  Object.freeze({ id: 'tenant-a-second', name: 'A second private row', team: 'Engineering' }),
  Object.freeze({ id: 'tenant-b-private', name: 'B private row', team: 'Engineering' }),
  Object.freeze({ id: 'tenant-b-second', name: 'B second private row', team: 'Design' }),
]);

function requireFunctionRegistry() {
  const outcome = createQueryFunctionRegistry({ version: '2' });
  if (!outcome.ok) throw new TypeError(outcome.diagnostics[0]?.message ?? 'Function registry unavailable.');
  return outcome.value;
}

const functionRegistry = requireFunctionRegistry();

function failure<T>(code: string, message: string): Outcome<T> {
  return { ok: false, diagnostics: [{ code, message, retryable: false }] };
}

function principalFromContext(context: ReadContext): Principal | undefined {
  const value = context.principal;
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = value as Partial<Principal>;
  if (
    (candidate.key !== 'tenant-a' && candidate.key !== 'tenant-b') ||
    typeof candidate.scopeDigest !== 'string' ||
    typeof candidate.cursorPartition !== 'string' ||
    typeof candidate.policyRevision !== 'string'
  )
    return undefined;
  return candidate as Principal;
}

function rowBelongsTo(principal: Principal, row: DataRecord): boolean {
  return typeof row.id === 'string' && row.id.startsWith(`${principal.key}-`);
}

function sourceSnapshot() {
  return Object.freeze({
    catalog: peopleFeature.catalog,
    sourceRevision: 'security-source-1',
    records: Object.freeze({ people: rows }),
  });
}

function authorizeRead(
  input: Parameters<NonNullable<Parameters<typeof createLocalDataService>[0]['authorize']>>[0],
): Outcome<ReadGrant> {
  const principal = principalFromContext(input.context);
  if (principal === undefined) return failure('data.denied', 'The request is not bound to an authenticated tenant.');
  return {
    ok: true,
    value: {
      scopeDigest: principal.scopeDigest,
      cursorPartition: principal.cursorPartition,
      policyRevision: principal.policyRevision,
      rowPolicy: ({ row }) => rowBelongsTo(principal, row),
    },
  };
}

function collectRows(events: readonly ResultEvent[]): readonly DataRecord[] {
  return Object.freeze(events.flatMap((event) => (event.kind === 'batch' ? event.rows : [])) as readonly DataRecord[]);
}

async function collectExecution(
  service: DataService,
  request: AcceptedQuery,
  context: ReadContext,
): Promise<SecurityInvocation> {
  const events: ResultEvent[] = [];
  for await (const event of service.execute(request, context)) events.push(event);
  const error = events.find(
    (event): event is Extract<ResultEvent, { readonly kind: 'error' }> => event.kind === 'error',
  );
  const completion = events.find(
    (event): event is Extract<ResultEvent, { readonly kind: 'complete' }> => event.kind === 'complete',
  );
  const rows = collectRows(events);
  return {
    status: error === undefined ? 'ok' : error.error.code.startsWith('data.denied') ? 'denied' : 'failed',
    diagnostics: error === undefined ? [] : [error.error.code],
    rows,
    ...(completion?.cursor === undefined ? {} : { cursor: completion.cursor }),
  };
}

function query(cursor?: string): QuerySpec {
  return {
    entity: peopleFeature.entity.id,
    fields: ['id', 'name', 'team'],
    measures: [],
    relations: [],
    groupBy: [],
    population: { kind: 'all-authorized' },
    order: [],
    page: { size: 1, ...(cursor === undefined ? {} : { cursor }) },
  };
}

function acceptedRequest(body: unknown): AcceptedQuery | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const value = body as Partial<AcceptedQuery>;
  return typeof value.planDigest === 'string' && typeof value.requestId === 'string'
    ? (value as AcceptedQuery)
    : undefined;
}

function makeFetch(
  handler: DataHttpHandler,
  principal: TenantKey,
  requests: SecuritySerializedRequest[],
  requestByTenant: Map<TenantKey, SecuritySerializedRequest[]>,
): NonNullable<HttpDataServiceOptions['fetch']> {
  return async (input, init) => {
    const request = new Request(String(input), init);
    const bodyText = await request.clone().text();
    const body = JSON.parse(bodyText) as unknown;
    const entry = Object.freeze({ principal, path: new URL(request.url).pathname, body });
    requests.push(entry);
    const own = requestByTenant.get(principal);
    own?.push(entry);
    return handler(request);
  };
}

function makeClient(
  handler: DataHttpHandler,
  principal: TenantKey,
  requests: SecuritySerializedRequest[],
  requestByTenant: Map<TenantKey, SecuritySerializedRequest[]>,
) {
  return createHttpDataService({
    baseUrl: 'https://security.varendo.test',
    headers: { authorization: `Bearer ${principal}` },
    fetch: makeFetch(handler, principal, requests, requestByTenant),
  });
}

function tenantHandle(
  principal: Principal,
  client: DataService,
  ownRequests: SecuritySerializedRequest[],
  effects: DataRecord[],
): SecurityTenant {
  let visibleRows: readonly DataRecord[] = Object.freeze([]);
  let capturedCursor: string | undefined;
  const readPage = async (input: { readonly cursor?: string } = {}): Promise<SecurityInvocation> => {
    const planned = await client.plan(
      {
        version: '1',
        requestId: `security-${principal.key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        catalogRevision: peopleFeature.catalog.revision,
        target: { taskId: 'security-task', outputId: 'people' },
        query: query(input.cursor),
        budget: securityBudget,
      },
      { principal },
    );
    if (!planned.ok) {
      return { status: 'denied', diagnostics: [planned.diagnostics[0]?.code ?? 'data.denied'], rows: [] };
    }
    const invocation = await collectExecution(client, planned.value, { principal });
    if (invocation.status === 'ok') {
      visibleRows = Object.freeze([...visibleRows, ...invocation.rows]);
      effects.push(...invocation.rows);
      capturedCursor = invocation.cursor;
    }
    return invocation;
  };
  const invoke = async (request: AcceptedQuery): Promise<SecurityInvocation> => {
    const invocation = await collectExecution(client, request, { principal });
    if (invocation.status === 'ok') {
      visibleRows = Object.freeze([...visibleRows, ...invocation.rows]);
      effects.push(...invocation.rows);
      capturedCursor = invocation.cursor;
    }
    return invocation;
  };
  return {
    key: principal.key,
    scopeDigest: principal.scopeDigest,
    privateRow: {
      id: `${principal.key}-private`,
      name: `${principal.key} private`,
      team: principal.key === 'tenant-a' ? 'Design' : 'Engineering',
    },
    backend: { effects },
    get visibleRows() {
      return visibleRows;
    },
    get capturedRequest() {
      return ownRequests
        .map((request) => acceptedRequest(request.body))
        .find((value): value is AcceptedQuery => value !== undefined);
    },
    get capturedCursor() {
      return capturedCursor;
    },
    invoke,
    readPage,
  };
}

export async function createTwoTenantFixture(): Promise<TwoTenantSecurityFixture> {
  const requests: SecuritySerializedRequest[] = [];
  const requestByTenant = new Map<TenantKey, SecuritySerializedRequest[]>([
    ['tenant-a', []],
    ['tenant-b', []],
  ]);
  let disposed = false;
  const serviceState = { effects: [] as DataRecord[] };
  const baseService = createLocalDataService({
    snapshot: sourceSnapshot(),
    functionRegistry,
    planTtlMs: 10_000,
    cursorTtlMs: 10_000,
    authorize: authorizeRead,
  });
  const service: DataService = {
    describe: (request, context) => baseService.describe(request, context),
    plan: (request, context) => baseService.plan(request, context),
    async *execute(request, context) {
      yield* baseService.execute(request, context);
    },
  };
  const handler = createDataHttpHandler({
    service,
    allowedOrigin: 'https://app.security.test',
    maxRequestBytes: 100_000,
    maxRequestMilliseconds: 2_000,
    maxConcurrentRequests: 4,
    authenticate: (request) => {
      if (disposed) return failure('data.authorization', 'The security fixture is disposed.');
      const principal = principals[request.headers.get('authorization') ?? ''];
      return principal === undefined
        ? failure('data.authorization', 'The request credentials are invalid.')
        : { ok: true, value: { principal } };
    },
  });
  const tenantAPrincipal = principals['Bearer tenant-a']!;
  const tenantBPrincipal = principals['Bearer tenant-b']!;
  const clientA = makeClient(handler, 'tenant-a', requests, requestByTenant);
  const clientB = makeClient(handler, 'tenant-b', requests, requestByTenant);
  const tenantA = tenantHandle(tenantAPrincipal, clientA, requestByTenant.get('tenant-a')!, serviceState.effects);
  const tenantB = tenantHandle(tenantBPrincipal, clientB, requestByTenant.get('tenant-b')!, []);
  await tenantA.readPage();
  const rawRequest = async (input: {
    readonly path: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body: unknown;
    readonly method?: string;
  }): Promise<Response> => {
    const headers = new Headers(input.headers);
    if (input.body !== undefined) headers.set('content-type', 'application/json');
    return handler(
      new Request(`https://security.varendo.test${input.path}`, {
        method: input.method ?? 'POST',
        headers,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      }),
    );
  };
  return {
    tenantA,
    tenantB,
    handler,
    requests,
    rawRequest,
    dispose: async () => {
      disposed = true;
    },
  };
}

export function securityPrincipal(key: TenantKey): Principal {
  return principals[`Bearer ${key}`]!;
}

export function securityQuery(cursor?: string): QuerySpec {
  return query(cursor);
}

export function securityRows(): readonly DataRecord[] {
  return rows;
}

export function securityService(
  options: {
    readonly now?: () => number;
    readonly maxPlans?: number;
    readonly maxCursors?: number;
    readonly cursorTtlMs?: number;
    readonly ttlSourceRevision?: string;
  } = {},
): LocalDataService {
  return createLocalDataService({
    snapshot: Object.freeze({
      catalog: peopleFeature.catalog,
      sourceRevision: options.ttlSourceRevision ?? 'security-source-retention-1',
      records: Object.freeze({ people: rows }),
    }),
    functionRegistry,
    authorize: authorizeRead,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.maxPlans === undefined ? {} : { maxPlans: options.maxPlans }),
    ...(options.maxCursors === undefined ? {} : { maxCursors: options.maxCursors }),
    ...(options.cursorTtlMs === undefined ? {} : { cursorTtlMs: options.cursorTtlMs }),
  });
}
