import { WIRE_LIMITS } from '@varendo/core';
import type { RegionSnapshot } from '../regions/types.js';
import { failure, validText } from './controller-common.js';
import type { InteractionHostContext, InteractionOutcome } from './types.js';

type HostReader = () => InteractionHostContext;

const ACTOR_KINDS: ReadonlySet<unknown> = new Set(['user', 'service', 'system']);

function validActor(value: unknown): value is InteractionHostContext['actor'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actor = value as Record<string, unknown>;
  return validText(actor.id) && ACTOR_KINDS.has(actor.kind);
}

function validGrants(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= WIRE_LIMITS.array && value.every(validText);
}

function validResults(value: unknown, scopeDigest: string): value is InteractionHostContext['results'] {
  return (
    Array.isArray(value) &&
    value.length <= WIRE_LIMITS.array &&
    value.every((ref) => ref !== null && typeof ref === 'object' && ref.scopeDigest === scopeDigest)
  );
}

function validHost(value: unknown): value is InteractionHostContext {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const host = value as Record<string, unknown>;
  return validHostIdentity(host) && validHostAuthority(host) && validResults(host.results, host.scopeDigest as string);
}

function validHostIdentity(host: Record<string, unknown>): boolean {
  return validText(host.principalKey) && validText(host.draftDomain) && validActor(host.actor);
}

function validHostAuthority(host: Record<string, unknown>): boolean {
  return (
    validGrants(host.grants) &&
    validText(host.scopeDigest) &&
    validText(host.policyRevision) &&
    validText(host.catalogRevision) &&
    validText(host.experienceRevision) &&
    validText(host.functionRegistryDigest)
  );
}

function sameReadSet(host: InteractionHostContext, snapshot: RegionSnapshot): boolean {
  const readSet = snapshot.readSet;
  return (
    readSet !== undefined &&
    host.catalogRevision === readSet.catalogRevision &&
    host.experienceRevision === readSet.experienceRevision &&
    host.functionRegistryDigest === readSet.functionRegistryDigest &&
    host.scopeDigest === readSet.scopeDigest &&
    host.policyRevision === readSet.policyRevision
  );
}

function ownHost(host: InteractionHostContext): InteractionHostContext {
  return Object.freeze({
    ...host,
    actor: Object.freeze({ id: host.actor.id, kind: host.actor.kind }),
    grants: Object.freeze([...host.grants]),
    results: Object.freeze(host.results.map((ref) => Object.freeze({ ...ref }))),
  });
}

export function readInteractionHost(
  snapshot: RegionSnapshot,
  readContext: HostReader,
): InteractionOutcome<InteractionHostContext> {
  let value: unknown;
  try {
    value = readContext();
  } catch {
    return failure('runtime.interaction-denied', 'The host interaction context could not be read.');
  }
  if (!validHost(value))
    return failure('runtime.interaction-denied', 'The host interaction context is not bounded or current.');
  if (!sameReadSet(value, snapshot))
    return failure('runtime.interaction-stale', 'The host interaction context is stale against the region.');
  // Own a bounded snapshot so host mutation during async work cannot alter the authorization.
  return { ok: true, value: ownHost(value) };
}

function sameTrustedContext(expected: InteractionHostContext, current: InteractionHostContext): boolean {
  return (
    expected.principalKey === current.principalKey &&
    expected.draftDomain === current.draftDomain &&
    expected.actor.id === current.actor.id &&
    expected.actor.kind === current.actor.kind &&
    expected.scopeDigest === current.scopeDigest &&
    expected.policyRevision === current.policyRevision &&
    expected.catalogRevision === current.catalogRevision &&
    expected.experienceRevision === current.experienceRevision &&
    expected.functionRegistryDigest === current.functionRegistryDigest
  );
}

function hasGrant(context: InteractionHostContext, grant: string): boolean {
  return context.grants.includes(grant);
}

export function currentInteractionHost(
  snapshot: RegionSnapshot,
  expected: InteractionHostContext,
  requiredGrants: readonly string[],
  readContext: HostReader,
): InteractionOutcome<InteractionHostContext> {
  const current = readInteractionHost(snapshot, readContext);
  if (!current.ok) return current;
  if (!sameTrustedContext(expected, current.value))
    return failure(
      'runtime.interaction-stale',
      'The trusted interaction context changed while the interaction was awaiting host work.',
    );
  for (const grant of requiredGrants) {
    if (!hasGrant(current.value, grant))
      return failure('runtime.interaction-denied', 'The host no longer grants ' + grant + '.');
  }
  return current;
}
