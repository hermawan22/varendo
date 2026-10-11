import type { InteractionState, Outcome, Scalar, VersionRef } from '@varendo/core';
import type { InteractionPort } from '@varendo/core/interaction';
import type { ValidatedPresentation } from '@varendo/core/presentation';
import { canonicalJson as canonical } from '../canonical.js';
import type { RegionContent, RegionOutcome } from '../regions/types.js';

const failure = <T>(code: string, message: string): RegionOutcome<T> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false }],
});

const endpointKey = (nodeId: string, portId: string): string => JSON.stringify([nodeId, portId]);

function samePortShape(left: InteractionPort, right: InteractionPort): boolean {
  const shape = (port: InteractionPort): unknown => ({
    payload: port.payload,
    ...(port.entity === undefined ? {} : { entity: port.entity }),
    ...(port.identity === undefined ? {} : { identity: port.identity }),
    ...(port.grain === undefined ? {} : { grain: port.grain }),
    ...(port.type === undefined ? {} : { type: port.type }),
    ...(port.extension === undefined ? {} : { extension: port.extension }),
  });
  return canonical(shape(left)) === canonical(shape(right));
}

function nodesById(presentation: ValidatedPresentation): ReadonlyMap<string, ValidatedPresentation['nodes'][number]> {
  return new Map(presentation.nodes.map((node) => [node.node.id, node]));
}

function transferFor(
  plan: ValidatedPresentation['plan'],
  fromNode: string,
): ValidatedPresentation['plan']['stateTransfer'][number] | undefined {
  return plan.stateTransfer.find((transfer) => transfer.fromNode === fromNode);
}

