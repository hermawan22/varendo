import type { InteractionState } from '@varendo/core';
import type { ValidatedPresentation } from '@varendo/core/presentation';
import { projectInteractionState } from '@varendo/runtime/presentation';
import type { WebRegion } from './context.js';

function ownership(presentation: ValidatedPresentation): string {
  const { regionRevision: _regionRevision, ...pins } = presentation.plan.preconditions;
  return JSON.stringify({
    pins,
    root: presentation.plan.rootId,
    nodes: presentation.nodes,
    graph: presentation.graph,
  });
}

export function projectAppInteraction(region: WebRegion, next: ValidatedPresentation) {
  const previous = region.element.presentation;
  // The resolver's unchanged incumbent deliberately has no transition operations.
  // Exact validated semantics and result pins still own the existing state.
  if (previous !== undefined && next.plan.stateTransfer.length === 0 && ownership(previous) === ownership(next))
    return { ok: true as const, value: region.element.interaction };
  return projectInteractionState(previous, next, region.element.interaction);
}

/** Publish only after the renderer succeeded under the current operation fence. */
export function retainAppInteraction(region: WebRegion, state: InteractionState | undefined): void {
  region.values.clear();
  for (const { nodeId, portId, payload } of state?.values ?? []) {
    if (
      payload.kind === 'selection' ||
      payload.kind === 'filter' ||
      payload.kind === 'range' ||
      payload.kind === 'group' ||
      payload.kind === 'page'
    )
      region.values.set(JSON.stringify([nodeId, portId]), { nodeId, portId, payload });
  }
}
