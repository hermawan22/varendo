import type { Outcome } from '../../contracts/types.js';
import type { PresentationContext, PresentationRegistry } from '../types.js';
import { stateMappingFor } from '../state.js';
import { presentationFailure as fail, versionKey } from '../registry.js';
import type { PreparedPresentationContext, PresentationPlanLike } from './types.js';
import { parseRendererCapabilities } from './shared.js';

interface TransitionChanges {
  readonly structural: boolean;
  readonly replacing: boolean;
  readonly configuration: boolean;
  readonly semantics: boolean;
}

function compareNodeIds(left: readonly unknown[], right: readonly unknown[]): number {
  const leftId = String(left[0]);
  const rightId = String(right[0]);
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}

function topology(plan: PresentationPlanLike): string {
  return JSON.stringify([plan.rootId, plan.nodes.map((node) => [node.id, node.children]).sort(compareNodeIds)]);
}

function representations(plan: PresentationPlanLike): string {
  return JSON.stringify(plan.nodes.map((node) => [node.id, node.role, versionKey(node.representation)]).sort());
}

function configurations(plan: PresentationPlanLike): string {
  return JSON.stringify(plan.nodes.map((node) => [node.id, node.config]).sort());
}

function semantics(plan: PresentationPlanLike): string {
  return JSON.stringify([plan.links, plan.coverage, plan.nodes.map((node) => [node.id, node.result]).sort()]);
}

function transitionChanges(oldPlan: PresentationPlanLike, nextPlan: PresentationPlanLike): TransitionChanges {
  return {
    structural: topology(oldPlan) !== topology(nextPlan),
    replacing: representations(oldPlan) !== representations(nextPlan),
    configuration: configurations(oldPlan) !== configurations(nextPlan),
    semantics: semantics(oldPlan) !== semantics(nextPlan),
  };
}

function anyChange(changes: TransitionChanges): boolean {
  return changes.structural || changes.replacing || changes.configuration || changes.semantics;
}

function validateTransitionPolicy(
  changes: TransitionChanges,
  context: PresentationContext,
  prepared: PreparedPresentationContext,
): Outcome<undefined> {
  if (!prepared.constraints.compositionChangeAllowed && changes.structural)
    return fail('transition', 'The experience mode forbids this presentation change.');
  if (!prepared.constraints.representationReplacementAllowed && changes.replacing)
    return fail('transition', 'The experience mode forbids this presentation change.');
  if (
    anyChange(changes) &&
    (context.transitionBlocked === true ||
      (prepared.constraints.transitionPolicy === 'explicit-only' && context.explicitTransition !== true))
  )
    return fail(
      'transition',
      'The presentation change must wait for the active interaction or an explicit user transition.',
    );
  return { ok: true, value: undefined };
}

function requireExistingOwners(
  oldPlan: PresentationPlanLike,
  nextPlan: PresentationPlanLike,
  changes: TransitionChanges,
): Outcome<undefined> {
  if (!anyChange(changes)) return { ok: true, value: undefined };
  for (const previous of oldPlan.nodes) {
    if (!nextPlan.stateTransfer.some((transfer) => transfer.fromNode === previous.id))
      return fail(
        'state-transfer',
        'Changing a presentation requires an explicit transfer or registered archival owner for every existing view identity.',
      );
  }
  return { ok: true, value: undefined };
}

function isIdentityTransfer(
  from: PresentationPlanLike['nodes'][number],
  to: PresentationPlanLike['nodes'][number],
  mapping: PresentationPlanLike['stateTransfer'][number]['mapping'],
): boolean {
  return (
    from.id === to.id &&
    from.role === to.role &&
    versionKey(from.representation) === versionKey(to.representation) &&
    mapping.id === 'aeliqo.state.identity' &&
    mapping.revision === '1'
  );
}

function validateTransfer(
  transfer: PresentationPlanLike['stateTransfer'][number],
  oldPlan: PresentationPlanLike,
  nodeById: ReadonlyMap<string, PresentationPlanLike['nodes'][number]>,
  registry: PresentationRegistry,
  context: PresentationContext,
): Outcome<undefined> {
  const from = oldPlan.nodes.find((node) => node.id === transfer.fromNode);
  const to = nodeById.get(transfer.toNode);
  if (from === undefined || to === undefined)
    return fail('state-transfer', 'The state transfer endpoint is unavailable.');
  const identity = isIdentityTransfer(from, to, transfer.mapping);
  const kind = nodeById.has(from.id) ? 'transfer' : 'archive';
  const registered = stateMappingFor(from, to, registry, context, kind);
  if (identity) return { ok: true, value: undefined };
  if (
    registered === undefined ||
    versionKey(registered.ref) !== versionKey(transfer.mapping) ||
    (registered.kind === 'transfer' && from.id !== to.id)
  )
    return fail('state-transfer', 'This state transfer has no exact registered renderer capability.');
  return { ok: true, value: undefined };
}

function validateTransfers(
  nextPlan: PresentationPlanLike,
  oldPlan: PresentationPlanLike,
  registry: PresentationRegistry,
  context: PresentationContext,
): Outcome<undefined> {
  const nodeById = new Map(nextPlan.nodes.map((node) => [node.id, node]));
  const transferred = new Set<string>();
  for (const transfer of nextPlan.stateTransfer) {
    if (transferred.has(transfer.fromNode))
      return fail('state-transfer', 'A view identity cannot be transferred twice.');
    transferred.add(transfer.fromNode);
    const checked = validateTransfer(transfer, oldPlan, nodeById, registry, context);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

export function validatePresentationTransition(
  plan: PresentationPlanLike,
  context: PresentationContext,
  prepared: PreparedPresentationContext,
  registry: PresentationRegistry,
): Outcome<undefined> {
  const incumbent = prepared.patternContext.incumbent;
  if (incumbent === undefined) {
    if (plan.stateTransfer.length > 0)
      return fail('state-transfer', 'State transfer requires an existing presentation.');
    return { ok: true, value: undefined };
  }

  const capabilities = parseRendererCapabilities(context.stateMappingCapabilities ?? []);
  if (!capabilities.ok) return capabilities;

  const changes = transitionChanges(incumbent, plan);
  const policy = validateTransitionPolicy(changes, context, prepared);
  if (!policy.ok) return policy;
  const owners = requireExistingOwners(incumbent, plan, changes);
  if (!owners.ok) return owners;
  return validateTransfers(plan, incumbent, registry, context);
}
