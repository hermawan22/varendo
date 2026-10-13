import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { defineDataFeature } from '@varendo/core/features';
import type { Catalog, Diagnostic, Intent, MeaningDefinition, Outcome, QuerySpec, Result } from '@varendo/core';
import {
  createVarendoRuntime,
  type DataSurfaceBindings,
  type LocalSurfaceScope,
  type SurfaceController,
} from '@varendo/runtime';
import { createResultStore, type ResultBeginInput, type ResultStore } from '@varendo/runtime/results';
import {
  createDataHttpHandler,
  createHttpDataService,
  type AcceptedQuery,
  type CatalogPage,
  type CatalogRequest,
  type DataHttpHandler,
  type DataService,
  type DataRecord,
  type DataValue,
  type PlanAcceptance,
  type PlanRequest,
  type QueryBudget,
  type ReadContext,
  type ResultEvent,
} from '@varendo/runtime/data';
import { z } from 'zod';

const PersonSchema = z.object({ id: z.string(), name: z.string(), team: z.enum(['Design', 'Engineering']) });
type Person = z.infer<typeof PersonSchema>;

const BUDGET: QueryBudget = Object.freeze({
  maxRows: 10_000,
  maxBytes: 8_000_000,
  maxMessages: 64,
  maxMilliseconds: 30_000,
  maxColumns: 128,
});

const countMeaning: MeaningDefinition = {
  id: 'people.global-count',
  revision: '1',
  label: 'People count',
  explanation: 'Count of all authorized people in the selected source population.',
  output: { value: 'integer', nullable: false },
  implementation: {
    kind: 'expression' as const,
    expression: { kind: 'literal' as const, value: 0, type: { value: 'integer' as const, nullable: false } },
  },
  dependencies: [],
  functionRegistryDigest: 'core-query-2',
  origin: 'system' as const,
  lifecycle: 'active' as const,
  scope: 'organization' as const,
  authority: 'approved' as const,
  aggregation: 'additive' as const,
  aggregationDimensions: [],
  missingPolicy: 'reject' as const,
};

function countMeaningFor(revision: string): MeaningDefinition {
  return revision === countMeaning.revision ? countMeaning : { ...countMeaning, revision };
}

type RemotePeopleState = {
  readonly rows: readonly Person[];
  readonly loaded?: number;
  readonly count?: number;
  readonly cursor?: string;
  readonly coverage?: Result['coverage'];
  readonly population?: Result['counts']['population'];
};

type RemoteDescriptor = Extract<ResultEvent, { kind: 'descriptor' }>['descriptor'];

export type RemotePageState = Omit<RemotePeopleState, 'rows'> & {
  readonly rows: readonly DataRecord[];
  readonly sourceRevision?: string;
  readonly identity?: readonly string[];
  readonly rowGrain?: readonly string[];
  readonly consistency?: RemoteDescriptor['consistency'];
};

type RemotePrincipal = {
  readonly key: 'tenant-a' | 'tenant-b';
  readonly tenant: string;
  /** Opaque server-side partition used to authenticate cursor proofs. */
  readonly partition: string;
  readonly scopeDigest: string;
  readonly policyRevision: string;
};

type RemoteCursor = {
  readonly version: 1;
  readonly mode: 'snapshot' | 'keyset';
  readonly catalogRevision: string;
  readonly schemaRevision: string;
  readonly meaningRevision: string;
  readonly sourceRevision: string;
  readonly sourceLineage: string;
  readonly snapshotId: string;
  readonly scopeDigest: string;
  readonly policyRevision: string;
  readonly queryDigest: string;
  readonly orderDigest: string;
  readonly target: string;
  readonly offset: number;
  readonly anchor?: readonly [string];
  readonly expiresAt: number;
  readonly proof: string;
};

type RemoteMutationState = {
  leadingInserted: boolean;
  sourceRevisionEpoch: number;
};

const CURSOR_SECRET = 'remote-people-cursor-secret-v1';

export interface RemoteRequestObservation {
  readonly kind: string;
  readonly principal?: string;
  readonly query?: QuerySpec;
}

export interface RemoteResultStoreBeginObservation extends ResultBeginInput {
  readonly generation: number;
}

export interface RemotePrincipalSurface {
  readonly runtime: ReturnType<typeof createVarendoRuntime>;
  readonly scope: LocalSurfaceScope;
  readonly surface: SurfaceController<Intent, RemotePeopleState>;
  readonly dispose: () => void;
}

export interface RemotePeopleFixture {
  readonly runtime: ReturnType<typeof createVarendoRuntime>;
  readonly scope: LocalSurfaceScope;
  readonly surface: SurfaceController<Intent, RemotePeopleState>;
  readonly globalCountIntent: Intent;
  readonly client: DataService;
  readonly feature: ReturnType<typeof createRemoteFeature>;
  readonly server: {
    readonly origin: string;
    readonly observedRequests: readonly RemoteRequestObservation[];
    readonly cancelledRequests: readonly string[];
    readonly lateDescriptors: readonly RemoteDescriptor[];
    readonly resultStoreBegins: readonly RemoteResultStoreBeginObservation[];
    readonly insertLeadingRow: () => void;
    readonly dispose: () => Promise<void>;
  };
  readonly resultStoreBegins: readonly RemoteResultStoreBeginObservation[];
  readonly authorityReads: readonly string[];
  readonly createPrincipalSurface: (principal: 'tenant-a' | 'tenant-b') => RemotePrincipalSurface;
  readonly requestPage: (input?: {
    readonly principal?: 'tenant-a' | 'tenant-b';
    readonly cursor?: string;
    readonly order?: QuerySpec['order'];
    readonly fields?: readonly string[];
    readonly where?: QuerySpec['where'];
    readonly target?: PlanRequest['target'];
  }) => Promise<RemotePageState>;
  readonly dispose: () => Promise<void>;
}

export interface RemotePeopleFixtureOptions {
  readonly logicalRows: number;
  readonly pageSize: number;
  readonly aggregate: boolean;
  readonly pagination?: 'snapshot' | 'keyset';
  readonly leadingInsertOnContinuation?: boolean;
  readonly mutateDuringExecution?: boolean;
  /** Optional semantic revision knobs used to exercise cursor invalidation. */
  readonly sourceRevision?: string;
  /** Immutable source stream identity, distinct from its advancing revision. */
  readonly sourceLineage?: string;
  readonly schemaRevision?: string;
  readonly meaningRevision?: string;
  readonly policyRevision?: string;
  readonly sameAuthorityLabels?: boolean;
  readonly cursorTtlMs?: number;
  readonly estimatedPopulation?: boolean;
  /** Keep an emitted descriptor stream active until the HTTP client cancels it. */
  readonly waitForCancellationAfterDescriptor?: boolean;
  /** Test barrier that deliberately does not listen for cancellation. */
  readonly executionGate?: {
    readonly started: () => void;
    readonly release: Promise<void>;
    readonly wasCancelled: () => boolean;
  };
}

