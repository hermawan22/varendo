import type { Outcome, Result } from '@varendo/core';
import type { InteractionPort } from '@varendo/core/interaction';
import type { PresentationValues, ResolvedPresentationConfig } from '@varendo/core/presentation';
import type { VarendoPresentationRegistryOptions } from './registry-contracts.js';
import { MAX_ITEMS, MAX_LABEL } from './registry-contracts.js';
import { fieldMap, numeric, object as record } from './data-registry-common.js';

export const fail = <T>(code: string, message: string): Outcome<T> => ({
  ok: false,
  diagnostics: [{ code: `web.presentation.${code}`, message, retryable: false }],
});

export { record, fieldMap };

export function text(value: unknown, field: string): Outcome<string> {
  if (!isBoundedText(value)) return fail('config', `${field} must be a bounded text value.`);
  return { ok: true, value };
}

function isBoundedText(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_LABEL) return false;
  return !/[\u0000-\u001f\u007f]/u.test(value);
}

export function optionalText(values: Record<string, unknown>, key: string): Outcome<string | undefined> {
  if (!Object.hasOwn(values, key)) return { ok: true, value: undefined };
  return text(values[key], key);
}

function columnValue(
  item: unknown,
  fields: Map<string, Result['fields'][number]>,
  seen: Set<string>,
): Outcome<{ readonly key: string; readonly label: string }> {
  const candidate = record(item);
  if (candidate === undefined || !validColumnKeys(candidate))
    return fail('config', 'Every column requires a field key and may not redefine its descriptor label.');
  const key = text(candidate.key, 'column.key');
  if (!key.ok) return key;
  const descriptor = fields.get(key.value);
  if (descriptor === undefined || seen.has(key.value))
    return fail('field', `Column ${key.value} is not a unique field in the bound result.`);
  const label = columnLabel(candidate, descriptor.label, key.value);
  if (!label.ok) return label;
  seen.add(key.value);
  return { ok: true, value: { key: key.value, label: descriptor.label } };
}

function validColumnKeys(candidate: Record<string, unknown>): boolean {
  return Object.hasOwn(candidate, 'key') && Object.keys(candidate).every((key) => key === 'key' || key === 'label');
}

function columnLabel(
  candidate: Record<string, unknown>,
  descriptorLabel: string,
  field: string,
): Outcome<string | undefined> {
  if (candidate.label === undefined) return { ok: true, value: undefined };
  const label = text(candidate.label, 'column.label');
  if (!label.ok) return label;
  if (label.value !== descriptorLabel)
    return fail('field', `Column ${field} must use its registered descriptor label.`);
  return { ok: true, value: label.value };
}

export function columns(
  values: Record<string, unknown>,
  result: Result,
): Outcome<readonly { readonly key: string; readonly label: string }[]> {
  const fields = fieldMap(result);
  const raw = values.columns;
  if (raw === undefined)
    return { ok: true, value: result.fields.map((field) => ({ key: field.id, label: field.label })) };
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS)
    return fail('config', 'columns must be a bounded nonempty array.');
  const output: { readonly key: string; readonly label: string }[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const column = columnValue(item, fields, seen);
    if (!column.ok) return column;
    output.push(column.value);
  }
  return { ok: true, value: output };
}

export function identity(values: Record<string, unknown>, result: Result): Outcome<readonly string[]> {
  const raw = values.identity;
  const candidate = raw === undefined ? result.identity : raw;
  if (!isIdentityList(candidate)) return fail('identity', 'identity must name one or more bounded result fields.');
  const fields = fieldMap(result);
  if (new Set(candidate).size !== candidate.length || candidate.some((field) => !fields.has(field)))
    return fail('identity', 'identity fields must be unique fields in the bound result.');
  if (raw !== undefined && JSON.stringify(candidate) !== JSON.stringify(result.identity))
    return fail('identity', 'identity must match the Result descriptor identity.');
  return { ok: true, value: [...candidate] };
}

function isIdentityList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_ITEMS &&
    value.every((item) => typeof item === 'string' && item.length > 0)
  );
}

export function temporalField(field: Result['fields'][number]): boolean {
  return field.type.value === 'date' || field.type.value === 'instant';
}

export function numericField(field: Result['fields'][number]): boolean {
  return numeric(field.type);
}