function targetPort(
  source: InteractionPort,
  targetNode: ValidatedPresentation['nodes'][number],
): InteractionPort | undefined {
  const exact = targetNode.config.ports.find(
    (candidate) => candidate.id === source.id && samePortShape(source, candidate),
  );
  if (exact !== undefined) return exact;
  const matches = targetNode.config.ports.filter((candidate) => samePortShape(source, candidate));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * An interaction value is durable only when its target port still has the
 * same declared semantic shape.  A renderer may rename a compatible port,
 * but it may never drop or reinterpret an active value silently.
 */
export function projectInteractionState(
  previous: ValidatedPresentation | undefined,
  next: ValidatedPresentation,
  interaction: InteractionState | undefined,
): RegionOutcome<InteractionState | undefined> {
  if (interaction === undefined) return { ok: true, value: undefined };
  if (previous === undefined) {
    if (interaction.values.length > 0)
      return failure('runtime.presentation-state', 'Interaction state has no previous presentation owner.');
    return { ok: true, value: interaction };
  }
  const previousNodes = nodesById(previous);
  const nextNodes = nodesById(next);
  const projected = [] as InteractionState['values'][number][];
  const seen = new Set<string>();
  for (const value of interaction.values) {
    const sourceNode = previousNodes.get(value.nodeId);
    const transfer = transferFor(next.plan, value.nodeId);
    if (sourceNode === undefined || transfer === undefined)
      return failure(
        'runtime.presentation-state',
        `Interaction state for ${value.nodeId} has no declared state transfer.`,
      );
    const target = nextNodes.get(transfer.toNode);
    const source = sourceNode.config.ports.find(
      (port) => port.id === value.portId && port.payload === value.payload.kind,
    );
    if (target === undefined || source === undefined)
      return failure(
        'runtime.presentation-state',
        `Interaction state for ${value.nodeId}/${value.portId} has no compatible target port.`,
      );
    const destination = targetPort(source, target);
    if (destination === undefined)
      return failure(
        'runtime.presentation-state',
        `The renderer cannot preserve interaction state for ${value.nodeId}/${value.portId}.`,
      );
    const key = endpointKey(target.node.id, destination.id);
    if (seen.has(key))
      return failure(
        'runtime.presentation-state',
        'Two transferred interaction values would own the same target port.',
      );
    seen.add(key);
    projected.push(Object.freeze({ ...value, nodeId: target.node.id, portId: destination.id }));
  }
  return {
    ok: true,
    value: Object.freeze({
      version: interaction.version,
      values: Object.freeze(projected),
      drafts: interaction.drafts,
    }),
  };
}

export interface PresentationNavigationState {
  readonly route: VersionRef;
  readonly params: Readonly<Record<string, Scalar>>;
  readonly nodeId?: string;
}

/** Preserve an application-owned navigation target across a declared transfer. */
export function projectNavigationState(
  previous: ValidatedPresentation | undefined,
  next: ValidatedPresentation,
  navigation: PresentationNavigationState | undefined,
): RegionOutcome<PresentationNavigationState | undefined> {
  if (navigation === undefined || navigation.nodeId === undefined) return { ok: true, value: navigation };
  if (previous === undefined)
    return failure('runtime.presentation-navigation', 'Navigation state has no previous presentation owner.');
  const transfer = transferFor(next.plan, navigation.nodeId);
  if (transfer === undefined || !nodesById(next).has(transfer.toNode))
    return failure('runtime.presentation-navigation', 'Navigation state has no declared target owner.');
  return { ok: true, value: Object.freeze({ ...navigation, nodeId: transfer.toNode }) };
}

export interface PresentationProjectionState {
  readonly presentation: ValidatedPresentation;
  readonly interaction?: InteractionState;
  readonly navigation?: PresentationNavigationState;
}

export interface PresentationProjectionInput {
  readonly previous?: PresentationProjectionState;
  readonly next: PresentationProjectionState;
  readonly signal: AbortSignal;
}

/**
 * A renderer prepares a projection without publishing it. `apply` is called
 * by the final synchronous RegionHandle.commit recheck, immediately before
 * the canonical swap, and `rollback` is called for every failed commit; this
 * keeps a failed adaptation from leaving visible and canonical state at
 * different revisions. Implementations must make apply/rollback synchronous.
 */
export interface PreparedPresentationProjection {
  /** Apply the prepared projection; a commit recheck may supply final revisions. */
  apply(next?: PresentationProjectionState): RegionOutcome<void>;
  rollback(): void;
}

export interface PresentationRenderer {
  prepare(input: PresentationProjectionInput): RegionOutcome<PreparedPresentationProjection>;
  clear(reason?: string): void;
}

export interface CallbackPresentationRendererOptions {
  readonly apply: (
    next: PresentationProjectionState,
    previous: PresentationProjectionState | undefined,
  ) => Outcome<void> | void;
  readonly rollback?: (previous: PresentationProjectionState | undefined, next: PresentationProjectionState) => void;
  /** Required for callbacks that publish visible/private data; omit only for headless instrumentation. */
  readonly clear?: (reason?: string) => void;
}

/** Wrap an application/DOM projection in the renderer prepare/rollback contract. */
export function createCallbackPresentationRenderer(options: CallbackPresentationRendererOptions): PresentationRenderer {
  let epoch = 0;
  return {
    prepare(input) {
      if (input.signal.aborted)
        return failure('runtime.presentation-cancelled', 'The renderer preparation was cancelled.');
      const preparedEpoch = epoch;
      let applied = false;
      let appliedState: PresentationProjectionState | undefined;
      return {
        ok: true,
        value: {
          apply: (next = input.next) => {
            if (input.signal.aborted || epoch !== preparedEpoch)
              return failure('runtime.presentation-cancelled', 'The renderer application was cancelled.');
            if (applied) return { ok: true, value: undefined };
            // Mark the transaction before calling host code. A callback may
            // mutate the DOM and then throw; rollback must still run.
            applied = true;
            appliedState = next;
            try {
              const outcome = options.apply(next, input.previous);
              if (outcome !== undefined && !outcome.ok) return outcome as RegionOutcome<void>;
              return { ok: true, value: undefined };
            } catch {
              return failure('runtime.presentation-renderer', 'The renderer could not apply the prepared projection.');
            }
          },
          rollback: () => {
            if (!applied || epoch !== preparedEpoch) return;
            applied = false;
            const state = appliedState ?? input.next;
            appliedState = undefined;
            try {
              options.rollback?.(input.previous, state);
            } catch {
              /* rollback is best effort; revoke clears the surface */
            }
          },
        },
      };
    },
    clear(reason) {
      // Revocation invalidates pending apply/rollback closures before host code.
      epoch++;
      try {
        options.clear?.(reason);
      } catch {
        /* clearing a revoked surface cannot repair authorization */
      }
    },
  };
}

export function projectRegionContent(
  previousContent: RegionContent,
  previousPresentation: ValidatedPresentation | undefined,
  next: ValidatedPresentation,
): RegionOutcome<RegionContent> {
  const interaction = projectInteractionState(previousPresentation, next, previousContent.interaction);
  if (!interaction.ok) return interaction;
  return {
    ok: true,
    value: Object.freeze({
      task: previousContent.task,
      presentation: next.plan,
      ...(interaction.value === undefined ? {} : { interaction: interaction.value }),
    }),
  };
}
