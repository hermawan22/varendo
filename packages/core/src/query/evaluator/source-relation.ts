import { scalarIdentity, validateScalar } from '../../contracts/scalars.js';
import type { Catalog, Outcome } from '../../contracts/types.js';
import type { QueryField, QueryRow, QuerySchema, QuerySourceRelation, QueryValue } from '../types.js';
import {
  entity,
  failure,
  fieldKey,
  isPlainDataRecord,
  stable,
  type CatalogEntity,
  type EvalRelation,
  type EvalState,
} from './shared.js';
import { appendRow, outputBytes, tick } from './execution-budget.js';
import { scanSchema } from '../planner/shared.js';

interface SourceDefinition {
  readonly entity: CatalogEntity;
  readonly rows: readonly QueryRow[];
}

function validateSourceDefinition(
  source: QuerySourceRelation,
  catalog: Catalog,
  expectedEntity: string,
  state: EvalState,
): Outcome<SourceDefinition> {
  if (!isPlainDataRecord(source) || typeof source.entity !== 'string' || typeof source.complete !== 'boolean')
    return failure('query.source-shape', 'Source relation metadata is invalid.');
  if (source.entity !== expectedEntity)
    return failure(
      'query.source-entity',
      `Source relation is labelled ${source.entity} but the plan requested ${expectedEntity}.`,
    );
  const definition = entity(catalog, source.entity);
  if (definition === undefined)
    return failure('query.source-entity', `Source relation ${source.entity} is not declared.`);
  if (!Array.isArray(source.rows))
    return failure('query.source-shape', `Source relation ${source.entity} rows must be an array.`);
  if (state.scannedRows + source.rows.length > state.context.maxRows!)
    return failure('query.budget', 'Source population exceeds the effective row budget before scanning.');
  return { ok: true, value: { entity: definition, rows: source.rows } };
}

function sourceValue(
  input: Record<string, unknown>,
  key: string,
  index: number,
  sourceEntity: string,
  fields: readonly QueryField[],
): Outcome<QueryValue> {
  const field = fields.find((candidate) => candidate.source?.field === key);
  if (field === undefined)
    return failure('query.source-value', `Source row ${index} for ${sourceEntity} has an invalid value for ${key}.`);
  const checked = validateScalar(input[key], field.type);
  if (checked.ok) return { ok: true, value: checked.value };
  return failure('query.source-value', `Source row ${index} for ${sourceEntity} has an invalid value for ${key}.`);
}

function normalizeRowValues(
  input: Record<string, unknown>,
  index: number,
  definition: CatalogEntity,
  schema: QuerySchema,
): Outcome<Record<string, QueryValue>> {
  const output: Record<string, QueryValue> = {};
  for (const key of Object.keys(input)) {
    const checked = sourceValue(input, key, index, definition.id, schema.fields);
    if (!checked.ok) return checked;
    output[fieldKey(definition.id, key)] = checked.value;
  }
  return { ok: true, value: output };
}

function validateRequiredFields(
  input: Record<string, unknown>,
  index: number,
  definition: CatalogEntity,
): Outcome<void> {
  for (const field of definition.fields) {
    const missing = !Object.hasOwn(input, field.id) || input[field.id] === undefined;
    const invalidNull = input[field.id] === null && !field.type.nullable;
    if (missing || invalidNull)
      return failure(
        'query.source-value',
        `Source row ${index} for ${definition.id} is missing non-nullable field ${field.id}.`,
      );
  }
  return { ok: true, value: undefined };
}

function rowIdentity(output: Record<string, QueryValue>, definition: CatalogEntity): Outcome<string> {
  const tuple: string[] = [];
  for (const fieldId of definition.identity) {
    const field = definition.fields.find((candidate) => candidate.id === fieldId);
    if (field === undefined) return failure('query.source-value', 'Declared identity field is missing.');
    const identity = scalarIdentity(output[fieldKey(definition.id, fieldId)], field.type);
    if (!identity.ok) return failure('query.source-value', 'Source row has an invalid identity value.');
    tuple.push(identity.value);
  }
  return { ok: true, value: stable(tuple) };
}

function normalizeSourceRow(
  source: QuerySourceRelation,
  index: number,
  definition: CatalogEntity,
  schema: QuerySchema,
  identities: Set<string>,
  state: EvalState,
): Outcome<QueryRow> {
  const descriptor = Object.getOwnPropertyDescriptor(source.rows, String(index));
  if (descriptor === undefined || !('value' in descriptor))
    return failure('query.source-shape', 'Source rows must be dense arrays of data values.');
  const input: unknown = descriptor.value;
  if (!isPlainDataRecord(input))
    return failure(
      'query.source-shape',
      `Source row ${index} for ${source.entity} must be a plain object with data properties.`,
    );
  const values = normalizeRowValues(input, index, definition, schema);
  if (!values.ok) return values;
  const required = validateRequiredFields(input, index, definition);
  if (!required.ok) return required;
  const identity = rowIdentity(values.value, definition);
  if (!identity.ok) return identity;
  if (identities.has(identity.value))
    return failure('query.source-identity', `Source relation ${source.entity} contains duplicate identity tuples.`);
  identities.add(identity.value);
  state.sourceBytes += outputBytes([values.value]);
  if (state.sourceBytes > state.context.maxBytes!)
    return failure('query.budget', 'Source population exceeds the effective byte budget.');
  return { ok: true, value: Object.freeze(values.value) };
}

export function normalizeSourceRelation(
  source: QuerySourceRelation,
  catalog: Catalog,
  expectedEntity: string,
  state: EvalState,
): Outcome<EvalRelation> {
  const prepared = validateSourceDefinition(source, catalog, expectedEntity, state);
  if (!prepared.ok) return prepared;
  const { entity: definition, rows: sourceRows } = prepared.value;
  state.scannedRows += sourceRows.length;
  const schema = scanSchema(definition);
  const rows: QueryRow[] = [];
  const identities = new Set<string>();
  for (let index = 0; index < sourceRows.length; index += 1) {
    const step = tick(state, 1 + definition.fields.length + definition.identity.length);
    if (!step.ok) return step;
    const row = normalizeSourceRow(source, index, definition, schema, identities, state);
    if (!row.ok) return row;
    const added = appendRow(state, rows, row.value);
    if (!added.ok) return added;
  }
  return { ok: true, value: { schema, rows: Object.freeze(rows), complete: source.complete } };
}
