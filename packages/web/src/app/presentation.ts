import type { Result, Task } from '@varendo/core';
import type { ValidatedPresentation, PresentationEnvironment } from '@varendo/core/presentation';
import type { RuntimeCommittedReceipt } from '@varendo/runtime/app';
import type { VarendoRegionResult } from '../region/types.js';
import type { VarendoInputBindings } from '../region/input-registry.js';
import type { WebRenderReceipt } from './types.js';
import { diagnostic, failedAfterRuntime, type WebAppContext, type WebRegion } from './context.js';
import { beginPresentation, presentationCurrent } from './presentation-operation.js';
import { preparePresentation } from './presentation-plan.js';
import { prepareRegisteredRenderer } from './presentation-renderer.js';
import { retainAppInteraction } from './interaction-projection.js';

export async function present(
  context: WebAppContext,
  region: WebRegion,
  receipt: RuntimeCommittedReceipt,
  results: readonly VarendoRegionResult[],
  descriptors: readonly Result[],
  requestId: string,
  expectedSequence: number,
  inputs?: VarendoInputBindings,
  signal?: AbortSignal,
): Promise<WebRenderReceipt> {
  const operation = beginPresentation(region, signal);
  const active = () => presentationCurrent(region, expectedSequence, operation);
  const cancelled = () =>
    failedAfterRuntime('cancelled', receipt, requestId, [
      diagnostic('web.app.cancelled', 'A newer web operation replaced this presentation.'),
    ]);
  let closeRenderer = () => {};
  try {
    if (!active()) return cancelled();
    const prepared = preparePresentation(
      context,
      region,
      receipt,
      results,
      descriptors,
      requestId,
      expectedSequence,
      inputs,
    );
    if (!prepared.ok) return failedAfterRuntime(prepared.status, receipt, requestId, prepared.diagnostics);
    const registered = await prepareRegisteredRenderer(context, region, prepared.value, results, active);
    if (!registered.ok)
      return failedAfterRuntime(active() ? 'failed' : 'cancelled', receipt, requestId, registered.diagnostics);
    const renderer = registered.value;
    closeRenderer = renderer.close;
    const committed = await context.runtime.commitPresentation({
      regionId: region.id,
      requestId,
      task: receipt.task,
      presentation: prepared.value.presentation.plan,
      interaction: renderer.projection.interaction ?? { version: '1', values: [], drafts: [] },
      projection: renderer.projection,
      signal: operation.signal,
    });
    if (!committed.ok) {
      const code = committed.diagnostics[0]?.code ?? '';
      const status = cancelledCommit(active(), code) ? 'cancelled' : 'failed';
      return failedAfterRuntime(status, receipt, requestId, committed.diagnostics);
    }
    return completedPresentation(
      region,
      receipt,
      requestId,
      prepared.value.environment,
      renderer.applied(),
      committed.value,
      active(),
    );
  } finally {
    try {
      closeRenderer();
    } finally {
      operation.close();
    }
  }
}

function completedPresentation(
  region: WebRegion,
  receipt: RuntimeCommittedReceipt,
  requestId: string,
  environment: PresentationEnvironment,
  presentation: ValidatedPresentation | undefined,
  committed: RuntimeCommittedReceipt['region'] & { readonly state?: { readonly task?: Task } },
  active: boolean,
): WebRenderReceipt {
  const task = committed.state?.task;
  if (!active || presentation === undefined || task === undefined)
    return failedAfterRuntime('cancelled', receipt, requestId, [
      diagnostic('web.app.cancelled', 'A newer web operation replaced this presentation.'),
    ]);
  retainAppInteraction(region, region.element.interaction);
  return {
    status: 'renderer-ready',
    requestId,
    regionId: region.id,
    runtime: { ...receipt, task, region: committed },
    presentation,
    environment,
    diagnostics: [],
  };
}

function cancelledCommit(active: boolean, code: string): boolean {
  return !active || /stale|cancelled/u.test(code);
}
