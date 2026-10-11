import type { Outcome } from '@varendo/core';
import type { NarrativeAuthority } from './types.js';

export function fail<T>(code: string, message: string): Outcome<T> {
  return {
    ok: false,
    diagnostics: [{ code: `agent.narrative.${code}`, message, retryable: false }],
  };
}

function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

export function pins(context: NarrativeAuthority): string {
  return canonical([
    context.principalKey,
    context.scopeDigest,
    context.policyRevision,
    context.catalogRevision,
    context.functionRegistryDigest,
    [...context.grants].sort(),
  ]);
}

export function authorized(context: NarrativeAuthority): boolean {
  const pins = [context.principalKey, context.scopeDigest, context.catalogRevision, context.functionRegistryDigest];
  return (
    pins.every((value) => typeof value === 'string' && value.length > 0) && context.grants.includes('result.inspect')
  );
}
