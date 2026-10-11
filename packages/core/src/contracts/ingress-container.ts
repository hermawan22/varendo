import { wireFailure } from '../diagnostics/wire.js';
import { WIRE_LIMITS as L } from './limits.js';
import type { Outcome } from './types.js';
import { pathParts, type WirePath } from './ingress-walk-types.js';

export type WireContainer = { readonly isArray: boolean; readonly keys: PropertyKey[] };
export type WireProperty = { readonly value: unknown };

function arrayLength(current: object): number {
  return (Object.getOwnPropertyDescriptor(current, 'length')?.value as number | undefined) ?? -1;
}

export function inspectContainer(current: object, path: WirePath | undefined): Outcome<WireContainer> {
  const isArray = Array.isArray(current);
  const prototype = Object.getPrototypeOf(current) as unknown;
  if (prototype !== (isArray ? Array.prototype : Object.prototype) && !(prototype === null && !isArray))
    return wireFailure('wire.object', 'Only plain JSON objects and arrays are accepted.', pathParts(path));

  const keys = Reflect.ownKeys(current);
  const length = arrayLength(current);
  if (isArray && (length > L.array || keys.length !== length + 1))
    return wireFailure('wire.array', 'Invalid array.', pathParts(path));
  if (!isArray && keys.length > L.properties)
    return wireFailure('wire.properties', 'A wire object exceeds its property limit.', pathParts(path));
  return { ok: true, value: { isArray, keys } };
}

function isArrayIndex(key: string, length: number): boolean {
  return /^(?:0|[1-9][0-9]*)$/.test(key) && +key < length;
}

export function inspectProperty(
  current: object,
  key: PropertyKey,
  isArray: boolean,
  path: WirePath | undefined,
): Outcome<WireProperty | undefined> {
  if (typeof key !== 'string') return wireFailure('wire.key', 'Symbol keys are not wire data.', pathParts(path));
  if (isArray && key === 'length') return { ok: true, value: undefined };
  if (key.length > L.id || key === '__proto__')
    return wireFailure('wire.key', 'A wire property name is not supported.', pathParts(path));
  if (isArray && !isArrayIndex(key, arrayLength(current)))
    return wireFailure('wire.array', 'Extra array properties are not accepted.', pathParts(path));

  const descriptor = Object.getOwnPropertyDescriptor(current, key);
  if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
    return wireFailure('wire.accessor', 'Accessors and hidden properties are not wire data.', [
      ...pathParts(path),
      key,
    ]);
  return { ok: true, value: descriptor as WireProperty };
}
