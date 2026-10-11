import { parseWireValue } from '@varendo/core/contracts';
import type { PresentationPlan } from '@varendo/core';
import type {
  PresentationComposition,
  PresentationResolverCandidate,
  PresentationTargetEvidence,
  ValidatedPresentation,
} from '@varendo/core/presentation';
import type { RegionSnapshot } from '../regions/types.js';
import type { PresentationAdaptationContext, PresentationAdaptationTarget } from './adaptation-types.js';

function sameAddress(
  left: PresentationTargetEvidence['address'],
  right: PresentationTargetEvidence['address'],
): boolean {
  return (
    left.runtimeId === right.runtimeId &&
    left.scopeInstanceId === right.scopeInstanceId &&
    left.activationEpoch === right.activationEpoch &&
    left.surfaceId === right.surfaceId &&
    left.surfaceGeneration === right.surfaceGeneration
  );
}

export function resolverTarget(
  before: RegionSnapshot,
  target: PresentationAdaptationTarget | undefined,
): PresentationTargetEvidence {
  if (target === undefined)
    return {
      address: {
        runtimeId: 'runtime-adaptation',
        scopeInstanceId: before.id,
        activationEpoch: 0,
        surfaceId: before.id,
        surfaceGeneration: 0,
      },
      state: 'active',
    };
  let supplied: PresentationTargetEvidence;
  try {
    supplied = target.read();
  } catch {
    return { address: target.address, state: 'stale' };
  }
  if (target.address.surfaceId === before.id && sameAddress(supplied.address, target.address)) return supplied;
  return { address: target.address, state: 'stale' };
}

export function resolverCandidates(
  candidates: PresentationAdaptationContext['candidates'],
): readonly PresentationResolverCandidate[] {
  const owned = ownWire(candidates ?? []);
  if (!Array.isArray(owned)) return [invalidCandidate()];
  const safe = owned.filter(isLegacyCandidate);
  if (safe.length !== owned.length) return [invalidCandidate()];
  const entries = safe
    .map((candidate) => ({ candidate, key: canonicalCandidate(candidate) }))
    .sort((left, right) => compareCanonicalKey(left.key, right.key));
  const unique = entries.filter((entry, index) => index === 0 || entry.key !== entries[index - 1]!.key);
  const collisions = new Map<string, number>();
  return unique.map(({ candidate, key }) => {
    const digest = candidateDigest(key);
    const collision = collisions.get(digest) ?? 0;
    collisions.set(digest, collision + 1);
    return {
      id: legacyCandidateId(digest, collision),
      source: candidate.source,
      ...(candidate.pattern === undefined ? {} : { pattern: candidate.pattern }),
      plan: candidate.plan,
    };
  });
}

function ownWire(input: unknown): unknown | undefined {
  const inspected = parseWireValue(input);
  if (!inspected.ok) return undefined;
  try {
    return structuredClone(input);
  } catch {
    return undefined;
  }
}

function compareCanonicalKey(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function legacyCandidateId(digest: string, collision: number): string {
  if (collision === 0) return `legacy.${digest}`;
  return `legacy.${digest}.${collision}`;
}

function isLegacyCandidate(value: unknown): value is NonNullable<PresentationAdaptationContext['candidates']>[number] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.source === 'explicit' || record.source === 'pattern') &&
    record.plan !== null &&
    typeof record.plan === 'object' &&
    !Array.isArray(record.plan)
  );
}

function invalidCandidate(): PresentationResolverCandidate {
  return { id: 'legacy.invalid', source: 'explicit', plan: {} as PresentationPlan };
}

/**
 * Legacy candidate keys intentionally serialize undefined-valued properties as
 * `null` and `-0` as `0`: the emitted `legacy.*` candidate ids are observable
 * composition output, so this form stays JSON-compatible rather than adopting
 * the ../canonical.js evidence encoding.
 */
function canonicalCandidate(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalCandidate).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalCandidate((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

function candidateDigest(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function compositionForDecision(
  plan: ValidatedPresentation,
  examinedCandidates: number,
): PresentationComposition {
  return Object.freeze({ status: 'composed', presentation: plan, expansions: examinedCandidates, rejected: [] });
}
