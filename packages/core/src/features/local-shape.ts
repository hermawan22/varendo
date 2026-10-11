import type * as z from 'zod';
import { inferResourceFieldType } from '../app/resource.js';
import type { Diagnostic, Outcome } from '../contracts/types.js';
import { WIRE_LIMITS } from '../contracts/limits.js';
import { captureLocalRows, validIdentifier } from './local-shape-capture.js';
import { inspectRows } from './local-shape-inspection.js';

export type LocalDataFieldKind = 'text' | 'boolean' | 'integer' | 'float' | 'decimal' | 'date' | 'instant' | 'unknown';

export interface LocalDataShapeField {
  readonly id: string;
  readonly kind: LocalDataFieldKind;
  readonly nullable: boolean;
}

interface LocalDataShapeInputBase {
  readonly id: string;
  readonly rows: readonly unknown[];
  readonly schema?: z.ZodObject;
  readonly limits?: {
    readonly rows?: number;
    readonly bytes?: number;
    readonly fields?: number;
  };
}

export type LocalDataShapeInput = LocalDataShapeInputBase &
  (
    | { readonly identity?: undefined; readonly getRowId?: undefined }
    | { readonly identity: readonly string[]; readonly getRowId?: undefined }
    | { readonly identity?: undefined; readonly getRowId: (row: unknown, index: number) => unknown }
  );

export interface LocalDataShape {
  readonly status: 'ready' | 'empty';
  readonly fields: readonly LocalDataShapeField[];
  readonly identity: readonly string[];
}

const DEFAULT_LIMITS = Object.freeze({
  rows: WIRE_LIMITS.array,
  bytes: WIRE_LIMITS.bytes,
  fields: WIRE_LIMITS.properties,
});

function failure(code: string, message: string, path: readonly (string | number)[] = []): Outcome<never> {
  const diagnostic: Diagnostic = { code, message, path, retryable: false };
  return { ok: false, diagnostics: [diagnostic] };
}

function limitsOf(input: LocalDataShapeInput) {
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  if (
    !Number.isSafeInteger(limits.rows) ||
    limits.rows < 1 ||
    !Number.isSafeInteger(limits.bytes) ||
    limits.bytes < 1 ||
    !Number.isSafeInteger(limits.fields) ||
    limits.fields < 1
  )
    return undefined;
  return limits;
}

function schemaFields(input: LocalDataShapeInput): Outcome<readonly string[]> {
  const shape = input.schema?.shape;
  if (shape === undefined) return failure('data.shape-schema', 'The declared local schema is not inspectable.');
  const fields = Object.keys(shape).sort();
  if (fields.some((field) => !validIdentifier(field)))
    return failure('data.shape-field', 'Declared local fields must use bounded wire identifiers.');
  return { ok: true, value: fields };
}

function inferredSchemaFields(
  fields: readonly string[],
  shape: Record<string, unknown>,
): Outcome<readonly LocalDataShapeField[]> {
  const inferred: LocalDataShapeField[] = [];
  for (const id of fields) {
    const field = schemaField(id, shape[id]);
    if (!field.ok) return field;
    inferred.push(field.value);
  }
  return { ok: true, value: inferred };
}

function schemaRows(
  input: LocalDataShapeInput,
  fields: readonly string[],
  inferred: readonly LocalDataShapeField[],
  limit: { readonly rows: number; readonly bytes: number; readonly fields: number },
): Outcome<LocalDataShape> {
  const identity = validateIdentityFields(input.identity, fields);
  if (!identity.ok) return identity;
  const rows = input.rows;
  if (rows.length === 0 && input.getRowId !== undefined)
    return failure(
      'data.identity-ambiguous',
      'A row identity callback needs at least one row or explicit identity fields.',
    );
  if (rows.length === 0)
    return {
      ok: true,
      value: { status: 'empty', fields: Object.freeze(inferred), identity: Object.freeze([...(input.identity ?? [])]) },
    };
  const declaredFields = new Map(inferred.map((field) => [field.id, field] as const));
  const checked = inspectRows(input, rows, limit, fields, declaredFields);
  if (!checked.ok) return checked;
  return {
    ok: true,
    value: {
      status: 'ready',
      fields: Object.freeze(inferred),
      identity: Object.freeze(input.identity ?? checked.value.identity),
    },
  };
}

function shapeForSchema(input: LocalDataShapeInput): Outcome<LocalDataShape> {
  const fields = schemaFields(input);
  if (!fields.ok) return fields;
  const limit = limitsOf(input);
  if (limit === undefined || fields.value.length > limit.fields)
    return failure('data.shape-capacity', 'The inferred local shape exceeds its field bound.');
  const schemaShape = input.schema?.shape;
  if (schemaShape === undefined) return failure('data.shape-schema', 'The declared local schema is not inspectable.');
  const inferred = inferredSchemaFields(fields.value, schemaShape);
  if (!inferred.ok) return inferred;
  return schemaRows(input, fields.value, inferred.value, limit);
}

function schemaField(id: string, schema: unknown): Outcome<LocalDataShapeField> {
  const inferred = inferResourceFieldType(schema as z.ZodType);
  if (!inferred.ok) return inferred;
  return { ok: true, value: { id, kind: inferred.value.value, nullable: inferred.value.nullable } };
}

function validateIdentityFields(identity: readonly string[] | undefined, fields: readonly string[]): Outcome<void> {
  if (identity === undefined) return { ok: true, value: undefined };
  const fieldSet = new Set(fields);
  for (const field of identity) {
    if (!validIdentifier(field) || !fieldSet.has(field))
      return failure('data.identity-field', `Identity field ${field} is not declared.`);
  }
  if (new Set(identity).size !== identity.length)
    return failure('data.identity-field', 'Identity fields must be unique.');
  return { ok: true, value: undefined };
}

/** Inspects local rows without inventing business semantics, permissions, or IDs. */
export function inferLocalDataShape(input: LocalDataShapeInput): Outcome<LocalDataShape> {
  const limits = limitsOf(input);
  if (limits === undefined)
    return failure('data.shape-capacity', 'Local shape limits must be positive bounded integers.');
  if (input.identity !== undefined && input.getRowId !== undefined)
    return failure('data.identity-ambiguous', 'Declare either identity fields or a row identity callback, not both.');
  if (!validIdentifier(input.id)) return failure('data.shape-id', 'The local shape ID is not bounded.');
  const capturedRows = captureLocalRows(input.rows, limits.rows);
  if (!capturedRows.ok) return capturedRows;
  const capturedInput = { ...input, rows: capturedRows.value } as LocalDataShapeInput;
  if (capturedInput.schema !== undefined) return shapeForSchema(capturedInput);
  if (capturedInput.rows.length === 0)
    return failure('data.shape-empty', 'Empty local data needs a declared schema or input rows.');
  const checked = inspectRows(capturedInput, capturedInput.rows, limits);
  if (!checked.ok) return checked;
  return { ok: true, value: { status: 'ready', fields: checked.value.fields, identity: checked.value.identity } };
}
