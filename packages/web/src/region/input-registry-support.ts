import {
  parseWireValue,
  validateScalar,
  type Outcome,
  type ReadonlyJsonValue,
  type Scalar,
  type SemanticType,
  type VersionRef,
} from '@varendo/core';
import type { AeliqoOption } from '../input/options.js';
import type { AeliqoInputDraftBinding } from './input-registry-types.js';

export const fail = <T>(code: string, message: string): Outcome<T> => ({
  ok: false,
  diagnostics: [{ code: `web.input.${code}`, message, retryable: false }],
});

export const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

export const boundedText = (value: unknown, max = 512, required = false): value is string =>
  typeof value === 'string' &&
  value.length <= max &&
  (!required || value.length > 0) &&
  !/[\u0000-\u001f\u007f]/u.test(value);

export const boundedId = (value: unknown, required = true): value is string => boundedText(value, 160, required);

export const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

export const versionRef = (value: unknown): value is VersionRef => {
  const candidate = record(value);
  return (
    candidate !== undefined &&
    Object.keys(candidate).length === 2 &&
    boundedId(candidate.id) &&
    boundedText(candidate.revision, 160, true)
  );
};

function validSemanticBase(candidate: Record<string, unknown>): boolean {
  return (
    exactKeys(candidate, ['value', 'nullable', 'unit', 'grain', 'temporal']) &&
    ['text', 'boolean', 'integer', 'float', 'decimal', 'date', 'instant'].includes(String(candidate.value)) &&
    typeof candidate.nullable === 'boolean'
  );
}

function validSemanticUnit(value: unknown): boolean {
  if (value === undefined) return true;
  const unit = record(value);
  return (
    unit !== undefined &&
    exactKeys(unit, ['dimension', 'symbol', 'currency']) &&
    boundedId(unit.dimension) &&
    boundedText(unit.symbol, 160, true) &&
    (unit.currency === undefined || boundedId(unit.currency))
  );
}

function validSemanticGrain(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((item) => boundedId(item)) && new Set(value).size === value.length;
}

function validSemanticTemporal(value: unknown, type: unknown): boolean {
  if (value === undefined) return true;
  const temporal = record(value);
  if (temporal === undefined) return false;
  return (
    exactKeys(temporal, ['calendar', 'timezone', 'grain']) &&
    boundedId(temporal.calendar) &&
    (temporal.timezone === undefined || boundedId(temporal.timezone)) &&
    (temporal.grain === undefined || boundedId(temporal.grain)) &&
    ['date', 'instant'].includes(String(type))
  );
}

export function semanticType(value: unknown): value is SemanticType {
  const candidate = record(value);
  if (candidate === undefined || !validSemanticBase(candidate)) return false;
  return (
    validSemanticUnit(candidate.unit) &&
    validSemanticGrain(candidate.grain) &&
    validSemanticTemporal(candidate.temporal, candidate.value)
  );
}

export const jsonRecord = (value: unknown): value is Readonly<Record<string, ReadonlyJsonValue>> => {
  const candidate = record(value);
  if (candidate === undefined || Object.keys(candidate).length > 128) return false;
  return Object.keys(candidate).every((key) => boundedId(key)) && parseWireValue(candidate).ok;
};

export function clone<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) clone(child);
    Object.freeze(value);
  }
  return value;
}

export function copyJson(value: unknown): unknown {
  const parsed = parseWireValue(value);
  if (!parsed.ok) return undefined;
  const copy = (candidate: unknown): unknown => {
    if (candidate === null || typeof candidate !== 'object') return candidate;
    if (Array.isArray(candidate)) return candidate.map((item) => copy(item));
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(candidate)) output[key] = copy((candidate as Record<string, unknown>)[key]);
    return output;
  };
  return copy(parsed.value);
}

export function optionList(value: unknown): value is readonly AeliqoOption[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return false;
  const seen = new Set<string>();
  return value.every((item) => {
    const option = record(item);
    if (
      option === undefined ||
      !exactKeys(option, ['value', 'label', 'description', 'disabled']) ||
      !boundedText(option.value, 256, true) ||
      !boundedText(option.label, 512, true) ||
      seen.has(option.value)
    )
      return false;
    if (option.description !== undefined && !boundedText(option.description, 1024)) return false;
    if (option.disabled !== undefined && typeof option.disabled !== 'boolean') return false;
    seen.add(option.value);
    return true;
  });
}

export function numericText(value: unknown): boolean {
  if (value === undefined) return true;
  return typeof value === 'string' && value.length <= 512 && /^(?:[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)?$/u.test(value);
}

export function finiteNumber(
  value: unknown,
  minimum = -Number.MAX_SAFE_INTEGER,
  maximum = Number.MAX_SAFE_INTEGER,
): boolean {
  if (value === undefined) return true;
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function dateValue(value: unknown): boolean {
  if (value === undefined || value === '') return true;
  if (!boundedText(value, 10, true) || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function validCommonLabel(value: Record<string, unknown>, required: boolean): boolean {
  if (required) return boundedText(value.label, 512, true);
  return value.label === undefined || boundedText(value.label, 512);
}

function validCommonFlags(value: Record<string, unknown>): boolean {
  if (value.required !== undefined && typeof value.required !== 'boolean') return false;
  if (value.disabled !== undefined && typeof value.disabled !== 'boolean') return false;
  if (value.readOnly !== undefined && typeof value.readOnly !== 'boolean') return false;
  return true;
}

function validCommonValues(value: Record<string, unknown>, requireLabel: boolean): boolean {
  if (!validCommonLabel(value, requireLabel)) return false;
  if (value.description !== undefined && !boundedText(value.description, 2048)) return false;
  if (!validCommonFlags(value)) return false;
  if (value.name === undefined) return true;
  return boundedText(value.name, 128);
}

export function commonConfig(
  value: Record<string, unknown>,
  keys: readonly string[],
  requireLabel = true,
  includeCommon = true,
): boolean {
  const allowed = includeCommon ? ['label', 'description', 'required', 'disabled', 'readOnly', 'name', ...keys] : keys;
  if (!exactKeys(value, allowed)) return false;
  if (!includeCommon) return true;
  return validCommonValues(value, requireLabel);
}

export function typeValue(type: SemanticType, value: unknown, allowEmpty = true): Outcome<Scalar | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (allowEmpty && value === '') return { ok: true, value: '' };
  const checked = validateScalar(value, type);
  return checked.ok ? checked : fail('binding', 'A bound default/value does not satisfy its registered semantic type.');
}

export function numberValue(type: SemanticType, value: unknown): Outcome<Scalar | undefined> {
  if (value === undefined || value === '') return { ok: true, value: undefined };
  if (typeof value !== 'string' || !/^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value))
    return fail('binding', 'Number values must be canonical numeric text.');
  const candidate: unknown = type.value === 'decimal' ? { decimal: value } : Number(value);
  return typeValue(type, candidate, false);
}

export function fieldBinding(value: unknown, path: string): Outcome<AeliqoInputDraftBinding> {
  const field = record(value);
  if (
    field === undefined ||
    !exactKeys(field, ['entity', 'key', 'field', 'entityRevision', 'type']) ||
    !boundedId(field.entity) ||
    !boundedText(field.key, 512, true) ||
    !boundedId(field.field) ||
    !boundedText(field.entityRevision, 160, true) ||
    !semanticType(field.type)
  )
    return fail('binding', `${path} must be a complete registered semantic field binding.`);
  return {
    ok: true,
    value: clone({
      entity: field.entity,
      key: field.key,
      field: field.field,
      entityRevision: field.entityRevision,
      type: field.type,
    }),
  };
}
