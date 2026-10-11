import type { Outcome, SemanticType } from '../types.js';
import { NUMERIC_TYPE_VALUES } from '../scalars.js';
export { resultRefKey, versionRefKey } from '../stable.js';

export const fail = (code: string, message: string): Outcome<never> => ({
  ok: false,
  diagnostics: [{ code: `visualization.${code}`, message, retryable: false }],
});

export const isNumeric = (type: SemanticType): boolean => NUMERIC_TYPE_VALUES.has(type.value);

export function isTemporal(type: SemanticType): boolean {
  if (type.value !== 'date' && type.value !== 'instant') return false;
  if (type.temporal === undefined) return false;
  return type.value !== 'instant' || type.temporal.timezone !== undefined;
}

export const semanticSignature = (type: SemanticType, nullable = true): string =>
  JSON.stringify([
    type.value,
    nullable ? type.nullable : undefined,
    type.unit?.dimension,
    type.unit?.symbol,
    type.unit?.currency,
    type.temporal?.calendar,
    type.temporal?.timezone,
    type.temporal?.grain,
  ]);

export function freezeOwned<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeOwned(child);
    Object.freeze(value);
  }
  return value;
}

export const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((id) => right.includes(id));
