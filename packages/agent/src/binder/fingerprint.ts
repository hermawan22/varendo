import { CONTRACT_VERSION, parseWireValue, type Task } from '@varendo/core';
import type { NormalizedHostContext } from './types.js';

type PlanIdentity = { readonly outputId: string; readonly canonical: string; readonly planKey: string };

function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

function digest(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return `agent-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function taskFingerprint(
  task: Task,
  context: NormalizedHostContext,
  plans: readonly PlanIdentity[] = [],
): string {
  return digest(
    canonical({
      version: CONTRACT_VERSION,
      task,
      authority: {
        principalKey: context.principalKey,
        scopeDigest: context.current.scopeDigest,
        policyRevision: context.current.policyRevision,
        catalogRevision: context.current.catalogRevision,
        experienceRevision: context.current.experienceRevision,
        functionRegistryDigest: context.current.functionRegistryDigest,
        regionId: context.regionId,
        regionRevision: context.current.regionRevision,
        results: context.current.results,
        goalEpoch: context.goalEpoch,
        grants: [...context.grants].sort(),
        decisions: context.decisions,
        queryLimits: context.planner.limits,
        catalog: context.catalog,
        functionRegistry: context.functionRegistry,
      },
      plans,
    }),
  );
}

export function candidateFingerprint(input: unknown): string {
  const wire = parseWireValue(input);
  if (wire.ok) return digest(canonical(wire.value));
  try {
    return digest(`invalid:${String(input)}`);
  } catch {
    return digest('invalid:candidate');
  }
}

export function authorityKey(context: NormalizedHostContext): string {
  return canonical({
    principalKey: context.principalKey,
    regionId: context.regionId,
    goalEpoch: context.goalEpoch,
    current: context.current,
    catalog: context.catalog,
    functionRegistry: context.functionRegistry,
    grants: [...context.grants].sort(),
    decisions: context.decisions,
    queryLimits: context.planner.limits,
  });
}
