import { parseCatalog, WIRE_LIMITS } from '@varendo/core';
import type { Catalog } from '@varendo/core';
import { createCatalogIndex } from '@varendo/core/semantics';
import type { CatalogEntity } from '@varendo/core/semantics';
import type { DataRecord, DataValue, LocalDataServiceOptions, LocalSnapshot } from '../types.js';
import { assertSafeId, canonical } from './shared.js';
import type { SourceLimits } from './shared.js';

export interface StoredSnapshot {
  readonly catalog: Catalog;
  readonly sourceRevision: string;
  readonly records: Readonly<Record<string, readonly DataRecord[]>>;
}

interface ByteBudget {
  readonly limits: SourceLimits;
  rows: number;
  bytes: number;
}

class SourceError extends TypeError {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function isSourceCapacityError(error: unknown): boolean {
  return error instanceof SourceError && error.code === undefined;
}

export function sourceDiagnosticCode(error: unknown): string | undefined {
  return error instanceof SourceError ? error.code : undefined;
}

export const DEFAULT_SOURCE_LIMITS: SourceLimits = Object.freeze({ rows: WIRE_LIMITS.array, bytes: WIRE_LIMITS.bytes });

export function normalizeSourceLimits(input: LocalDataServiceOptions['sourceLimits'] | undefined): SourceLimits {
  if (input === undefined) return DEFAULT_SOURCE_LIMITS;
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !Number.isSafeInteger(input.rows) ||
    input.rows < 1 ||
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 1
  )
    throw new TypeError('Invalid sourceLimits.');
  return Object.freeze({ rows: input.rows, bytes: input.bytes });
}

function validDecimal(value: string): boolean {
  return /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value) && value.length <= 512;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function instantParts(value: string): { readonly epochMilliseconds: number; readonly fraction: string } | undefined {
  if (value.length > WIRE_LIMITS.text) return undefined;
  const matched = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/u.exec(value);
  if (matched === null || !validDate(matched[1]!)) return undefined;
  if (Number(matched[2]) > 23 || Number(matched[3]) > 59 || Number(matched[4]) > 59) return undefined;
  if (invalidOffset(matched[7], matched[8])) return undefined;
  const epochMilliseconds = Date.parse(`${matched[1]}T${matched[2]}:${matched[3]}:${matched[4]}${matched[6]}`);
  if (!Number.isSafeInteger(epochMilliseconds)) return undefined;
  return { epochMilliseconds, fraction: (matched[5] ?? '').replace(/0+$/u, '') };
}

function invalidOffset(hours: string | undefined, minutes: string | undefined): boolean {
  return hours !== undefined && (Number(hours) > 23 || Number(minutes) > 59);
}

type FieldValueKind = CatalogEntity['fields'][number]['type']['value'];

const STRING_FIELD_CHECKS: Readonly<Partial<Record<FieldValueKind, (value: string) => boolean>>> = {
  date: validDate,
  instant: (value) => instantParts(value) !== undefined,
  text: () => true,
};

function validSourceString(value: string, field: CatalogEntity['fields'][number]): boolean {
  if (value.length > WIRE_LIMITS.text) return false;
  const check = STRING_FIELD_CHECKS[field.type.value];
  return check !== undefined && check(value);
}

function validDecimalRecord(value: object): boolean {
  if (Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && typeof record.decimal === 'string' && validDecimal(record.decimal);
}

function validSourceValue(value: unknown, field: CatalogEntity['fields'][number]): value is DataValue {
  if (value === null) return field.type.nullable;
  switch (typeof value) {
    case 'string':
      return validSourceString(value, field);
    case 'boolean':
      return field.type.value === 'boolean';
    case 'number':
      return validSourceNumber(value, field);
    case 'object':
      return field.type.value === 'decimal' && validDecimalRecord(value);
    default:
      return false;
  }
}

function validSourceNumber(value: number, field: CatalogEntity['fields'][number]): boolean {
  if (!Number.isFinite(value)) return false;
  if (field.type.value === 'integer') return Number.isSafeInteger(value);
  return field.type.value === 'float';
}

function normalizeDecimalIdentity(value: string): string {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const normalizedFraction = fraction.replace(/0+$/u, '');
  if (whole === '0' && normalizedFraction.length === 0) return '0';
  return `${negative ? '-' : ''}${whole}${normalizedFraction.length === 0 ? '' : `.${normalizedFraction}`}`;
}

function identityPart(value: DataValue, fieldType: string): string {
  if (fieldType === 'decimal' && value !== null && typeof value === 'object')
    return `decimal:${normalizeDecimalIdentity(value.decimal)}`;
  if (fieldType === 'instant' && typeof value === 'string') {
    const parts = instantParts(value)!;
    return `instant:${parts.epochMilliseconds}:${parts.fraction}`;
  }
  if (typeof value === 'number' && value === 0) return `${fieldType}:0`;
  return `${fieldType}:${canonical(value)}`;
}

function sourceJsonBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Non-JSON source value.');
  return new TextEncoder().encode(serialized).byteLength;
}

