import {
  parseWireValue,
  type Intent,
  type Outcome,
  type ReadonlyJsonValue,
  type ResourceDefinition,
} from '@varendo/core';
import type { FunctionRegistry } from '@varendo/core/expressions';
import {
  ActionRegistry,
  createActionPort,
  type ActionPayload,
  type ActionRegistration,
  type ActionSchema,
} from '@varendo/runtime/actions';
import { createLocalDataService, type DataRecord, type DataValue, type LocalDataService } from '@varendo/runtime/data';
import type { AeliqoFormState } from '@varendo/web/app';
import { PLAYGROUND_RECORDS, PLAYGROUND_RESOURCES } from './scenarios.js';
import { failure, isRecord } from './guards.js';

type Records = Record<string, DataRecord[]>;
type Services = Map<string, LocalDataService>;
type PlaygroundResource = (typeof PLAYGROUND_RESOURCES)[keyof typeof PLAYGROUND_RESOURCES];
interface PlaygroundDataState {
  readonly records: Records;
  readonly revisions: Map<string, string>;
  readonly services: Services;
  currentRevision(): number;
  nextSourceRevision(): number;
}

function isJsonValue(value: unknown): value is ReadonlyJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return value !== null && typeof value === 'object' && Object.values(value).every(isJsonValue);
}

function isActionPayload(value: unknown): value is ActionPayload {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isDataValue(value: unknown): value is DataValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    Object.hasOwn(value, 'decimal') &&
    typeof value.decimal === 'string'
  );
}

function isDataRecord(value: unknown): value is DataRecord {
  return isRecord(value) && Object.values(value).every(isDataValue);
}

function cloneRecords(): Records {
  const result: Records = {};
  for (const [resource, rows] of Object.entries(PLAYGROUND_RECORDS)) {
    result[resource] = rows.map((row) => {
      const cloned: unknown = structuredClone(row);
      if (!isDataRecord(cloned))
        throw new TypeError(`Playground fixture ${resource} must contain scalar data records.`);
      return cloned;
    });
  }
  return result;
}

function outputSchema(id: string): ActionSchema {
  return {
    ref: { id: `${id}.output`, revision: '1' },
    parse(input) {
      const parsed = parseWireValue(input);
      if (!parsed.ok || !isActionPayload(parsed.value) || parsed.value.saved !== true)
        return failure('playground.action-output', 'The local action returned an invalid output.');
      return { ok: true, value: parsed.value };
    },
  };
}

function inputSchema(id: string, resource: ResourceDefinition): ActionSchema<DataRecord> {
  return {
    ref: { id: `${id}.input`, revision: '1' },
    parse(input) {
      const parsed = resource.parseRecord(input);
      if (!parsed.ok) return parsed;
      return isDataRecord(parsed.value)
        ? { ok: true, value: parsed.value }
        : failure('playground.action-input', 'The local data adapter accepts scalar records only.');
    },
  };
}

function recordKey(value: DataRecord): string {
  return JSON.stringify({ id: value.id });
}

function createLocalDataServices(
  resources: readonly PlaygroundResource[],
  records: Records,
  functionRegistry: FunctionRegistry,
  currentRevision: () => number,
): Services {
  const services: Services = new Map();
  for (const resource of resources) {
    services.set(
      resource.id,
      createLocalDataService({
        snapshot: {
          catalog: resource.catalog,
          sourceRevision: `demo-${currentRevision()}`,
          records: { [resource.entity.id]: records[resource.id] ?? [] },
        },
        functionRegistry,
        sourceLimits: { rows: 1_000, bytes: 1_000_000 },
        authorize: ({ context }) => {
          if (context.principal === 'public-demo')
            return { ok: true, value: { scopeDigest: 'synthetic-local', policyRevision: 'policy-1' } };
          return failure('playground.denied', 'The synthetic session principal is unavailable.');
        },
      }),
    );
  }
  return services;
}

function rejectedAction(code: string, message: string) {
  return { state: 'rejected' as const, diagnostics: [{ code, message, retryable: false }] as const };
}

