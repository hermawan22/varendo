import type { Expression, Outcome, SemanticType } from '../contracts/types.js';
import { semanticFailure } from '../semantics/errors.js';
import { validateSemanticType } from '../semantics/type-utils.js';
import type { TypedExpression } from './types.js';

type LiteralExpression = Extract<Expression, { kind: 'literal' }>;

export function checkLiteral(node: LiteralExpression, path: readonly (string | number)[]): Outcome<TypedExpression> {
  const typeCheck = validateSemanticType(node.type, [...path, 'type']);
  if (!typeCheck.ok) return typeCheck;
  if (node.value === null && !node.type.nullable)
    return semanticFailure('semantic.nullability', 'Null literal requires a nullable semantic type.', [
      ...path,
      'value',
    ]);
  if (node.value !== null) {
    const valueFailure = checkLiteralValue(node.type, node.value, path);
    if (valueFailure !== undefined) return valueFailure;
  }
  return { ok: true, value: { expression: node, type: node.type, context: 'row' } };
}

type LiteralChecker = (
  type: SemanticType,
  value: unknown,
  path: readonly (string | number)[],
) => Outcome<never> | undefined;

const LITERAL_CHECKERS: Readonly<Record<string, LiteralChecker>> = {
  integer: (_type, value, path) => checkIntegerLiteral(value, path),
  float: (_type, value, path) => checkFloatLiteral(value, path),
  boolean: (_type, value, path) => checkBooleanLiteral(value, path),
  text: (_type, value, path) => checkTextLiteral(value, path),
  date: checkDateLiteral,
  instant: checkInstantLiteral,
};

function checkLiteralValue(
  type: SemanticType,
  value: unknown,
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  const checker = LITERAL_CHECKERS[type.value];
  return checker !== undefined ? checker(type, value, path) : checkDecimalLiteral(value, path);
}

function checkIntegerLiteral(value: unknown, path: readonly (string | number)[]): Outcome<never> | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return undefined;
  return literalTypeFailure('Integer literals must be safe exact integers.', path);
}

function checkFloatLiteral(value: unknown, path: readonly (string | number)[]): Outcome<never> | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return undefined;
  return literalTypeFailure('Float literals must be finite numbers.', path);
}

function checkBooleanLiteral(value: unknown, path: readonly (string | number)[]): Outcome<never> | undefined {
  if (typeof value === 'boolean') return undefined;
  return literalTypeFailure('Boolean literals must be booleans.', path);
}

function checkTextLiteral(value: unknown, path: readonly (string | number)[]): Outcome<never> | undefined {
  if (typeof value === 'string') return undefined;
  return literalTypeFailure('Text/date/instant literals must be strings.', path);
}

function checkDecimalLiteral(value: unknown, path: readonly (string | number)[]): Outcome<never> | undefined {
  if (isDecimal(value)) return undefined;
  return literalTypeFailure('Decimal literals must use the exact decimal object representation.', path);
}

function checkDateLiteral(
  type: SemanticType,
  value: unknown,
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  if (typeof value !== 'string') return literalTypeFailure('Text/date/instant literals must be strings.', path);
  if (!isValidIsoDate(value))
    return semanticFailure(
      'semantic.literal-date',
      'Date literals must be valid proleptic-Gregorian ISO calendar dates.',
      [...path, 'value'],
    );
  return validateLiteralCalendar(type, path);
}

function checkInstantLiteral(
  type: SemanticType,
  value: unknown,
  path: readonly (string | number)[],
): Outcome<never> | undefined {
  if (typeof value !== 'string') return literalTypeFailure('Text/date/instant literals must be strings.', path);
  if (!isValidIsoInstant(value))
    return semanticFailure(
      'semantic.literal-instant',
      'Instant literals must be ISO datetimes with an explicit timezone offset.',
      [...path, 'value'],
    );
  return validateLiteralCalendar(type, path);
}

function validateLiteralCalendar(type: SemanticType, path: readonly (string | number)[]): Outcome<never> | undefined {
  if (type.temporal === undefined || type.temporal.calendar === 'gregorian') return undefined;
  if (type.value === 'date' && type.temporal.calendar === 'iso8601') return undefined;
  return semanticFailure(
    'semantic.temporal-calendar',
    'Non-Gregorian literal calendars require a registered temporal policy.',
    [...path, 'type', 'temporal', 'calendar'],
  );
}

function literalTypeFailure(message: string, path: readonly (string | number)[]): Outcome<never> {
  return semanticFailure('semantic.literal-type', message, [...path, 'value']);
}

function isDecimal(value: unknown): value is { readonly decimal: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'decimal' in value &&
    typeof value.decimal === 'string'
  );
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1]!;
}

function isValidIsoInstant(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (match === null || !isValidIsoDate(match[1]!)) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[5] === 'Z') return true;
  const offsetHour = Number(match[5]!.slice(1, 3));
  const offsetMinute = Number(match[5]!.slice(4, 6));
  return offsetHour <= 23 && offsetMinute <= 59;
}
