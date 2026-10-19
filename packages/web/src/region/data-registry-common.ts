import type { Outcome, Result, SemanticType } from '@varendo/core';
import type { InteractionPort } from '@varendo/core/interaction';
import type { VarendoDataResolvedConfig } from './data-registry-types.js';
import type { VarendoSelectionMode } from '../data/index.js';

export const MAX_DATA_ITEMS = 128;
const MAX_DATA_LABEL = 160;

export const failure = <T>(code: string, message: string): Outcome<T> => ({
  ok: false,
  diagnostics: [{ code: `web.data.${code}`, message, retryable: false }],
});

export function object(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function boundedText(value: unknown, field: string): Outcome<string> {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_DATA_LABEL ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return failure('config', `${field} must be bounded text.`);
  }
  return { ok: true, value };
}

export function fieldMap(result: Result): Map<string, Result['fields'][number]> {
  return new Map(result.fields.map((field) => [field.id, field]));
}

export function unitKey(type: SemanticType): string {
  if (type.unit === undefined) return '';
  return JSON.stringify([type.unit.dimension, type.unit.symbol, type.unit.currency ?? null]);
}

export const NUMERIC_TYPE_VALUES: ReadonlySet<SemanticType['value']> = new Set(['integer', 'float', 'decimal']);

export const COMPARISON_OPERATORS: ReadonlySet<string> = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']);

export function numeric(type: SemanticType): boolean {
  return NUMERIC_TYPE_VALUES.has(type.value);
}

export function validFieldList(raw: unknown, result: Result, field = 'fields'): Outcome<readonly string[]> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_DATA_ITEMS) {
    return failure('field', `${field} must name one or more result fields.`);
  }
  if (raw.some((value) => typeof value !== 'string' || value.length === 0)) {
    return failure('field', `${field} must name one or more result fields.`);
  }
  const values = raw as string[];
  const fields = fieldMap(result);
  if (new Set(values).size !== values.length || values.some((value) => !fields.has(value))) {
    return failure('field', `${field} must contain unique fields declared by the authorized Result.`);
  }
  return { ok: true, value: [...values] };
}

export function identityFields(input: Readonly<Record<string, unknown>>, result: Result): Outcome<readonly string[]> {
  if (!Object.hasOwn(input, 'identity')) return { ok: true, value: [...result.identity] };
  const checked = validFieldList(input.identity, result, 'identity');
  if (!checked.ok) return checked;
  if (JSON.stringify(checked.value) !== JSON.stringify(result.identity)) {
    return failure('identity', 'identity must exactly match the Result descriptor identity.');
  }
  return checked;
}

export function selection(input: Readonly<Record<string, unknown>>): Outcome<VarendoSelectionMode> {
  const value = input.selection ?? 'none';
  if (value !== 'none' && value !== 'single' && value !== 'multiple') {
    return failure('config', 'selection must be none, single or multiple.');
  }
  return { ok: true, value };
}

export function allowedKeys(input: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(input).every((key) => keys.includes(key));
}

export function commonConfig(
  input: Readonly<Record<string, unknown>>,
  config: Pick<VarendoDataResolvedConfig, 'fields' | 'columns' | 'identity' | 'selection'>,
  ports: readonly InteractionPort[] = [],
): VarendoDataResolvedConfig {
  return {
    values: input,
    fields: config.fields,
    columns: config.columns,
    identity: config.identity,
    selection: config.selection,
    ports,
  };
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
