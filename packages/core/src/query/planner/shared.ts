import { WIRE_LIMITS } from '../../contracts/limits.js';
import { NUMERIC_TYPE_VALUES } from '../../contracts/scalars.js';
import type { Catalog, Expression, FieldDefinition, SemanticType } from '../../contracts/types.js';
import { versionRefKey as relationKey } from '../../contracts/stable.js';
import type { FunctionRegistry } from '../../expressions/types.js';
import type { PlanOperation, QueryField, QueryOutcome, QuerySchema } from '../types.js';

export const PLAN_ENTITY = '__aeliqo_plan__';
export type CatalogEntity = Catalog['entities'][number];
export type CatalogRelationship = Catalog['relationships'][number];

export const BUCKET_GRAINS: ReadonlySet<string> = new Set(['day', 'week', 'month', 'quarter', 'year']);

const JOIN_OPERATIONS: ReadonlySet<PlanOperation> = new Set(['join', 'semijoin']);
const FANOUT_CARDINALITIES: ReadonlySet<CatalogRelationship['cardinality']> = new Set(['one-to-many', 'many-to-many']);

export function isJoinOperation(operation: PlanOperation): boolean {
  return JOIN_OPERATIONS.has(operation);
}

export function isFanoutCardinality(cardinality: CatalogRelationship['cardinality']): boolean {
  return FANOUT_CARDINALITIES.has(cardinality);
}

export const DEFAULT_LIMITS = Object.freeze({
  maxNodes: 256,
  maxDepth: 64,
  maxRows: 10_000,
  maxBytes: WIRE_LIMITS.bytes,
  maxJoinRows: 10_000,
  maxOperations: 1_000_000,
});

export function failure<T>(code: string, message: string, path: readonly (string | number)[] = []): QueryOutcome<T> {
  return {
    ok: false,
    diagnostics: [{ code, message, retryable: false, ...(path.length === 0 ? {} : { path: [...path] }) }],
  };
}

export function unsupported<T>(
  id: string,
  reason: string,
  alternatives: readonly string[] = [],
  path: readonly (string | number)[] = [],
): QueryOutcome<T> {
  return {
    ok: false,
    diagnostics: [
      {
        code: 'query.unsupported',
        message: `Query capability ${id} is not supported: ${reason}`,
        retryable: false,
        ...(path.length === 0 ? {} : { path: [...path] }),
        ...(alternatives.length === 0 ? {} : { remedies: [...alternatives] }),
      },
    ],
  };
}

export function safeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= WIRE_LIMITS.id &&
    !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

export function safePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

const SNAPSHOT_PRIMITIVE_TYPES: ReadonlySet<string> = new Set(['string', 'boolean', 'number', 'undefined']);

function isSnapshotPrimitive(value: unknown): boolean {
  return value === null || SNAPSHOT_PRIMITIVE_TYPES.has(typeof value);
}

function existingSnapshot(value: object, active: WeakSet<object>, seen: WeakMap<object, unknown>): unknown | undefined {
  const existing = seen.get(value);
  if (existing === undefined) return undefined;
  if (active.has(value)) throw new Error('query snapshots may not contain cycles');
  return existing;
}

function createSnapshotContainer(value: object): Record<string, unknown> | unknown[] {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value))
    throw new Error('query snapshots may contain only plain objects');
  return Array.isArray(value) ? [] : Object.create(prototype);
}

function cloneSnapshotProperties(
  value: object,
  copy: Record<string, unknown> | unknown[],
  active: WeakSet<object>,
  seen: WeakMap<object, unknown>,
): void {
  for (const key of Object.keys(value)) {
    (copy as Record<string, unknown>)[key] = cloneSnapshot((value as Record<string, unknown>)[key], active, seen);
  }
}

function cloneSnapshot(value: unknown, active = new WeakSet<object>(), seen = new WeakMap<object, unknown>()): unknown {
  if (isSnapshotPrimitive(value)) return value;
  if (value === null || typeof value !== 'object') throw new Error('query snapshots may contain only data values');
  const existing = existingSnapshot(value, active, seen);
  if (existing !== undefined) return existing;
  const copy = createSnapshotContainer(value);
  seen.set(value, copy);
  active.add(value);
  cloneSnapshotProperties(value, copy, active, seen);
  active.delete(value);
  return copy;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function immutableSnapshot<T>(value: T): T {
  return deepFreeze(cloneSnapshot(value) as T);
}

export function stable(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
    .join(',')}}`;
}

export function fieldKey(entity: string, field: string): string {
  return JSON.stringify([entity, field]);
}

export { relationKey };

export function semanticType(type: SemanticType, grain: readonly string[]): SemanticType {
  return type.grain === undefined ? { ...type, grain: [...grain] } : type;
}

function queryField(entity: CatalogEntity, field: FieldDefinition): QueryField {
  return {
    id: fieldKey(entity.id, field.id),
    label: field.label,
    type: semanticType(
      field.type,
      entity.rowGrain.map((grain) => fieldKey(entity.id, grain)),
    ),
    role: field.role,
    source: { entity: entity.id, field: field.id },
  };
}

export function scanSchema(entity: CatalogEntity): QuerySchema {
  const fields = entity.fields.map((field) => queryField(entity, field));
  return {
    fields,
    identity: entity.identity.map((field) => fieldKey(entity.id, field)),
    grain: entity.rowGrain.map((field) => fieldKey(entity.id, field)),
  };
}

export function roleForType(type: SemanticType): FieldDefinition['role'] {
  if (NUMERIC_TYPE_VALUES.has(type.value)) return 'measure';
  return 'attribute';
}

export function findField(
  schema: QuerySchema,
  expression: Extract<Expression, { kind: 'field' }>,
): QueryField | undefined {
  const candidates = schema.fields.filter((field) => {
    if (expression.entity !== undefined)
      return field.source?.entity === expression.entity && field.source.field === expression.ref;
    return field.id === expression.ref || field.source?.field === expression.ref;
  });
  if (candidates.length === 1) return candidates[0];
  return undefined;
}

export function syntheticId(index: number): string {
  return `f${index}`;
}

function nonEmptyIds(values: readonly string[]): [string, ...string[]] {
  if (values.length === 0) return ['f0'];
  return [values[0]!, ...values.slice(1)];
}

export function syntheticCatalog(schema: QuerySchema, registry: FunctionRegistry): Catalog {
  const fields = schema.fields.map((field, index) => ({
    id: syntheticId(index),
    label: field.label,
    type: field.type,
    role: field.role,
  }));
  return {
    version: '1',
    revision: 'query-schema',
    functionRegistryDigest: registry.digest,
    entities: [
      {
        id: PLAN_ENTITY,
        label: 'Query relation',
        identity: nonEmptyIds(
          schema.identity.map((value) => syntheticId(schema.fields.findIndex((field) => field.id === value))),
        ),
        rowGrain: nonEmptyIds(
          schema.grain.map((value) => syntheticId(schema.fields.findIndex((field) => field.id === value))),
        ),
        fields,
      },
    ],
    relationships: [],
    meanings: [],
    capabilities: [],
  };
}
