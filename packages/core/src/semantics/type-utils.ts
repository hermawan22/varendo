import * as z from 'zod/mini';
import { semanticTypeSchema } from '../contracts/schemas.js';
import { NUMERIC_TYPE_VALUES } from '../contracts/scalars.js';
import type { SemanticType } from '../contracts/types.js';
import type { TypedExpression } from '../expressions/types.js';
import { semanticFailure } from './errors.js';

export function isNumericType(type: SemanticType): boolean {
  return NUMERIC_TYPE_VALUES.has(type.value);
}

export function grainOf(type: SemanticType): readonly string[] {
  return type.grain ?? [];
}

export function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

export function sameUnit(left: SemanticType, right: SemanticType): boolean {
  if (left.unit === undefined || right.unit === undefined) return left.unit === right.unit;
  // `dimension` is not enough to establish additivity.  A host may expose
  // metres/kilometres or cents/dollars as distinct units, so conversion must
  // be an explicitly registered operation rather than an implicit cast.
  return (
    left.unit.dimension === right.unit.dimension &&
    left.unit.symbol === right.unit.symbol &&
    left.unit.currency === right.unit.currency
  );
}

/** Temporal metadata is part of a type's identity. */
export function sameTemporal(left: SemanticType, right: SemanticType): boolean {
  const a = left.temporal;
  const b = right.temporal;
  if (a === undefined || b === undefined) return a === b;
  return a.calendar === b.calendar && a.timezone === b.timezone && a.grain === b.grain;
}

export function compatibleType(actual: SemanticType, expected: SemanticType): boolean {
  if (actual.value !== expected.value && !(actual.value === 'integer' && expected.value === 'float')) return false;
  if (actual.nullable && !expected.nullable) return false;
  if (!sameUnit(actual, expected)) return false;
  if (!sameTemporal(actual, expected)) return false;
  return sameStringSet(grainOf(actual), grainOf(expected));
}

export function numericOutput(
  args: readonly TypedExpression[],
  options: { readonly unit?: SemanticType['unit']; readonly forceFloat?: boolean } = {},
): SemanticType {
  const nullable = args.some((arg) => arg.type.nullable);
  const representative =
    args.find((arg) => grainOf(arg.type).length > 0) ?? args.find((arg) => arg.type.unit !== undefined) ?? args[0];
  const grain = representative === undefined ? [] : grainOf(representative.type);
  const hasDecimal = args.some((arg) => arg.type.value === 'decimal');
  const hasFloat = args.some((arg) => arg.type.value === 'float');
  // Fractional operators explicitly request a float result. Ordinary decimal
  // arithmetic remains decimal; mixed decimal/float input is rejected by the
  // expression checker before this helper is called.
  let value: SemanticType['value'];
  if (options.forceFloat || hasFloat) value = 'float';
  else if (hasDecimal) value = 'decimal';
  else value = 'integer';
  return {
    value,
    nullable,
    grain,
    ...(options.unit === undefined ? {} : { unit: options.unit }),
  };
}

export function validateSemanticType(type: SemanticType, path: readonly (string | number)[] = []) {
  const parsed = z.safeParse(semanticTypeSchema, type);
  if (!parsed.success)
    return semanticFailure<SemanticType>(
      'semantic.type',
      'A semantic type does not match the canonical type contract.',
      path,
    );
  const canonical = parsed.data as SemanticType;
  if (canonical.grain !== undefined && new Set(canonical.grain).size !== canonical.grain.length)
    return semanticFailure<SemanticType>('semantic.type-grain', 'A semantic grain cannot repeat a dimension.', [
      ...path,
      'grain',
    ]);
  if (canonical.temporal !== undefined && canonical.value !== 'date' && canonical.value !== 'instant')
    return semanticFailure<SemanticType>(
      'semantic.type-temporal',
      'Temporal metadata is only valid for date or instant values.',
      [...path, 'temporal'],
    );
  return { ok: true, value: canonical } as const;
}