export function unitKey(field: Result['fields'][number]): string {
  const unit = field.type.unit;
  return unit === undefined ? '' : JSON.stringify([unit.dimension, unit.symbol, unit.currency ?? null]);
}

export function trendGrain(seriesBy: readonly string[], labelField: string, result: Result): Outcome<undefined> {
  const expected = new Set([...seriesBy, labelField]);
  const actual = new Set(result.rowGrain);
  if (expected.size !== actual.size || [...actual].some((field) => !expected.has(field)))
    return fail('grain', 'Trend grouping and temporal fields must identify each row grain without hidden dimensions.');
  return { ok: true, value: undefined };
}

export function trustedEntity(
  result: Result,
  resolveEntity: VarendoPresentationRegistryOptions['resolveEntity'],
): Outcome<string | undefined> {
  if (resolveEntity === undefined) return { ok: true, value: undefined };
  let value: string | undefined;
  try {
    value = resolveEntity(result);
  } catch {
    return fail('binding', 'The trusted result entity resolver failed.');
  }
  if (value === undefined) return { ok: true, value: undefined };
  return text(value, 'resolved entity');
}

export function selectionPort(
  values: Record<string, unknown>,
  result: Result | undefined,
  portId: string,
  resolveEntity: VarendoPresentationRegistryOptions['resolveEntity'],
): Outcome<readonly [InteractionPort] | readonly []> {
  if (values.selection === undefined || values.selection === 'none') return { ok: true, value: [] };
  if (values.selection !== 'single' && values.selection !== 'multiple')
    return fail('config', 'selection must be none, single or multiple.');
  if (result === undefined) return fail('binding', 'A selectable representation requires a bound result.');
  const owner = trustedEntity(result, resolveEntity);
  if (!owner.ok) return owner;
  if (owner.value === undefined)
    return fail('binding', 'Selectable views require a trusted entity binding for their authorized result.');
  const fields = identity(values, result);
  if (!fields.ok) return fields;
  return {
    ok: true,
    value: [
      {
        id: portId,
        direction: 'inout',
        payload: 'selection',
        entity: owner.value,
        identity: fields.value,
        grain: result.rowGrain,
      },
    ],
  };
}

export function stackConfig(values: PresentationValues): Outcome<ResolvedPresentationConfig> {
  const input = record(values);
  if (input === undefined) return fail('config', 'The stack configuration must be an object.');
  if (Object.keys(input).some((key) => key !== 'gap'))
    return fail('config', 'The stack configuration only accepts gap.');
  if (!validGap(input.gap)) return fail('config', 'gap must be a bounded nonnegative integer.');
  return { ok: true, value: { values, fields: [], ports: [], operations: [] } };
}

function validGap(gap: unknown): boolean {
  if (gap === undefined) return true;
  return Number.isSafeInteger(gap) && (gap as number) >= 0 && (gap as number) <= 64;
}

export function hasFrozenFieldIds(result: Result): boolean {
  if (!Object.isFrozen(result)) return false;
  const fields = frozenOwnFieldArray(result);
  if (fields === undefined) return false;
  return fieldsHaveImmutableIds(fields);
}

function frozenOwnFieldArray(result: Result): readonly unknown[] | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(result, 'fields');
  if (descriptor === undefined || !('value' in descriptor)) return undefined;
  const fields: unknown = descriptor.value;
  if (!Array.isArray(fields) || !Object.isFrozen(fields)) return undefined;
  if (Object.getPrototypeOf(fields) !== Array.prototype) return undefined;
  if (Reflect.ownKeys(fields).length !== fields.length + 1) return undefined;
  return fields as readonly unknown[];
}

function fieldsHaveImmutableIds(fields: readonly unknown[]): boolean {
  for (let index = 0; index < fields.length; index++) {
    if (!hasFrozenFieldId(fields[index])) return false;
  }
  return true;
}

function hasFrozenFieldId(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || !Object.isFrozen(value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'id');
  return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string';
}

export function defaultTableConfig(
  output: Record<string, unknown>,
  fields: readonly string[],
  operations: readonly import('@varendo/core').VersionRef[],
): Outcome<ResolvedPresentationConfig> {
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      values: Object.freeze(output) as PresentationValues,
      fields: Object.freeze(fields),
      ports: Object.freeze([]),
      operations: Object.freeze(operations.map((operation) => Object.freeze({ ...operation }))),
    }),
  });
}
