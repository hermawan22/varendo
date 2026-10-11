import type { Catalog, Outcome, VersionRef } from '../../contracts/types.js';
import { versionRefKey as relationKey } from '../../contracts/stable.js';
import type { FunctionRegistry } from '../../expressions/types.js';
import type { QueryExecutionContext, QueryRow, QuerySchema, QuerySource } from '../types.js';
import { failure } from '../planner/shared.js';

export type CatalogEntity = Catalog['entities'][number];
export type CatalogRelationship = Catalog['relationships'][number];

export interface EvalGroup {
  readonly keyRow: QueryRow;
  readonly rows: readonly QueryRow[];
  readonly schema: QuerySchema;
}

export interface EvalRelation {
  readonly schema: QuerySchema;
  readonly rows: readonly QueryRow[];
  readonly complete: boolean;
  readonly groups?: readonly EvalGroup[];
}

export interface EvalState {
  readonly source: QuerySource;
  readonly catalog: Catalog;
  readonly registry: FunctionRegistry;
  readonly context: QueryExecutionContext;
  readonly startedAt?: number;
  lastClock?: number;
  readonly unknown: Array<{ readonly field: string; readonly reason: string }>;
  approximate: boolean;
  operations: number;
  scannedRows: number;
  sourceBytes: number;
  readonly materializedBytes: WeakMap<QueryRow[], number>;
}

export { failure };

export function unsupported<T>(id: string, reason: string): Outcome<T> {
  return failure('query.unsupported', `Query capability ${id} is not supported: ${reason}`);
}

export function stable(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : JSON.stringify(value);
  if (typeof value === 'bigint') return `bigint:${value.toString()}`;
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (seen.has(value)) return '"<cycle>"';
  seen.add(value);
  if (Array.isArray(value)) {
    const output = `[${value.map((entry) => stable(entry, seen)).join(',')}]`;
    seen.delete(value);
    return output;
  }
  const record = value as Record<string, unknown>;
  const output = `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(record[key], seen)}`)
    .join(',')}}`;
  seen.delete(value);
  return output;
}

export { relationKey };
export function fieldKey(entity: string, field: string): string {
  return JSON.stringify([entity, field]);
}

export function entity(catalog: Catalog, id: string): CatalogEntity | undefined {
  return catalog.entities.find((candidate) => candidate.id === id);
}
export function relationship(catalog: Catalog, ref: VersionRef): CatalogRelationship | undefined {
  return catalog.relationships.find((candidate) => relationKey(candidate) === relationKey(ref));
}

export type PlanRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is PlanRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isPlainDataRecord(value: unknown): value is PlanRecord {
  try {
    if (!isRecord(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && 'value' in descriptor;
    });
  } catch {
    return false;
  }
}

export function planId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

export function safeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function safePositiveCount(value: unknown): value is number {
  return safeCount(value) && value > 0;
}
