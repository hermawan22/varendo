import type { Diagnostic, Outcome } from '@varendo/core';
import type { RuntimeCommittedReceipt, RuntimeRenderPreparation, RuntimePreparedRender } from '@varendo/runtime/app';
import type { WebRenderReceipt } from './types.js';
import { diagnostic, materialize, withoutDataRevision, type WebAppContext, type WebRegion } from './context.js';
import { resolveFormBindings } from './form-state.js';
import { preparePresentation } from './presentation-plan.js';
import { prepareRegisteredRenderer, type prepareRenderer } from './presentation-renderer.js';
import { prepareRenderContinuity } from './render-continuity.js';
import { retainAppInteraction } from './interaction-projection.js';

/** Candidate data remains unpublished until preparation and synchronous renderer application succeed. */
export function createRenderTransaction(
  context: WebAppContext,
  region: WebRegion,
  sequence: number,
  signal: AbortSignal,
  recheck: () => WebRenderReceipt | undefined,
  authority: string,
) {
  let preparedRenderer: ReturnType<typeof prepareRenderer> | undefined;
  let bindings: ReturnType<typeof materialize>;
  let inputs: Awaited<ReturnType<typeof resolveFormBindings>> | undefined;
  let rejected: WebRenderReceipt | undefined;
  const active = () => !signal.aborted && region.sequence === sequence && recheck() === undefined;
  async function prepare(candidate: RuntimeRenderPreparation): Promise<Outcome<RuntimePreparedRender>> {
    const receipt = candidateReceipt(candidate);
    bindings = materialize(receipt);
    if (bindings === undefined)
      return {
        ok: false,
        diagnostics: [diagnostic('web.app.materialization', 'The candidate Result is unavailable.')],
      };
    inputs = await resolveFormBindings(context, region, receipt, signal);
    if (!inputs.ok) {
      rejected = rejection(
        region,
        candidate.requestId,
        receipt.intent.kind === 'edit' ? 'needs-input' : 'failed',
        inputs.diagnostics,
      );
      return inputs;
    }
    const blocked = recheck();
    if (blocked !== undefined) {
      rejected = blocked;
      return { ok: false, diagnostics: [blocked.diagnostics[0] ?? diagnostic('web.app.cancelled', 'Cancelled.')] };
    }
    const continuity = prepareRenderContinuity({
      previousTask: region.last?.receipt.task,
      task: receipt.task,
      previous: region.element.presentation,
      interaction: postExitInteraction(region),
      current: withoutDataRevision(candidate.current),
      results: bindings.descriptors,
      bindings: bindings.results,
      previousAuthority: region.renderedAuthority,
      currentAuthority: authority,
    });
    if (!continuity.ok) return continuity;
    const prepared = preparePresentation(
      context,
      region,
      receipt,
      bindings.results,
      bindings.descriptors,
      ('present-' + candidate.requestId).slice(0, 160),
      sequence,
      inputs.value,
      true,
      continuity.value,
    );
    if (!prepared.ok) {
      rejected = rejection(region, candidate.requestId, prepared.status, prepared.diagnostics);
      return prepared;
    }
    const renderer = await prepareRegisteredRenderer(context, region, prepared.value, bindings.results, active);
    if (!renderer.ok) {
      rejected = recheck() ?? rejection(region, candidate.requestId, 'failed', renderer.diagnostics);
      return renderer;
    }
    preparedRenderer = renderer.value;
    return { ok: true, value: preparedRenderer.projection };
  }
  return {
    prepare,
    complete: (receipt: RuntimeCommittedReceipt) =>
      completeTransaction(region, receipt, preparedRenderer, bindings, inputs, active),
    rejected: () => rejected,
    close: () => preparedRenderer?.close(),
  };
}

function rejection(
  region: WebRegion,
  requestId: string,
  status: 'unsupported' | 'failed' | 'needs-input',
  diagnostics: readonly Diagnostic[],
): WebRenderReceipt {
  return { status, regionId: region.id, requestId, diagnostics };
}

function completeTransaction(
  region: WebRegion,
  receipt: RuntimeCommittedReceipt,
  preparedRenderer: ReturnType<typeof prepareRenderer> | undefined,
  bindings: ReturnType<typeof materialize>,
  inputs: Awaited<ReturnType<typeof resolveFormBindings>> | undefined,
  active: () => boolean,
): WebRenderReceipt {
  const presentation = preparedRenderer?.applied();
  if (!active() || presentation === undefined || bindings === undefined || !inputs?.ok)
    return {
      status: 'cancelled',
      regionId: region.id,
      requestId: receipt.requestId,
      diagnostics: [diagnostic('web.app.cancelled', 'A newer operation replaced the renderer transaction.')],
    };
  region.drafts.clear();
  delete region.actionAttempt;
  region.actionPending = false;
  retainAppInteraction(region, region.element.interaction);
  region.last = { receipt, ...bindings, ...(inputs.value === undefined ? {} : { inputs: inputs.value }) };
  return {
    status: 'renderer-ready',
    requestId: receipt.requestId,
    regionId: region.id,
    runtime: receipt,
    presentation,
    environment: presentation.environment,
    diagnostics: [],
  };
}

function candidateReceipt(candidate: RuntimeRenderPreparation): RuntimeCommittedReceipt {
  return {
    status: 'committed',
    requestId: candidate.requestId,
    regionId: candidate.regionId,
    intent: candidate.intent,
    task: candidate.task,
    outputs: candidate.outputs,
    region: { ...candidate.region, readSet: candidate.current },
    diagnostics: [],
  };
}

function postExitInteraction(region: WebRegion) {
  const state = region.element.interaction;
  if (state === undefined || region.drafts.size === 0) return state;
  // The exit guard has already accepted Save/Discard. Only the candidate drops
  // those drafts; the live previous UI keeps them until successful publication.
  return { ...state, drafts: [] };
}