function createRemoteFeature(aggregate: boolean, schemaRevision: string, meaning: MeaningDefinition) {
  return defineDataFeature({
    id: 'people',
    schema: PersonSchema,
    identity: ['id'],
    revision: schemaRevision,
    fields: { name: { role: 'attribute' }, team: { role: 'dimension' } },
    ...(aggregate ? { meanings: [meaning] } : {}),
  });
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(',')}}`;
}

function digest(value: unknown): string {
  return `remote-${createHash('sha256').update(canonical(value)).digest('hex').slice(0, 24)}`;
}

function lineageDigest(output: string, lineage: readonly { readonly inputs: readonly unknown[] }[]): string {
  const inputs = lineage.flatMap((edge) => edge.inputs);
  return `lineage-${createHash('sha256').update(canonical({ output, inputs })).digest('hex')}`;
}

function cursorUnsigned(value: RemoteCursor): Omit<RemoteCursor, 'proof'> {
  const { proof: _proof, ...unsigned } = value;
  return unsigned;
}

function cursorProof(value: RemoteCursor, principal: RemotePrincipal): string {
  return `remote-${createHmac('sha256', CURSOR_SECRET)
    .update(`${principal.partition}:${canonical(cursorUnsigned(value))}`)
    .digest('hex')
    .slice(0, 24)}`;
}

function proofMatches(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cursorText(value: RemoteCursor, principal: RemotePrincipal): string {
  const signed = { ...value, proof: cursorProof(value, principal) };
  return Buffer.from(canonical(signed)).toString('base64url');
}

function parseCursor(value: string | undefined): RemoteCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<RemoteCursor>;
    if (
      parsed.version !== 1 ||
      (parsed.mode !== 'snapshot' && parsed.mode !== 'keyset') ||
      typeof parsed.catalogRevision !== 'string' ||
      typeof parsed.schemaRevision !== 'string' ||
      typeof parsed.meaningRevision !== 'string' ||
      typeof parsed.sourceRevision !== 'string' ||
      typeof parsed.sourceLineage !== 'string' ||
      typeof parsed.snapshotId !== 'string' ||
      typeof parsed.scopeDigest !== 'string' ||
      typeof parsed.policyRevision !== 'string' ||
      typeof parsed.queryDigest !== 'string' ||
      typeof parsed.orderDigest !== 'string' ||
      typeof parsed.target !== 'string' ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      typeof parsed.proof !== 'string' ||
      !Number.isSafeInteger(parsed.offset) ||
      (parsed.offset ?? -1) < 0 ||
      (parsed.anchor !== undefined &&
        (!Array.isArray(parsed.anchor) || parsed.anchor.length !== 1 || typeof parsed.anchor[0] !== 'string'))
    )
      return undefined;
    return parsed as RemoteCursor;
  } catch {
    return undefined;
  }
}

function failed<T>(
  code: string,
  message: string,
  path?: readonly (string | number)[],
  remedies?: readonly string[],
): Outcome<T> {
  const diagnostic: Diagnostic = {
    code,
    message,
    retryable: false,
    ...(path === undefined ? {} : { path }),
    ...(remedies === undefined ? {} : { remedies }),
  };
  return { ok: false, diagnostics: [diagnostic] };
}

function principalFrom(context: ReadContext): RemotePrincipal | undefined {
  if (context.principal === null || typeof context.principal !== 'object') return undefined;
  const value = context.principal as Partial<RemotePrincipal>;
  if (value.key !== 'tenant-a' && value.key !== 'tenant-b') return undefined;
  if (
    value.tenant !== value.key ||
    typeof value.partition !== 'string' ||
    typeof value.scopeDigest !== 'string' ||
    typeof value.policyRevision !== 'string'
  )
    return undefined;
  return value as RemotePrincipal;
}

function normalizedQuery(query: QuerySpec): QuerySpec {
  if (query.page?.cursor === undefined) return query;
  return { ...query, page: { size: query.page.size } };
}

function queryDigest(query: QuerySpec): string {
  return digest(normalizedQuery(query));
}

function orderDigest(query: QuerySpec): string {
  return digest(query.order);
}

function targetDigest(target: PlanRequest['target']): string {
  return canonical(target);
}

function populationIdentity(query: QuerySpec): Pick<QuerySpec, 'entity' | 'population' | 'where'> {
  const normalized = normalizedQuery(query);
  return {
    entity: normalized.entity,
    population: normalized.population,
    ...(normalized.where === undefined ? {} : { where: normalized.where }),
  };
}

function sourceRevisionFor(
  _principal: RemotePrincipal,
  options: RemotePeopleFixtureOptions,
  mutation: RemoteMutationState,
): string {
  const base = options.sourceRevision ?? 'remote-people-source-1';
  if (mutation.sourceRevisionEpoch === 0) return base;
  return `${base}-mutation-${mutation.sourceRevisionEpoch}`;
}

function sourceLineageFor(options: RemotePeopleFixtureOptions): string {
  return options.sourceLineage ?? options.sourceRevision ?? 'remote-people-source-1';
}

function schemaRevisionFor(options: RemotePeopleFixtureOptions): string {
  return options.schemaRevision ?? '1';
}

function cursorTtl(options: RemotePeopleFixtureOptions): number {
  const value = options.cursorTtlMs ?? 30_000;
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400_000)
    throw new TypeError('cursorTtlMs must be a bounded positive duration.');
  return value;
}

function observe(
  observations: RemoteRequestObservation[],
  kind: string,
  principal: RemotePrincipal | undefined,
  query?: QuerySpec,
): void {
  observations.push({
    kind,
    ...(principal === undefined ? {} : { principal: principal.key }),
    ...(query === undefined ? {} : { query }),
  });
}

function catalogFor(
  feature: ReturnType<typeof createRemoteFeature>,
  aggregate: boolean,
  meaning: MeaningDefinition,
  pagination: 'snapshot' | 'keyset',
): Catalog {
  const capability = {
    ref: { id: 'people.remote', revision: '1' },
    entity: feature.entity.id,
    operators: [{ id: 'eq', revision: '1' }],
    fields: feature.entity.fields.map((field) => field.id),
    relations: [],
    ...(aggregate ? { metrics: [{ id: meaning.id, revision: meaning.revision }] } : { metrics: [] }),
    pagination: {
      mode: pagination,
      stableOrder: [{ field: 'id', direction: 'asc' as const, nulls: 'last' as const }],
      identity: [...feature.entity.identity],
    },
    maxOutputRows: 10_000,
  };
  return { ...feature.catalog, capabilities: [capability] };
}

function validateCursor(
  cursor: string | undefined,
  query: QuerySpec,
  target: PlanRequest['target'],
  principal: RemotePrincipal,
  catalog: Catalog,
  options: RemotePeopleFixtureOptions,
  meaningRevision: string,
  mutation: RemoteMutationState,
  maximumOffset = Number.MAX_SAFE_INTEGER,
): Outcome<RemoteCursor | undefined> {
  const parsed = parseCursor(cursor);
  if (cursor !== undefined && parsed === undefined)
    return failed('data.stale-cursor', 'The cursor is malformed or uses an unsupported version.', [
      'query',
      'page',
      'cursor',
    ]);
  if (parsed === undefined) return { ok: true, value: undefined };
  const pagination = options.pagination ?? 'snapshot';
  if (parsed.mode === 'keyset' && pagination === 'snapshot')
    return failed(
      'data.unsupported.pagination',
      'Live keyset pagination is not declared by this snapshot source.',
      ['query', 'page', 'cursor'],
      ['Use the declared snapshot cursor and restart from the first page.'],
    );
  if (parsed.mode !== pagination)
    return failed(
      'data.stale-cursor',
      'The cursor does not belong to the declared pagination mode.',
      ['query', 'page', 'cursor'],
      ['Request the first page again using the declared pagination mode.'],
    );
  if (parsed.mode === 'keyset' && parsed.anchor === undefined)
    return failed('data.stale-cursor', 'The keyset cursor has no stable ordering anchor.', ['query', 'page', 'cursor']);
  const sourceRevision = sourceRevisionFor(principal, options, mutation);
  const semanticPinsMatch =
    parsed.catalogRevision === catalog.revision &&
    parsed.schemaRevision === schemaRevisionFor(options) &&
    parsed.meaningRevision === meaningRevision &&
    cursorSourcePinsMatch(parsed, sourceRevision, sourceLineageFor(options)) &&
    parsed.scopeDigest === principal.scopeDigest &&
    parsed.policyRevision === principal.policyRevision &&
    parsed.queryDigest === queryDigest(query) &&
    parsed.orderDigest === orderDigest(query) &&
    parsed.target === targetDigest(target);
  if (!proofMatches(parsed.proof, cursorProof(parsed, principal)) && semanticPinsMatch)
    return failed('data.stale-cursor', 'The cursor is malformed or uses an unsupported version.', [
      'query',
      'page',
      'cursor',
    ]);
  if (
    !proofMatches(parsed.proof, cursorProof(parsed, principal)) ||
    parsed.expiresAt <= Date.now() ||
    (parsed.mode === 'snapshot' && parsed.offset > maximumOffset) ||
    parsed.catalogRevision !== catalog.revision ||
    parsed.schemaRevision !== schemaRevisionFor(options) ||
    parsed.meaningRevision !== meaningRevision ||
    !cursorSourcePinsMatch(parsed, sourceRevision, sourceLineageFor(options)) ||
    parsed.scopeDigest !== principal.scopeDigest ||
    parsed.policyRevision !== principal.policyRevision ||
    parsed.queryDigest !== queryDigest(query) ||
    parsed.orderDigest !== orderDigest(query) ||
    parsed.target !== targetDigest(target)
  )
    return failed(
      'data.stale-cursor',
      'The cursor does not belong to the current principal, scope, source, query, order or output.',
      ['query', 'page', 'cursor'],
      ['Request the first page again for the current authorization and ordering.'],
    );
  return { ok: true, value: parsed };
}

function cursorSourcePinsMatch(cursor: RemoteCursor, sourceRevision: string, sourceLineage: string): boolean {
  if (cursor.sourceLineage !== sourceLineage) return false;
  if (cursor.mode === 'keyset') return true;
  return cursor.sourceRevision === sourceRevision && cursor.snapshotId === sourceRevision;
}

function fieldFor(feature: ReturnType<typeof createRemoteFeature>, id: string) {
  return feature.entity.fields.find((field) => field.id === id);
}

function supportFailure(
  query: QuerySpec,
  feature: ReturnType<typeof createRemoteFeature>,
  aggregate: boolean,
  pageSize: number,
  meaning: MeaningDefinition,
): Outcome<never> | undefined {
  if (query.entity !== feature.entity.id)
    return failed(
      'data.unsupported.relation',
      'Relation people is not available from this source.',
      ['query', 'entity'],
      ['Use the declared people relation.'],
    );
  for (const field of query.fields) {
    if (fieldFor(feature, field) === undefined)
      return failed(
        'data.unsupported.field',
        `Field ${field} is not declared by the remote source.`,
        ['query', 'fields'],
        ['Use id, name, or team.'],
      );
  }
  for (const field of query.groupBy) {
    if (fieldFor(feature, field) === undefined)
      return failed(
        'data.unsupported.field',
        `Field ${field} is not declared by the remote source.`,
        ['query', 'groupBy'],
        ['Group by id or team from the declared projection.'],
      );
  }
  for (const relation of query.relations) {
    return failed(
      'data.unsupported.relation',
      `Relation ${relation.id}@${relation.revision} is not supported.`,
      ['query', 'relations'],
      ['Remove the relation or use a declared source relationship.'],
    );
  }
  for (const usage of query.relationUsage ?? []) {
    return failed(
      'data.unsupported.relation',
      `Relation ${usage.relation.id}@${usage.relation.revision} is not supported.`,
      ['query', 'relationUsage'],
      ['Remove the relation usage or use a declared source relationship.'],
    );
  }
  if (query.where !== undefined && !predicateSupported(query.where))
    return failed(
      'data.unsupported.operator',
      'The requested predicate operator is not supported by this source.',
      ['query', 'where'],
      ['Use equality predicates on id or team.'],
    );
  if (
    query.order.length > 0 &&
    (query.order.length !== 1 ||
      query.order[0]?.field !== 'id' ||
      query.order[0].direction !== 'asc' ||
      query.order[0].nulls !== 'last')
  )
    return failed(
      'data.unsupported.ordering',
      'The requested ordering is not a declared stable order.',
      ['query', 'order'],
      ['Order by id ascending with nulls last.'],
    );
  if (query.page !== undefined && (query.page.size <= 0 || query.page.size > pageSize))
    return failed(
      'data.unsupported.pagination',
      'The requested page size is not supported.',
      ['query', 'page'],
      ['Use a positive bounded page size.'],
    );
  if (query.measures.length > 0) {
    if (!aggregate)
      return failed(
        'data.unsupported.metric',
        'The registered global count metric is not available for this source.',
        ['query', 'measures'],
        ['Use the page result, or bind a source that declares people.global-count@1.'],
      );
    if (
      query.measures.length !== 1 ||
      query.measures[0]?.id !== meaning.id ||
      query.measures[0]?.revision !== meaning.revision
    )
      return failed(
        'data.unsupported.metric',
        `Only ${meaning.id}@${meaning.revision} is declared by this source.`,
        ['query', 'measures'],
        [`Use ${meaning.id}@${meaning.revision}.`],
      );
  }
  if (query.groupBy.length > 0 && query.measures.length > 0)
    return failed(
      'data.unsupported.aggregation',
      'The requested aggregation shape is not supported.',
      ['query', 'groupBy'],
      ['Use the registered global count metric without a grouping dimension.'],
    );
  return undefined;
}

function predicateSupported(predicate: NonNullable<QuerySpec['where']>): boolean {
  const candidate = predicate as {
    readonly op?: string;
    readonly field?: string;
    readonly comparison?: string;
  };
  return (
    candidate.op === 'compare' &&
    candidate.comparison === 'eq' &&
    (candidate.field === 'id' || candidate.field === 'team')
  );
}

function matchesPredicate(row: Person, predicate: NonNullable<QuerySpec['where']> | undefined): boolean {
  if (predicate === undefined) return true;
  const candidate = predicate as {
    readonly op?: string;
    readonly field?: string;
    readonly comparison?: string;
    readonly value?: unknown;
  };
  if (candidate.op !== 'compare' || candidate.comparison !== 'eq') return false;
  if (candidate.field !== 'id' && candidate.field !== 'team') return false;
  return row[candidate.field] === candidate.value;
}

function projectPerson(row: Person, fields: readonly string[]): DataRecord {
  const projected: Record<string, DataValue> = {};
  const source = row as unknown as Record<string, DataValue>;
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined) projected[field] = value;
  }
  return Object.freeze(projected);
}

function pageRows(
  principal: RemotePrincipal,
  logicalRows: number,
  where: QuerySpec['where'] | undefined,
  fields: readonly string[],
  offset: number,
  size: number,
  mutation: RemoteMutationState,
  mode: 'snapshot' | 'keyset',
  anchor: string | undefined,
): {
  readonly rows: readonly DataRecord[];
  readonly nextOffset: number;
  readonly hasMore: boolean;
  readonly lastAnchor?: string;
} {
  const rows: DataRecord[] = [];
  let lastAnchor: string | undefined;
  const rowCount = logicalRows + (mutation.leadingInserted ? 1 : 0);
  let index = mode === 'keyset' ? 0 : offset;
  while (index < rowCount && rows.length < size) {
    const person = currentPersonAt(principal, index, mutation);
    if ((anchor === undefined || person.id > anchor) && matchesPredicate(person, where)) {
      rows.push(projectPerson(person, fields));
      lastAnchor = person.id;
    }
    index += 1;
  }
  let hasMore = false;
  for (; index < rowCount; index += 1) {
    const person = currentPersonAt(principal, index, mutation);
    if ((anchor === undefined || person.id > anchor) && matchesPredicate(person, where)) {
      hasMore = true;
      break;
    }
  }
  return {
    rows: Object.freeze(rows),
    nextOffset: index,
    hasMore,
    ...(lastAnchor === undefined ? {} : { lastAnchor }),
  };
}

function aggregateCount(
  principal: RemotePrincipal,
  logicalRows: number,
  where: QuerySpec['where'] | undefined,
  mutation: RemoteMutationState,
): number {
  const rowCount = logicalRows + (mutation.leadingInserted ? 1 : 0);
  let count = 0;
  for (let index = 0; index < rowCount; index += 1) {
    if (matchesPredicate(currentPersonAt(principal, index, mutation), where)) count += 1;
  }
  return count;
}

function personAt(principal: RemotePrincipal, index: number): Person {
  const id = `${principal.tenant}-person-${String(index + 1).padStart(7, '0')}`;
  return { id, name: `Person ${index + 1}`, team: index % 2 === 0 ? 'Design' : 'Engineering' };
}

function currentPersonAt(principal: RemotePrincipal, index: number, mutation: RemoteMutationState): Person {
  if (mutation.leadingInserted && index === 0)
    return { id: `${principal.tenant}-person-0000000`, name: 'Person 0', team: 'Design' };
  return personAt(principal, mutation.leadingInserted ? index - 1 : index);
}

function insertLeadingRow(mutation: RemoteMutationState): void {
  if (mutation.leadingInserted) return;
  mutation.leadingInserted = true;
  mutation.sourceRevisionEpoch += 1;
}

function resultFields(
  feature: ReturnType<typeof createRemoteFeature>,
  query: QuerySpec,
  aggregate: boolean,
  meaning: MeaningDefinition,
) {
  const selected = query.fields
    .map((id) => fieldFor(feature, id))
    .filter((field): field is NonNullable<typeof field> => field !== undefined);
  if (!aggregate || query.measures.length === 0) return selected;
  return [
    ...selected,
    {
      id: meaning.id,
      label: meaning.label,
      type: meaning.output,
      role: 'measure' as const,
      derivation: { id: meaning.id, revision: meaning.revision },
    },
  ];
}

function projectedIdentity(feature: ReturnType<typeof createRemoteFeature>, query: QuerySpec): readonly string[] {
  return feature.entity.identity.every((field) => query.fields.includes(field)) ? feature.entity.identity : [];
}

function projectedRowGrain(feature: ReturnType<typeof createRemoteFeature>, query: QuerySpec): readonly string[] {
  return feature.entity.rowGrain.every((field) => query.fields.includes(field)) ? feature.entity.rowGrain : [];
}

function descriptor(
  accepted: AcceptedQuery,
  feature: ReturnType<typeof createRemoteFeature>,
  principal: RemotePrincipal,
  options: RemotePeopleFixtureOptions,
  sourceRevision: string,
  loaded: number,
  aggregate: boolean,
  meaning: MeaningDefinition,
  aggregatePopulation: number | undefined,
): Extract<ResultEvent, { kind: 'descriptor' }> {
  const fields = resultFields(feature, accepted.query, aggregate, meaning);
  const aggregateResult = aggregate && accepted.query.measures.length > 0;
  const population = aggregateResult
    ? { kind: 'exact' as const, value: aggregatePopulation ?? 0, populationDigest: accepted.populationDigest }
    : options.estimatedPopulation === true
      ? {
          kind: 'estimated' as const,
          value: options.logicalRows,
          populationDigest: accepted.populationDigest,
          method: 'synthetic bounded estimate',
          uncertainty: {
            kind: 'quantified' as const,
            lower: Math.max(0, options.logicalRows - 10),
            upper: options.logicalRows + 10,
            interpretation: 'Synthetic fixture interval',
          },
        }
      : { kind: 'unknown' as const };
  const coverage = aggregateResult
    ? { kind: 'complete' as const, populationDigest: accepted.populationDigest }
    : { kind: 'partial' as const, populationDigest: accepted.populationDigest, reason: 'windowed page' };
  return {
    kind: 'descriptor',
    descriptor: {
      version: '1',
      ref: {
        id: digest({ requestId: accepted.requestId, query: accepted.queryDigest }),
        revision: sourceRevision,
        sourceLineage: accepted.sourceLineage,
        outputId: accepted.target.outputId,
        queryDigest: accepted.queryDigest,
        scopeDigest: accepted.scopeDigest,
      },
      taskId: accepted.target.taskId,
      fields,
      identity: aggregateResult ? [] : projectedIdentity(feature, accepted.query),
      rowGrain: aggregateResult ? [] : projectedRowGrain(feature, accepted.query),
      counts: { loaded, population },
      precision: { kind: 'exact' },
      coverage,
      consistency: {
        ...(options.pagination === 'keyset'
          ? {
              kind: 'mixed' as const,
              sourceLineage: accepted.sourceLineage,
              sourceRevisions: { people: sourceRevision },
              reason: 'Live keyset data may advance between pages',
            }
          : { kind: 'snapshot' as const, snapshotId: sourceRevision, sourceRevisions: { people: sourceRevision } }),
      },
      evidence: aggregateResult
        ? { kind: 'computed', queryDigest: accepted.queryDigest, definitions: accepted.query.measures }
        : { kind: 'observed', source: { id: 'people', revision: sourceRevision } },
      filters: accepted.query.where === undefined ? [] : [accepted.query.where],
      warnings: [],
      lineageDigest: accepted.lineageDigest,
      lineage: [],
    },
  };
}

function descriptorSourceRevision(consistency: RemoteDescriptor['consistency']): string | undefined {
  if (consistency.kind === 'snapshot') return consistency.snapshotId;
  if (consistency.kind === 'mixed') return consistency.sourceRevisions.people;
  return undefined;
}

interface StoredRemotePlan {
  readonly acceptance: PlanAcceptance;
  readonly principalPartition: string;
}

function rememberRemotePlan(
  plans: Map<string, StoredRemotePlan>,
  acceptance: PlanAcceptance,
  principalPartition: string,
): void {
  while (plans.size >= 256) {
    const oldest = plans.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    plans.delete(oldest);
  }
  plans.set(acceptance.planDigest, { acceptance, principalPartition });
}

function remotePlanError(request: AcceptedQuery, code: string, message: string): ResultEvent {
  return { kind: 'error', requestId: request.requestId, error: { code, message, retryable: false } };
}

function acceptedEnvelope(value: PlanAcceptance | AcceptedQuery): AcceptedQuery {
  const { kind: _kind, supported: _supported, ...accepted } = value as PlanAcceptance;
  return accepted;
}

function remoteService(
  feature: ReturnType<typeof createRemoteFeature>,
  options: RemotePeopleFixtureOptions,
  observations: RemoteRequestObservation[],
  cancellations: string[],
  lateDescriptors: RemoteDescriptor[],
  meaning: MeaningDefinition,
  mutation: RemoteMutationState,
): DataService {
  const catalog = catalogFor(feature, options.aggregate, meaning, options.pagination ?? 'snapshot');
  const plans = new Map<string, StoredRemotePlan>();
  return {
    async describe(request: CatalogRequest, context: ReadContext = {}): Promise<Outcome<CatalogPage>> {
      const principal = principalFrom(context);
      observe(observations, 'describe', principal);
      if (principal === undefined) return failed('data.denied', 'The authenticated principal is not recognized.');
      const sourceRevision = sourceRevisionFor(principal, options, mutation);
      if (request.catalogRevision !== null && request.catalogRevision !== catalog.revision)
        return failed('data.stale-catalog', 'The requested catalog revision is no longer current.');
      const cursor = validateCursor(
        request.cursor,
        {
          entity: feature.entity.id,
          fields: feature.entity.fields.map((field) => field.id),
          measures: [],
          relations: [],
          groupBy: [],
          population: { kind: 'all-authorized' },
          order: [],
        },
        { taskId: 'catalog', outputId: 'catalog' },
        principal,
        catalog,
        options,
        meaning.revision,
        mutation,
      );
      if (!cursor.ok) return cursor;
      return {
        ok: true,
        value: {
          version: '1',
          requestId: request.requestId,
          catalog,
          catalogRevision: catalog.revision,
          sourceRevision,
          scopeDigest: principal.scopeDigest,
          target: request.target,
          effectiveBudget: request.budget,
        },
      };
    },
    async plan(request: PlanRequest, context: ReadContext = {}): Promise<Outcome<PlanAcceptance>> {
      const principal = principalFrom(context);
      observe(observations, 'plan', principal, request.query);
      if (principal === undefined) return failed('data.denied', 'The authenticated principal is not recognized.');
      if (request.catalogRevision !== catalog.revision)
        return failed('data.stale-catalog', 'The plan must pin the current catalog revision.');
      const unsupported = supportFailure(request.query, feature, options.aggregate, options.pageSize, meaning);
      if (unsupported !== undefined) return unsupported;
      const checkedCursor = validateCursor(
        request.query.page?.cursor,
        request.query,
        request.target,
        principal,
        catalog,
        options,
        meaning.revision,
        mutation,
        options.logicalRows,
      );
      if (!checkedCursor.ok) return checkedCursor;
      const sourceRevision = sourceRevisionFor(principal, options, mutation);
      const requestQueryDigest = queryDigest(request.query);
      const acceptedBase: AcceptedQuery = {
        version: '1',
        requestId: request.requestId,
        target: request.target,
        catalogRevision: catalog.revision,
        sourceRevision,
        sourceLineage: sourceLineageFor(options),
        scopeDigest: principal.scopeDigest,
        queryDigest: requestQueryDigest,
        planDigest: '',
        populationDigest: digest({
          principal: principal.key,
          scope: principal.scopeDigest,
          source: sourceRevision,
          schema: feature.definitionRevision,
          meaning: meaning.revision,
          population: populationIdentity(request.query),
        }),
        lineageDigest: lineageDigest(request.target.outputId, []),
        resultShape: options.aggregate && request.query.measures.length > 0 ? 'global-aggregate' : 'rows',
        expiresAt: Date.now() + cursorTtl(options),
        functionRegistryDigest: catalog.functionRegistryDigest,
        policyRevision: principal.policyRevision,
        query: request.query,
        effectiveBudget: request.budget,
      };
      const supported = Object.freeze([
        'projection',
        ...(request.query.where === undefined ? [] : ['predicates']),
        ...(request.query.order.length === 0 ? [] : ['order']),
        ...(request.query.page === undefined ? [] : ['paging']),
        ...(request.query.measures.length > 0 ? ['aggregation'] : []),
      ]);
      const planDigest = digest({ accepted: { ...acceptedBase, supported }, principalPartition: principal.partition });
      const acceptance: PlanAcceptance = Object.freeze({
        ...acceptedBase,
        planDigest,
        kind: 'accepted',
        supported,
      });
      rememberRemotePlan(plans, acceptance, principal.partition);
      return {
        ok: true,
        value: acceptance,
      };
    },
    async *execute(request: AcceptedQuery, context: ReadContext = {}): AsyncGenerator<ResultEvent> {
      const principal = principalFrom(context);
      observe(observations, 'execute', principal, request.query);
      if (principal === undefined) {
        yield {
          kind: 'error',
          requestId: request.requestId,
          error: { code: 'data.denied', message: 'The authenticated principal is not recognized.', retryable: false },
        };
        return;
      }
      const storedPlan = plans.get(request.planDigest);
      if (storedPlan === undefined || canonical(acceptedEnvelope(storedPlan.acceptance)) !== canonical(request)) {
        yield remotePlanError(request, 'data.denied', 'The accepted plan envelope is not the server-issued plan.');
        return;
      }
      if (Date.now() >= storedPlan.acceptance.expiresAt) {
        yield remotePlanError(request, 'data.expired-plan', 'The server-issued plan acceptance has expired.');
        return;
      }
      if (storedPlan.principalPartition !== principal.partition) {
        yield remotePlanError(request, 'data.denied', 'The accepted plan is bound to a different principal.');
        return;
      }
      const sourceRevision = sourceRevisionFor(principal, options, mutation);
      const requestedCursor = parseCursor(request.query.page?.cursor);
      const liveKeysetContinuation = requestedCursor?.mode === 'keyset' && options.pagination === 'keyset';
      if (
        request.scopeDigest !== principal.scopeDigest ||
        request.policyRevision !== principal.policyRevision ||
        request.sourceLineage !== sourceLineageFor(options) ||
        (!liveKeysetContinuation && request.sourceRevision !== sourceRevision) ||
        request.catalogRevision !== catalog.revision ||
        request.planDigest !== storedPlan.acceptance.planDigest
      ) {
        yield remotePlanError(request, 'data.denied', 'The accepted plan is not authorized for this principal.');
        return;
      }
      const unsupported = supportFailure(request.query, feature, options.aggregate, options.pageSize, meaning);
      if (unsupported !== undefined) {
        if (unsupported.ok) throw new TypeError('Unexpected successful unsupported capability outcome.');
        yield { kind: 'error', requestId: request.requestId, error: unsupported.diagnostics[0]! };
        return;
      }
      const checkedCursor = validateCursor(
        request.query.page?.cursor,
        request.query,
        request.target,
        principal,
        catalog,
        options,
        meaning.revision,
        mutation,
        options.logicalRows,
      );
      if (!checkedCursor.ok) {
        yield { kind: 'error', requestId: request.requestId, error: checkedCursor.diagnostics[0]! };
        return;
      }
      try {
        if (options.executionGate !== undefined) {
          options.executionGate.started();
          await options.executionGate.release;
        }
        await waitForCancellation(options.executionGate === undefined ? context.signal : undefined, 20);
        const mode = options.pagination ?? 'snapshot';
        if (options.mutateDuringExecution === true) insertLeadingRow(mutation);
        const materializedSourceRevision = sourceRevisionFor(principal, options, mutation);
        if (mode === 'snapshot' && materializedSourceRevision !== sourceRevision) {
          yield remotePlanError(
            request,
            'data.stale-source',
            'The snapshot source changed before the accepted page could be materialized.',
          );
          return;
        }
        const publishedSourceRevision = mode === 'keyset' ? materializedSourceRevision : sourceRevision;
        const aggregateResult = options.aggregate && request.query.measures.length > 0;
        const offset = checkedCursor.value?.offset ?? 0;
        const anchor = checkedCursor.value?.anchor?.[0];
        const size = aggregateResult ? 1 : Math.min(request.query.page?.size ?? options.pageSize, options.pageSize);
        const aggregatePopulation = aggregateResult
          ? aggregateCount(principal, options.logicalRows, request.query.where, mutation)
          : undefined;
        const window = aggregateResult
          ? {
              rows: Object.freeze([{ [meaning.id]: aggregatePopulation ?? 0 } satisfies DataRecord]),
              nextOffset: 0,
              hasMore: false,
              lastAnchor: undefined,
            }
          : pageRows(
              principal,
              options.logicalRows,
              request.query.where,
              request.query.fields,
              offset,
              size,
              mutation,
              mode,
              anchor,
            );
        const rows = window.rows;
        const first = descriptor(
          request,
          feature,
          principal,
          options,
          publishedSourceRevision,
          rows.length,
          options.aggregate,
          meaning,
          aggregatePopulation,
        );
        if (options.executionGate?.wasCancelled()) lateDescriptors.push(first.descriptor);
        yield first;
        await waitForCancellation(
          options.executionGate === undefined ? context.signal : undefined,
          options.waitForCancellationAfterDescriptor === true ? undefined : 50,
        );
        if (rows.length > 0) yield { kind: 'batch', result: first.descriptor.ref, sequence: 0, rows };
        const next =
          !aggregateResult && window.hasMore
            ? cursorText(
                {
                  version: 1,
                  mode,
                  catalogRevision: catalog.revision,
                  schemaRevision: feature.definitionRevision,
                  meaningRevision: meaning.revision,
                  sourceRevision: publishedSourceRevision,
                  sourceLineage: sourceLineageFor(options),
                  snapshotId: publishedSourceRevision,
                  scopeDigest: principal.scopeDigest,
                  policyRevision: principal.policyRevision,
                  queryDigest: request.queryDigest,
                  orderDigest: orderDigest(request.query),
                  target: targetDigest(request.target),
                  offset: window.nextOffset,
                  ...(mode === 'keyset' && window.lastAnchor === undefined
                    ? {}
                    : mode === 'keyset'
                      ? { anchor: [window.lastAnchor] as [string] }
                      : {}),
                  expiresAt: Date.now() + cursorTtl(options),
                  proof: '',
                },
                principal,
              )
            : undefined;
        if (options.leadingInsertOnContinuation === true && next !== undefined) insertLeadingRow(mutation);
        yield {
          kind: 'complete',
          result: first.descriptor.ref,
          finalCoverage: first.descriptor.coverage,
          ...(next === undefined ? {} : { cursor: next }),
        };
      } catch (error) {
        if (context.signal?.aborted) cancellations.push(request.requestId);
        throw error;
      } finally {
        if (context.signal?.aborted && !cancellations.includes(request.requestId))
          cancellations.push(request.requestId);
      }
    },
  };
}

async function waitForCancellation(signal: AbortSignal | undefined, milliseconds: number | undefined): Promise<void> {
  if (signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
  if (milliseconds !== undefined && milliseconds <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = milliseconds === undefined ? undefined : setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('The request was cancelled.', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function listen(handler: DataHttpHandler): Promise<{
  readonly origin: string;
  readonly dispose: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    void dispatchNodeRequest(handler, request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new TypeError('The remote fixture did not receive a port.');
  let closed = false;
  let closing: Promise<void> | undefined;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    dispose: () => {
      if (closed) return Promise.resolve();
      if (closing !== undefined) return closing;
      closing = new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error !== undefined && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            reject(error);
            return;
          }
          closed = true;
          resolve();
        }),
      );
      return closing;
    },
  };
}

async function dispatchNodeRequest(
  handler: DataHttpHandler,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const controller = new AbortController();
  let responseFinished = false;
  request.once('aborted', () => controller.abort());
  response.once('close', () => {
    if (!responseFinished) controller.abort();
  });
  try {
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : (Readable.toWeb(request) as unknown as ReadableStream<Uint8Array>);
    const incoming = new Request(`http://${request.headers.host}${request.url ?? '/'}`, {
      method: request.method ?? 'GET',
      headers: request.headers as Record<string, string>,
      ...(body === undefined ? {} : { body, duplex: 'half' as const }),
      signal: controller.signal,
    });
    const result = await handler(incoming);
    response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
    if (result.body !== null) {
      for await (const chunk of Readable.fromWeb(result.body as unknown as Parameters<typeof Readable.fromWeb>[0])) {
        if (!response.write(chunk)) await once(response, 'drain');
      }
    }
    responseFinished = true;
    response.end();
  } catch {
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
    response.end();
  }
}

