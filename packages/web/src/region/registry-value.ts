import type { ResultRef } from '@varendo/core';

/** Compare exact result identity independently of object key order. */
export function resultRefKey(ref: ResultRef): string {
  return JSON.stringify([
    ref.id,
    ref.revision,
    ref.sourceLineage ?? null,
    ref.outputId,
    ref.queryDigest,
    ref.scopeDigest,
  ]);
}

/** Stable comparison protects equivalent descriptors with a different key order. */
export function canonicalValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(object[key])}`)
    .join(',')}}`;
}

export function freezeValue<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) freezeValue(child);
    Object.freeze(value);
  }
  return value;
}
