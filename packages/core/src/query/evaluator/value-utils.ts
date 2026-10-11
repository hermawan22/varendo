import { compareScalars, scalarIdentity } from '../../contracts/scalars.js';
import type { SemanticType } from '../../contracts/types.js';
import type { QueryValue } from '../types.js';
import { stable } from './shared.js';

const MAX_DECIMAL_DIGITS = 512;

function validDecimal(value: string): boolean {
  return /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value) && value.length <= MAX_DECIMAL_DIGITS;
}

export function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1]!;
}

function decimalParts(value: { readonly decimal: string }): { coefficient: bigint; scale: number } {
  const negative = value.decimal.startsWith('-');
  const unsigned = negative ? value.decimal.slice(1) : value.decimal;
  const [whole, fraction = ''] = unsigned.split('.');
  const sign = negative ? -1n : 1n;
  return { coefficient: BigInt(`${whole}${fraction}`) * sign, scale: fraction.length };
}

function decimalText(coefficient: bigint, scale: number): { readonly decimal: string } | undefined {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_DECIMAL_DIGITS) return undefined;
  const negative = coefficient < 0n;
  const magnitude = negative ? -coefficient : coefficient;
  const digits = magnitude.toString().padStart(scale + 1, '0');
  if (digits.length > MAX_DECIMAL_DIGITS) return undefined;
  const whole = scale === 0 ? digits : digits.slice(0, -scale) || '0';
  const fraction = scale === 0 ? '' : digits.slice(-scale).replace(/0+$/u, '');
  const text = `${negative ? '-' : ''}${whole}${fraction.length === 0 ? '' : `.${fraction}`}`;
  return validDecimal(text) ? { decimal: text } : undefined;
}

export function decimalAdd(
  left: { readonly decimal: string },
  right: { readonly decimal: string },
  sign = 1n,
): { readonly decimal: string } | undefined {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  const leftValue = a.coefficient * 10n ** BigInt(scale - a.scale);
  const rightValue = sign * b.coefficient * 10n ** BigInt(scale - b.scale);
  return decimalText(leftValue + rightValue, scale);
}

export function decimalMultiply(
  left: { readonly decimal: string },
  right: { readonly decimal: string },
): { readonly decimal: string } | undefined {
  const a = decimalParts(left);
  const b = decimalParts(right);
  return decimalText(a.coefficient * b.coefficient, a.scale + b.scale);
}

export function decimalIsZero(value: { readonly decimal: string }): boolean {
  return !/[1-9]/u.test(value.decimal);
}

export function isDecimal(value: QueryValue | undefined): value is { readonly decimal: string } {
  return value !== null && value !== undefined && typeof value === 'object';
}

export function compareValue(
  left: QueryValue | undefined,
  right: QueryValue | undefined,
  type: SemanticType | SemanticType['value'],
): number | undefined {
  if (left === undefined || right === undefined || left === null || right === null) return undefined;
  const semantic = typeof type === 'string' ? { value: type, nullable: true } : { ...type, nullable: true };
  const compared = compareScalars(left, right, semantic);
  return compared.ok && compared.value !== null ? compared.value : undefined;
}

export function inferredRuntimeType(value: QueryValue): SemanticType {
  if (isDecimal(value)) return { value: 'decimal', nullable: true };
  if (typeof value === 'number') return { value: 'float', nullable: true };
  if (typeof value === 'boolean') return { value: 'boolean', nullable: true };
  return { value: 'text', nullable: true };
}

export function scalarKey(value: QueryValue | undefined, type?: SemanticType['value']): string {
  if (value === undefined || value === null) return 'null';
  const inferred = type ?? inferredRuntimeType(value).value;
  const identity = scalarIdentity(value, { value: inferred, nullable: true });
  return identity.ok ? identity.value : stable(value);
}
