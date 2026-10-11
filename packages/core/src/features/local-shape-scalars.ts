import type { LocalDataFieldKind } from './local-shape.js';

function decimalObject(value: unknown): object | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 1 || keys[0] !== 'decimal') return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function decimalText(value: unknown): string | undefined {
  const decimalValue = decimalObject(value);
  if (decimalValue === undefined) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(decimalValue, 'decimal');
    if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') return undefined;
    if (descriptor.value.length > 512 || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(descriptor.value))
      return undefined;
    return descriptor.value;
  } catch {
    return undefined;
  }
}

export function decimal(value: unknown): boolean {
  return decimalText(value) !== undefined;
}

export function instant(value: string): string | undefined {
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/u.exec(value);
  if (parts === null) return undefined;
  const milliseconds = Date.parse(`${parts[1]}T${parts[2]}:${parts[3]}:${parts[4]}${parts[6]}`);
  if (!Number.isSafeInteger(milliseconds)) return undefined;
  return `instant:${milliseconds}:${(parts[5] ?? '').replace(/0+$/u, '')}`;
}

function canonicalDecimal(value: unknown): string | undefined {
  const text = decimalText(value);
  if (text === undefined) return undefined;
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');
  const trimmed = fraction.replace(/0+$/u, '');
  if (whole === '0' && trimmed.length === 0) return 'decimal:0';
  return `decimal:${negative ? '-' : ''}${whole}${trimmed.length === 0 ? '' : `.${trimmed}`}`;
}

function canonicalPrimitive(value: unknown, kind?: LocalDataFieldKind): string {
  switch (typeof value) {
    case 'number':
      return Object.is(value, -0) ? `${kind ?? 'number'}:0` : `${kind ?? 'number'}:${String(value)}`;
    case 'string':
      return `${kind ?? 'text'}:${value}`;
    case 'boolean':
      return `${kind ?? 'boolean'}:${value ? 'true' : 'false'}`;
    default:
      return 'unsupported';
  }
}

export function canonicalIdentity(value: unknown, kind?: LocalDataFieldKind): string {
  if (kind === 'decimal') {
    const decimalValue = canonicalDecimal(value);
    if (decimalValue !== undefined) return decimalValue;
  }
  if (kind === 'instant' && typeof value === 'string') return instant(value) ?? `text:${value}`;
  return canonicalPrimitive(value, kind);
}