function ownDataValue(value: object, key: PropertyKey, message: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor)) throw new TypeError(message);
  return descriptor.value;
}

function addCount(budget: ByteBudget, count: number): void {
  if (count > budget.limits.bytes - budget.bytes) throw new SourceError('Local data exceeds byte limit.');
  budget.bytes += count;
}

function catalogForSnapshot(catalog: Catalog): Catalog {
  const parsed = parseCatalog(catalog);
  if (!parsed.ok) throw new TypeError('Catalog is not canonical.');
  const copied = parseCatalog(parsed.value);
  if (!copied.ok) throw new TypeError('Catalog is not canonical.');
  const indexed = createCatalogIndex(copied.value);
  if (!indexed.ok) throw new TypeError('Snapshot catalog is invalid.');
  const invalidKeys = copied.value.entities.some(
    (entity) => entity.id === '__proto__' || entity.fields.some((field) => field.id === '__proto__'),
  );
  if (invalidKeys) throw new TypeError('IDs cannot be wire record keys.');
  return copied.value;
}

function createByteBudget(limits: SourceLimits): ByteBudget {
  const budget = { limits, rows: 0, bytes: 0 };
  addCount(budget, 2);
  return budget;
}

function captureSnapshotRows(value: unknown, maxRows: number): readonly DataRecord[] {
  if (!Array.isArray(value)) throw new TypeError('Rows must be an array.');
  const length = ownDataValue(value, 'length', 'Rows could not be safely inspected.') as number;
  if (!Number.isSafeInteger(length) || length < 0) throw new TypeError('Invalid row length.');
  if (length > maxRows) throw new SourceError('Local data exceeds row limit.');
  const captured: DataRecord[] = [];
  let count = 0;
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length)
      throw new TypeError('Rows must be a dense array.');
    captured[Number(key)] = ownDataValue(value, key, 'Rows contain an accessor.') as DataRecord;
    count += 1;
  }
  if (count !== length) throw new TypeError('Rows require plain objects.');
  return captured;
}

function captureSnapshotRecords(
  records: LocalSnapshot['records'],
  maxRows: number,
): Readonly<Record<string, readonly DataRecord[]>> {
  if (records === null || typeof records !== 'object' || Array.isArray(records))
    throw new TypeError('Snapshot records must be an entity map.');
  const keys = Reflect.ownKeys(records);
  if (keys.length > WIRE_LIMITS.properties) throw new TypeError('Too many source entities.');
  const captured: Record<string, readonly DataRecord[]> = Object.create(null) as Record<string, readonly DataRecord[]>;
  for (const key of keys) {
    if (typeof key !== 'string') throw new TypeError('Snapshot records contain a symbol entity.');
    captured[key] = captureSnapshotRows(ownDataValue(records, key, 'Snapshot records contain accessor.'), maxRows);
  }
  return captured;
}

function captureSnapshotInput(snapshot: LocalSnapshot): LocalSnapshot {
  if (snapshot === null || typeof snapshot !== 'object') throw new TypeError('Snapshot must be an object.');
  const captured: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ['catalog', 'sourceRevision', 'records'] as const) {
    captured[key] = ownDataValue(snapshot, key, 'Snapshot property must be data.');
  }
  return captured as unknown as LocalSnapshot;
}

function normalizeEntityRows(
  rows: readonly DataRecord[],
  entity: CatalogEntity,
  budget: ByteBudget,
  rejectExecutableToJSON: boolean,
): readonly DataRecord[] {
  if (rows.length > budget.limits.rows - budget.rows) throw new SourceError('Local data exceeds row limit.');
  budget.rows += rows.length;
  addCount(budget, 3);
  const identityKeys = new Set<string>();
  const fields = new Map(entity.fields.map((field) => [field.id, field]));
  const normalized: DataRecord[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    if (rowIndex > 0) addCount(budget, 1);
    normalized.push(normalizeRow(row, rowIndex, entity, fields, identityKeys, budget, rejectExecutableToJSON));
  }
  return Object.freeze(normalized);
}

function normalizeRow(
  row: DataRecord,
  rowIndex: number,
  entity: CatalogEntity,
  fields: ReadonlyMap<string, CatalogEntity['fields'][number]>,
  identityKeys: Set<string>,
  budget: ByteBudget,
  rejectExecutableToJSON: boolean,
): DataRecord {
  const captured = capturePlainRecord(row, entity.id, rejectExecutableToJSON);
  const keys = Object.keys(captured);
  if (keys.length > WIRE_LIMITS.properties) throw new TypeError(`Row for ${entity.id} exceeds the field limit.`);
  addCount(budget, 2 + (rowIndex > 0 ? 1 : 0));
  writeValidatedFields(captured, keys, fields, budget);
  validateRequiredFields(captured, entity);
  validateIdentityFields(captured, entity);
  const identityKey = canonical(
    entity.identity.map((identity) => identityPart(captured[identity]!, fields.get(identity)!.type.value)),
  );
  if (identityKeys.has(identityKey)) throw new TypeError('duplicate identity.');
  identityKeys.add(identityKey);
  return deepFreezeRecord(captured);
}

function captureSourceValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new TypeError('Row value is unreadable.');
  }
  if (prototype !== Object.prototype && prototype !== null) return Object.create(null);
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError('Row value is unreadable.');
  }
  if (keys.length !== 1 || keys[0] !== 'decimal') return Object.create(null);
  return {
    decimal: ownDataValue(value, 'decimal', 'Row contains an accessor field.'),
  };
}

function skipExecutableToJSON(key: string, value: unknown, reject: boolean): boolean {
  if (key !== 'toJSON' || typeof value !== 'function') return false;
  if (reject) throw new SourceError('Executable toJSON is not allowed.', 'data.shape-executable');
  return true;
}

function capturePlainRecord(row: unknown, entityId: string, rejectExecutableToJSON: boolean): DataRecord {
  if (row === null || typeof row !== 'object' || Array.isArray(row))
    throw new TypeError(`Row for ${entityId} must be a plain object.`);
  const prototype = Object.getPrototypeOf(row);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`Row for ${entityId} must be a plain object.`);
  const captured: Record<string, DataValue> = Object.create(null) as Record<string, DataValue>;
  for (const key of Reflect.ownKeys(row)) {
    if (typeof key !== 'string') throw new TypeError(`Row for ${entityId} contains a symbol field.`);
    const value = ownDataValue(row, key, `Row for ${entityId} contains an accessor field.`);
    if (skipExecutableToJSON(key, value, rejectExecutableToJSON)) continue;
    captured[key] = captureSourceValue(value) as DataValue;
  }
  return captured;
}

function writeValidatedFields(
  row: DataRecord,
  keys: readonly string[],
  fields: ReadonlyMap<string, CatalogEntity['fields'][number]>,
  budget: ByteBudget,
): void {
  for (const [index, key] of keys.entries()) {
    const field = fields.get(key);
    const value = row[key];
    if (field === undefined || !validSourceValue(value, field)) throw new TypeError(`invalid value for ${key}.`);
    addCount(budget, 1 + (index > 0 ? 1 : 0));
    addCount(budget, sourceJsonBytes(key));
    addCount(budget, sourceJsonBytes(value));
  }
}

function validateRequiredFields(row: DataRecord, entity: CatalogEntity): void {
  for (const field of entity.fields) {
    const missing =
      !field.type.nullable && (!Object.hasOwn(row, field.id) || row[field.id] === undefined || row[field.id] === null);
    if (missing) throw new TypeError(`Missing non-nullable field ${field.id}.`);
  }
}

function validateIdentityFields(row: DataRecord, entity: CatalogEntity): void {
  for (const identity of entity.identity) {
    const missing = !Object.hasOwn(row, identity) || row[identity] === undefined || row[identity] === null;
    if (missing) throw new TypeError(`Invalid identity field ${identity}.`);
  }
}

function deepFreezeRecord(record: DataRecord): DataRecord {
  const copy: Record<string, DataValue> = Object.create(null) as Record<string, DataValue>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value !== null && typeof value === 'object') copy[key] = Object.freeze({ decimal: value.decimal });
    else copy[key] = value!;
  }
  return Object.freeze(copy);
}

export function freezeCatalog(catalog: Catalog): Catalog {
  return freezeDeep(catalog);
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const child of value) freezeDeep(child);
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

export function normalizeSnapshot(
  snapshot: LocalSnapshot,
  sourceLimits: SourceLimits,
  options: { readonly rejectExecutableToJSON?: boolean } = {},
): StoredSnapshot {
  const capturedSnapshot = captureSnapshotInput(snapshot);
  const catalog = catalogForSnapshot(capturedSnapshot.catalog);
  assertSafeId(capturedSnapshot.sourceRevision, 'sourceRevision');
  const sourceRecords = captureSnapshotRecords(capturedSnapshot.records, sourceLimits.rows);
  const budget = createByteBudget(sourceLimits);
  const entities = new Map(catalog.entities.map((entity) => [entity.id, entity] as const));
  const records: Record<string, readonly DataRecord[]> = Object.create(null) as Record<string, readonly DataRecord[]>;
  for (const [entityId, rows] of Object.entries(sourceRecords)) {
    assertSafeId(entityId, 'entity id');
    const entity = entities.get(entityId);
    if (entity === undefined) throw new TypeError(`Rows reference unknown entity ${entityId}.`);
    if (Object.keys(records).length > 0) addCount(budget, 1);
    addCount(budget, sourceJsonBytes(entityId));
    records[entityId] = normalizeEntityRows(rows, entity, budget, options.rejectExecutableToJSON === true);
  }
  return Object.freeze({
    catalog: freezeCatalog(catalog),
    sourceRevision: capturedSnapshot.sourceRevision,
    records: Object.freeze(records),
  });
}