function principalHeader(principal: 'tenant-a' | 'tenant-b'): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${principal}` };
}

export async function createRemotePeopleFixture(options: RemotePeopleFixtureOptions): Promise<RemotePeopleFixture> {
  if (!Number.isSafeInteger(options.logicalRows) || options.logicalRows < 1)
    throw new TypeError('logicalRows must be positive.');
  if (!Number.isSafeInteger(options.pageSize) || options.pageSize < 1)
    throw new TypeError('pageSize must be positive.');
  cursorTtl(options);
  const meaning = countMeaningFor(options.meaningRevision ?? countMeaning.revision);
  const feature = createRemoteFeature(options.aggregate, schemaRevisionFor(options), meaning);
  const observations: RemoteRequestObservation[] = [];
  const cancellations: string[] = [];
  const lateDescriptors: RemoteDescriptor[] = [];
  const resultStoreBegins: RemoteResultStoreBeginObservation[] = [];
  const authorityReads: string[] = [];
  const sharedScopeDigest = options.sameAuthorityLabels === true ? 'remote-scope-shared' : undefined;
  const policyRevision = options.policyRevision ?? 'remote-policy-1';
  const mutation: RemoteMutationState = { leadingInserted: false, sourceRevisionEpoch: 0 };
  const principals = new Map<string, RemotePrincipal>([
    [
      'Bearer tenant-a',
      {
        key: 'tenant-a',
        tenant: 'tenant-a',
        partition: 'remote-principal-partition-a-v1',
        scopeDigest: sharedScopeDigest ?? 'remote-scope-tenant-a',
        policyRevision,
      },
    ],
    [
      'Bearer tenant-b',
      {
        key: 'tenant-b',
        tenant: 'tenant-b',
        partition: 'remote-principal-partition-b-v1',
        scopeDigest: sharedScopeDigest ?? 'remote-scope-tenant-b',
        policyRevision,
      },
    ],
  ]);
  const service = remoteService(feature, options, observations, cancellations, lateDescriptors, meaning, mutation);
  const handler = createDataHttpHandler({
    service,
    authenticate: (request) => {
      const principal = principals.get(request.headers.get('authorization') ?? '');
      return principal === undefined
        ? failed('data.authorization', 'The test principal is not authenticated.')
        : { ok: true, value: { principal } };
    },
    allowedOrigin: 'http://localhost.test',
    maxRequestBytes: 100_000,
    maxRequestMilliseconds: 30_000,
  });
  const listening = await listen(handler);
  const clients = new Map(
    (['tenant-a', 'tenant-b'] as const).map(
      (principal) =>
        [principal, createHttpDataService({ baseUrl: listening.origin, headers: principalHeader(principal) })] as const,
    ),
  );
  const client = clients.get('tenant-a')!;
  const underlyingResultStore = createResultStore();
  const resultStore: ResultStore = {
    begin(input) {
      const handle = underlyingResultStore.begin(input);
      resultStoreBegins.push(Object.freeze({ ...input, generation: handle.generation }));
      return handle;
    },
    get: (input) => underlyingResultStore.get(input),
    revoke: (input) => underlyingResultStore.revoke(input),
    dispose: () => underlyingResultStore.dispose(),
  };
  const principalContext = (key: 'tenant-a' | 'tenant-b'): RemotePrincipal => {
    const value = principals.get(`Bearer ${key}`);
    if (value === undefined) throw new TypeError(`Unknown fixture principal ${key}.`);
    return value;
  };
  const rootPrincipal = principalContext('tenant-a');
  const runtime = createVarendoRuntime({
    runtimeId: 'remote-runtime',
    resources: [{ resource: feature.resource, data: client }],
    resultStore,
    authority: {
      read: () => {
        return {
          ok: true,
          value: {
            principalKey: rootPrincipal.key,
            scopeDigest: rootPrincipal.scopeDigest,
            policyRevision: rootPrincipal.policyRevision,
            experienceRevision: 'remote-experience-1',
            grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
            readContext: { principal: rootPrincipal },
          },
        };
      },
    },
  });
  const scope = runtime.createLocalSurfaceScope({
    id: sharedScopeDigest ?? 'remote-scope-tenant-a',
    allowedFeatures: ['people'],
  });
  const bindings: DataSurfaceBindings<RemotePeopleState> = {
    initialState: Object.freeze({ rows: Object.freeze([]) }),
    source: {
      kind: 'data-service',
      service: client,
      coverage: {
        fields: ['id', 'name', 'team'],
        relations: [],
        metrics: options.aggregate ? [{ id: meaning.id, revision: meaning.revision }] : [],
        operators: ['eq'],
        pagination: options.pagination ?? 'snapshot',
        stableOrder: [{ field: 'id', direction: 'asc', nulls: 'last' }],
        stableOrderIdentity: ['id'],
        sorting: 'stable-fields-only',
        aggregation: options.aggregate ? 'registered-only' : 'unsupported',
        streaming: 'finite',
        updates: options.pagination === 'keyset' ? 'live' : 'snapshot-replace',
        unsupported:
          options.pagination === 'keyset'
            ? options.aggregate
              ? ['streaming']
              : ['aggregation', 'streaming']
            : options.aggregate
              ? ['streaming', 'live-updates']
              : ['aggregation', 'streaming', 'live-updates'],
      },
      normalize: async (events) => {
        const rows: Person[] = [];
        let count: number | undefined;
        let loaded: number | undefined;
        let cursor: string | undefined;
        let coverage: Result['coverage'] | undefined;
        let population: Result['counts']['population'] | undefined;
        for await (const event of events) {
          if (event.kind === 'descriptor') {
            coverage = event.descriptor.coverage;
            population = event.descriptor.counts.population;
            loaded = event.descriptor.counts.loaded;
          }
          if (event.kind === 'complete') cursor = event.cursor;
          if (event.kind === 'error') throw new TypeError(event.error.message);
          if (event.kind !== 'batch') continue;
          for (const row of event.rows) {
            if (typeof row[meaning.id] === 'number') count = row[meaning.id] as number;
            const parsed = feature.parseRecord(row);
            if (parsed.ok) rows.push(parsed.value);
          }
        }
        return Object.freeze({
          rows: Object.freeze(rows),
          ...(loaded === undefined ? {} : { loaded }),
          ...(count === undefined ? {} : { count }),
          ...(cursor === undefined ? {} : { cursor }),
          ...(coverage === undefined ? {} : { coverage }),
          ...(population === undefined ? {} : { population }),
        });
      },
    },
  };
  const surface = runtime.createSurface({ scope, id: 'remote-people', feature, bindings });
  let principalSurfaceSequence = 0;
  const createPrincipalSurface = (principalKey: 'tenant-a' | 'tenant-b'): RemotePrincipalSurface => {
    const principal = principalContext(principalKey);
    const fixedClient = clients.get(principalKey)!;
    const sequence = ++principalSurfaceSequence;
    const childRuntime = createVarendoRuntime({
      runtimeId: `remote-runtime-${principalKey}-${sequence}`,
      resources: [{ resource: feature.resource, data: fixedClient }],
      resultStore,
      authority: {
        read: () => {
          authorityReads.push(principal.key);
          return {
            ok: true,
            value: {
              principalKey: principal.key,
              scopeDigest: principal.scopeDigest,
              policyRevision: principal.policyRevision,
              experienceRevision: 'remote-experience-1',
              grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
              readContext: { principal },
            },
          };
        },
      },
    });
    const childScope = childRuntime.createLocalSurfaceScope({
      id: `remote-scope-${principalKey}-${sequence}`,
      allowedFeatures: ['people'],
    });
    const childBindings: DataSurfaceBindings<RemotePeopleState> = {
      ...bindings,
      source: { ...bindings.source, service: fixedClient },
    };
    const childSurface = childRuntime.createSurface({
      scope: childScope,
      id: `remote-people-${principalKey}-${sequence}`,
      feature,
      bindings: childBindings,
    });
    return {
      runtime: childRuntime,
      scope: childScope,
      surface: childSurface,
      dispose: () => {
        childSurface.dispose();
        childScope.dispose();
        childRuntime.dispose();
      },
    };
  };
  const globalCountIntent: Intent = {
    version: '1',
    id: 'remote-global-count',
    resource: feature.id,
    kind: 'analyze',
    dimensions: [],
    measures: [{ id: meaning.id, revision: meaning.revision }],
  };
  const requestPage = async (
    input: {
      readonly principal?: 'tenant-a' | 'tenant-b';
      readonly cursor?: string;
      readonly order?: QuerySpec['order'];
      readonly fields?: readonly string[];
      readonly where?: QuerySpec['where'];
      readonly target?: PlanRequest['target'];
    } = {},
  ): Promise<RemotePageState> => {
    const activeClient =
      input.principal === undefined || input.principal === 'tenant-a' ? client : clients.get(input.principal)!;
    const requestId = `remote-page-${Date.now()}`;
    const query: QuerySpec = {
      entity: feature.entity.id,
      fields: input.fields === undefined ? ['id', 'name', 'team'] : input.fields,
      measures: [],
      relations: [],
      groupBy: [],
      population: { kind: 'all-authorized' },
      ...(input.where === undefined ? {} : { where: input.where }),
      page: {
        size: options.pageSize,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      },
      order: input.order ?? [{ field: 'id', direction: 'asc', nulls: 'last' }],
    };
    const planned = await activeClient.plan({
      version: '1',
      requestId,
      catalogRevision: feature.catalog.revision,
      target: input.target ?? { taskId: 'remote-page-task', outputId: 'primary' },
      query,
      budget: BUDGET,
    });
    if (!planned.ok) throw new TypeError(planned.diagnostics[0].message);
    const rows: DataRecord[] = [];
    let nextCursor: string | undefined;
    let loaded: number | undefined;
    let coverage: Result['coverage'] | undefined;
    let population: Result['counts']['population'] | undefined;
    let sourceRevision: string | undefined;
    let identity: readonly string[] | undefined;
    let rowGrain: readonly string[] | undefined;
    let consistency: RemoteDescriptor['consistency'] | undefined;
    for await (const event of activeClient.execute(planned.value, {})) {
      if (event.kind === 'descriptor') {
        loaded = event.descriptor.counts.loaded;
        coverage = event.descriptor.coverage;
        population = event.descriptor.counts.population;
        identity = event.descriptor.identity;
        rowGrain = event.descriptor.rowGrain;
        consistency = event.descriptor.consistency;
        sourceRevision = descriptorSourceRevision(event.descriptor.consistency);
      } else if (event.kind === 'batch') {
        rows.push(...event.rows);
      } else if (event.kind === 'complete') nextCursor = event.cursor;
      else if (event.kind === 'error') throw new TypeError(event.error.message);
    }
    return Object.freeze({
      rows: Object.freeze(rows),
      ...(loaded === undefined ? {} : { loaded }),
      ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
      ...(coverage === undefined ? {} : { coverage }),
      ...(population === undefined ? {} : { population }),
      ...(sourceRevision === undefined ? {} : { sourceRevision }),
      ...(identity === undefined ? {} : { identity }),
      ...(rowGrain === undefined ? {} : { rowGrain }),
      ...(consistency === undefined ? {} : { consistency }),
    });
  };
  const server = {
    origin: listening.origin,
    get observedRequests() {
      return Object.freeze(observations.slice());
    },
    get cancelledRequests() {
      return Object.freeze(cancellations.slice());
    },
    get lateDescriptors() {
      return Object.freeze(lateDescriptors.slice());
    },
    get resultStoreBegins() {
      return Object.freeze(resultStoreBegins.slice());
    },
    get authorityReads() {
      return Object.freeze(authorityReads.slice());
    },
    insertLeadingRow: () => insertLeadingRow(mutation),
    dispose: listening.dispose,
  };
  const dispose = async (): Promise<void> => {
    runtime.dispose();
    scope.dispose();
    await listening.dispose();
  };
  return {
    runtime,
    scope,
    surface,
    globalCountIntent,
    client,
    feature,
    server,
    get resultStoreBegins() {
      return Object.freeze(resultStoreBegins.slice());
    },
    get authorityReads() {
      return Object.freeze(authorityReads.slice());
    },
    createPrincipalSurface,
    requestPage,
    dispose,
  };
}
