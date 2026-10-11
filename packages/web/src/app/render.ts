import { guardDraftExit } from './draft-exit.js';
import { cancelActiveAction } from './interaction.js';
import { createRenderTransaction } from './render-transaction.js';
import { diagnostic, interactionLocked, type WebAppContext, type WebRegion } from './context.js';
import { present } from './presentation.js';
import { cancelPendingPresentation } from './presentation-operation.js';
import type { WebRenderInput, WebRenderReceipt } from './types.js';

function missingRegion(input: WebRenderInput): WebRenderReceipt {
  return {
    status: 'failed',
    regionId: input.regionId,
    requestId: 'render-' + input.regionId,
    diagnostics: [diagnostic('web.app.mount', 'Mount the Region before rendering.')],
  };
}

function beginRender(region: WebRegion, parent?: AbortSignal) {
  region.renderAbort?.abort();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  region.renderAbort = controller;
  return {
    signal: controller.signal,
    close() {
      parent?.removeEventListener('abort', abort);
      if (region.renderAbort === controller) delete region.renderAbort;
    },
  };
}

function renderCurrent(region: WebRegion, sequence: number, signal: AbortSignal): boolean {
  return sequence === region.sequence && !signal.aborted;
}

async function finishAdapt(context: WebAppContext, region: WebRegion, sequence: number, result: WebRenderReceipt) {
  if (result.status === 'renderer-ready' && region.pendingAdapt && sequence === region.sequence)
    return (await adaptRegion(context, region)) ?? result;
  return result;
}

export async function renderRequest(context: WebAppContext, input: WebRenderInput): Promise<WebRenderReceipt> {
  const region = context.regions.get(input.regionId);
  if (region === undefined) return missingRegion(input);
  const sequence = ++region.sequence;
  const operation = beginRender(region, input.signal);
  cancelPendingPresentation(region);
  let result: WebRenderReceipt;
  let transaction: ReturnType<typeof createRenderTransaction> | undefined;
  try {
    const guarded = await guardDraftExit(context, region, { ...input, signal: operation.signal }, operation.signal);
    if (!guarded.ok) return guarded.receipt;
    const blocked = guarded.current();
    if (blocked !== undefined) return blocked;
    cancelActiveAction(region);
    transaction = createRenderTransaction(
      context,
      region,
      sequence,
      operation.signal,
      guarded.current,
      guarded.authority,
    );
    const receipt = await context.runtime.render(guarded.input, { prepare: transaction.prepare });
    if (receipt.status !== 'committed') {
      if (receipt.status === 'denied') region.element.revoke();
      return transaction.rejected() ?? receipt;
    }
    const superseded = guarded.current();
    if (superseded !== undefined) return superseded;
    result = transaction.complete(receipt);
    if (result.status === 'renderer-ready' && renderCurrent(region, sequence, operation.signal)) guarded.committed();
  } finally {
    try {
      transaction?.close();
    } finally {
      operation.close();
    }
  }
  return finishAdapt(context, region, sequence, result);
}

export async function adaptRegion(context: WebAppContext, region: WebRegion): Promise<WebRenderReceipt | undefined> {
  if (context.disposed || context.regions.get(region.id) !== region) return undefined;
  if (
    region.renderAbort !== undefined ||
    region.presentationAbort !== undefined ||
    region.last === undefined ||
    interactionLocked(region)
  ) {
    region.pendingAdapt = true;
    return undefined;
  }
  region.pendingAdapt = false;
  const sequence = ++region.sequence;
  const requestId = ('adapt-' + region.id + '-' + sequence).slice(0, 160);
  cancelPendingPresentation(region);
  const result = await present(
    context,
    region,
    region.last.receipt,
    region.last.results,
    region.last.descriptors,
    requestId,
    sequence,
    region.last.inputs,
  );
  if (result.status === 'renderer-ready') region.last = { ...region.last, receipt: result.runtime };
  return finishAdapt(context, region, sequence, result);
}
