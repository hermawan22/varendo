import {
  WIRE_LIMITS,
  parseContract,
  validateCommitReadSet,
  type Catalog,
  type CommitPreconditions,
  type Outcome,
} from '@varendo/core';
import type { OperationGrant } from '@varendo/core/agent';
import { createQueryPlanner, type QueryLimits } from '@varendo/core/query';
import type { AgentBindingDecision, AgentHostContext } from '../binder-types.js';
import { isRecord } from '../guards.js';
import { failure, validId } from './common.js';
import { normalizeDecision } from './decision.js';
import type { NormalizedHostContext } from './types.js';

interface HostPins {
  readonly catalog: Catalog;
  readonly current: CommitPreconditions;
}

function hostObject(value: unknown): value is AgentHostContext {
  return isRecord(value);
}

function validHostIdentity(value: AgentHostContext): boolean {
  return (
    validId(value.regionId) &&
    validId(value.goalEpoch) &&
    typeof value.principalKey === 'string' &&
    value.principalKey.length > 0 &&
    value.principalKey.length <= WIRE_LIMITS.id * 4 &&
    !/[\u0000-\u001f\u007f]/u.test(value.principalKey)
  );
}

function normalizePins(value: AgentHostContext): Outcome<HostPins> {
  const catalog = parseContract('catalog', value.catalog);
  if (!catalog.ok) return failure('agent.denied', 'The host catalog is not a valid canonical descriptor.');
  const current = validateCommitReadSet(value.current, value.current);
  if (!current.ok) return failure('agent.denied', 'The host current preconditions are malformed.');
  return { ok: true, value: { catalog: catalog.value, current: current.value } };
}

function normalizeGrants(value: AgentHostContext['grants']): Outcome<OperationGrant[]> {
  if (!Array.isArray(value) || value.length > WIRE_LIMITS.array)
    return failure('agent.denied', 'The host grant list is malformed.');
  const grants: OperationGrant[] = [];
  for (const raw of value) {
    const checked = parseContract('operation-grant', JSON.stringify(raw));
    if (!checked.ok) return failure('agent.denied', 'The host grant list is malformed.');
    if (!grants.includes(checked.value)) grants.push(checked.value);
  }
  return { ok: true, value: grants };
}

function pinsMatch(value: AgentHostContext, pins: HostPins): boolean {
  return (
    pins.current.catalogRevision === pins.catalog.revision &&
    pins.current.functionRegistryDigest === value.functionRegistry.digest &&
    value.functionRegistry.digest === pins.catalog.functionRegistryDigest
  );
}

function createPlanner(value: AgentHostContext, catalog: Catalog, queryLimits?: Partial<QueryLimits>) {
  return createQueryPlanner({
    catalog,
    registry: value.functionRegistry,
    definitions: catalog.meanings,
    ...(queryLimits === undefined ? {} : { limits: queryLimits }),
  });
}

function normalizeDecisions(
  decisions: AgentHostContext['decisions'],
  goalEpoch: string,
): Outcome<readonly AgentBindingDecision[] | undefined> {
  if (decisions === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(decisions) || decisions.length > WIRE_LIMITS.array)
    return failure('agent.denied', 'The host binding decisions are malformed.');
  const normalized: AgentBindingDecision[] = [];
  for (const candidate of decisions) {
    const decision = normalizeDecision(candidate);
    if (decision === undefined) return failure('agent.denied', 'The host binding decisions are malformed.');
    if (decision.goalEpoch !== goalEpoch)
      return failure('agent.stale-decisions', 'The host binding decision belongs to a different goal epoch.');
    normalized.push(decision);
  }
  return { ok: true, value: Object.freeze(normalized) };
}

function normalizedContext(
  value: AgentHostContext,
  pins: HostPins,
  grants: readonly OperationGrant[],
  planner: ReturnType<typeof createQueryPlanner> extends Outcome<infer T> ? T : never,
  decisions: readonly AgentBindingDecision[] | undefined,
): NormalizedHostContext {
  return Object.freeze({
    principalKey: value.principalKey,
    regionId: value.regionId,
    goalEpoch: value.goalEpoch,
    current: pins.current,
    catalog: pins.catalog,
    functionRegistry: planner.registry,
    planner,
    grants: Object.freeze([...grants]),
    ...(decisions === undefined ? {} : { decisions }),
  });
}

/** Normalizes only host-owned authority data; every wire value remains untrusted. */
export function normalizeHost(
  value: AgentHostContext,
  queryLimits?: Partial<QueryLimits>,
): Outcome<NormalizedHostContext> {
  try {
    if (!hostObject(value)) return failure('agent.denied', 'The host authority context is unavailable.');
    if (!validHostIdentity(value)) return failure('agent.denied', 'The host authority context is malformed.');
    const pins = normalizePins(value);
    if (!pins.ok) return pins;
    const grants = normalizeGrants(value.grants);
    if (!grants.ok) return grants;
    if (!pinsMatch(value, pins.value))
      return failure('agent.stale', 'The host catalog or function registry does not match the current pins.');
    const planner = createPlanner(value, pins.value.catalog, queryLimits);
    if (!planner.ok) return failure('agent.denied', 'The host query registry is unavailable for semantic validation.');
    const decisions = normalizeDecisions(value.decisions, value.goalEpoch);
    if (!decisions.ok) return decisions;
    return {
      ok: true,
      value: normalizedContext(value, pins.value, grants.value, planner.value, decisions.value),
    };
  } catch {
    return failure('agent.denied', 'The host authority context could not be normalized safely.');
  }
}
