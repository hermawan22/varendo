import type { AgentStopReason } from '@varendo/core/agent';
import type { AgentSessionReceipt, AgentRecoveryReceipt } from './types.js';
import { awaitBoundary, elapsed } from './helpers.js';
import { defaultRecovery, normalizeRecovery } from './recovery.js';
import type { SessionRunContext } from './run-types.js';

function needsRecovery(reason: AgentStopReason): boolean {
  return reason !== 'complete' && reason !== 'needs-choice' && reason !== 'needs-meaning';
}

async function recoveryFor(
  context: SessionRunContext,
  reason: AgentStopReason,
): Promise<AgentRecoveryReceipt | undefined> {
  if (!needsRecovery(reason)) return undefined;
  const recover = context.state.options.recover;
  if (recover === undefined) return defaultRecovery();
  const remaining = Math.max(1, context.budget.maxMilliseconds - elapsed(context.start, context.state.now));
  const recovered = await awaitBoundary(
    (signal) => recover({ receipt: context.last, incumbent: context.input.incumbent, signal }),
    context.controller.signal,
    remaining,
  );
  if (recovered.kind !== 'value' || !recovered.value.ok) return defaultRecovery();
  return normalizeRecovery(recovered.value.value) ?? defaultRecovery();
}

function finalStatus(closed: boolean, reason: AgentStopReason): 'idle' | 'completed' | 'cancelled' | 'closed' {
  if (closed) return 'closed';
  if (reason === 'cancelled') return 'cancelled';
  if (reason === 'complete') return 'completed';
  return 'idle';
}

export async function finalizeSession(
  context: SessionRunContext,
  reason: AgentStopReason,
): Promise<{ readonly ok: true; readonly value: AgentSessionReceipt }> {
  const recovery = await recoveryFor(context, reason);
  const receipt: AgentSessionReceipt = Object.freeze({
    version: '1',
    requestId: context.request.requestId,
    targetRegionId: context.request.targetRegionId,
    goalEpoch: context.request.goalEpoch,
    capability: Object.freeze({ ...context.request.capability }),
    operation: context.request.operation,
    transport: context.request.transport ?? 'direct',
    stop: reason,
    attempts: Object.freeze([...context.attempts]),
    ...(context.last === undefined ? {} : { last: context.last }),
    ...(recovery === undefined ? {} : { recovery }),
  });
  const { state } = context;
  state.attempts = state.closed ? Object.freeze([]) : receipt.attempts;
  state.receipt = state.closed ? undefined : receipt;
  state.status = finalStatus(state.closed, reason);
  return { ok: true, value: receipt };
}