function dispatchPlaygroundAction(
  input: DataRecord,
  resource: ResourceDefinition,
  mode: 'create' | 'update',
  state: {
    readonly records: Records;
    readonly revisions: Map<string, string>;
    readonly services: Services;
    nextSourceRevision(): number;
  },
) {
  const rows = state.records[resource.id];
  if (rows === undefined) return rejectedAction('playground.resource', 'The local resource is unavailable.');
  const key = recordKey(input);
  const index = rows.findIndex((row) => recordKey(row) === key);
  if (mode === 'create' && index >= 0) return rejectedAction('playground.duplicate', 'That ID already exists.');
  if (mode === 'update' && index < 0) return rejectedAction('playground.missing', 'The record no longer exists.');
  const next = structuredClone(input);
  if (mode === 'create') rows.push(next);
  else rows[index] = next;
  const revision = String(Number(state.revisions.get(key) ?? '0') + 1);
  state.revisions.set(key, revision);
  const service = state.services.get(resource.id)!;
  const replaced = service.replaceSnapshot({
    catalog: resource.catalog,
    sourceRevision: `demo-${state.nextSourceRevision()}`,
    records: { [resource.entity.id]: rows },
  });
  if (!replaced.ok) return { state: 'rejected' as const, diagnostics: replaced.diagnostics };
  return { state: 'completed' as const, output: { saved: true, id: input.id, revision } };
}

function installAction(
  registry: ActionRegistry,
  id: string,
  resource: ResourceDefinition,
  mode: 'create' | 'update',
  state: PlaygroundDataState,
) {
  const registration: ActionRegistration<DataRecord> = {
    descriptor: {
      ref: { id, revision: '1' },
      input: { id: `${id}.input`, revision: '1' },
      output: { id: `${id}.output`, revision: '1' },
      sideEffect: 'domain-write',
      confirmation: 'required',
      idempotency: 'required',
      entityRevision: mode === 'update' ? 'required' : 'none',
    },
    inputSchema: inputSchema(id, resource),
    outputSchema: outputSchema(id),
    dispatch: ({ input }) => dispatchPlaygroundAction(input, resource, mode, state),
  };
  const registered = registry.register(registration);
  if (!registered.ok) throw new Error(registered.diagnostics[0].message);
}

function createPlaygroundActionPort(state: PlaygroundDataState) {
  const registry = new ActionRegistry();
  installAction(registry, 'products.create', PLAYGROUND_RESOURCES.products, 'create', state);
  installAction(registry, 'products.update', PLAYGROUND_RESOURCES.products, 'update', state);
  installAction(registry, 'tickets.update', PLAYGROUND_RESOURCES.tickets, 'update', state);
  return createActionPort({
    registry,
    host: {
      readContext: () => ({
        ok: true,
        value: {
          principalKey: 'public-demo',
          actorKey: 'public-demo',
          scopeDigest: 'synthetic-local',
          policyRevision: 'policy-1',
          domainRevision: `demo-${state.currentRevision()}`,
          confirmationEpoch: 'user-preview',
          grants: ['action.propose', 'action.execute'],
          entityRevisions: Object.fromEntries(state.revisions),
        },
      }),
      issueConfirmation: () => ({ ok: true, value: undefined }),
    },
  });
}

export function createPlaygroundData(functionRegistry: FunctionRegistry) {
  const records = cloneRecords();
  const revisions = new Map<string, string>();
  for (const rows of Object.values(records)) for (const row of rows) revisions.set(recordKey(row), '1');
  const resources = Object.values(PLAYGROUND_RESOURCES);
  let sourceRevision = 1;
  const services = createLocalDataServices(resources, records, functionRegistry, () => sourceRevision);
  const state = {
    records,
    revisions,
    services,
    currentRevision: () => sourceRevision,
    nextSourceRevision: () => ++sourceRevision,
  };
  const actionPort = createPlaygroundActionPort(state);
  return { records, revisions, resources, services, actionPort };
}

export function readPlaygroundFormState(
  records: Records,
  revisions: Map<string, string>,
  resource: ResourceDefinition,
  intent: Extract<Intent, { readonly kind: 'create' | 'edit' }>,
): Outcome<AeliqoFormState> {
  if (intent.kind === 'create') return { ok: true as const, value: { values: {}, entityRevision: 'new' } };
  const rows = records[resource.id] ?? [];
  const selected = rows.find((row) => Object.entries(intent.identity).every(([field, value]) => row[field] === value));
  if (selected === undefined)
    return failure<AeliqoFormState>('playground.form-missing', 'The selected record is no longer available.');
  return {
    ok: true as const,
    value: { values: structuredClone(selected), entityRevision: revisions.get(recordKey(selected)) ?? '1' },
  };
}
