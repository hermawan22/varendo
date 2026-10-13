import type {
  AgentCapabilityContext,
  AgentCapabilityHandlerResult,
  AgentCapabilityManifest,
  AgentJsonValue,
} from '../capabilities/types.js';
import type { ActionPreview, ActionReceipt } from '@varendo/runtime/actions';
import type { AppToolEndpointOptions } from './types.js';
import { parseAction, type ParsedAction } from './action-input.js';

type ActionPort = NonNullable<AppToolEndpointOptions['runtime']['actionPort']>;

interface ActionCapabilityState {
  readonly actionPort: ActionPort | undefined;
  readonly previews: Map<string, ActionPreview>;
  readonly confirmations: Map<string, ActionReceipt>;
  closed: boolean;
  readonly lifetime: AbortController;
}

type ReceiptStep =
  | { readonly kind: 'ready'; readonly value: ActionReceipt }
  | { readonly kind: 'stopped'; readonly value: AgentCapabilityHandlerResult<AgentJsonValue> };

function unavailable(): AgentCapabilityHandlerResult<AgentJsonValue> {
  return {
    state: 'unsupported',
    diagnostics: [
      {
        code: 'agent.app.actions-unavailable',
        message: 'This application did not register an action boundary.',
        retryable: false,
      },
    ],
  };
}

async function previewAction(
  state: ActionCapabilityState,
  input: Extract<ParsedAction, { mode: 'preview' }>,
  context: AgentCapabilityContext,
): Promise<AgentCapabilityHandlerResult<AgentJsonValue>> {
  const actionPort = state.actionPort;
  if (actionPort === undefined) return unavailable();
  const preview = await actionPort.preview(
    {
      requestId: context.requestId,
      action: input.action,
      input: input.input,
      ...(input.entity === undefined ? {} : { entity: input.entity }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    },
    { signal: AbortSignal.any([state.lifetime.signal, context.signal]) },
  );
  if (!preview.ok) return { state: 'failed', diagnostics: preview.diagnostics };
  if (state.closed || context.signal.aborted) {
    actionPort.cancel(preview.value);
    return previewStale();
  }
  state.previews.set(preview.value.id, preview.value);
  return {
    state: preview.value.confirmation === 'required' ? 'needs-choice' : 'accepted',
    value: {
      state: 'preview',
      previewId: preview.value.id,
      action: preview.value.action,
      sideEffect: preview.value.sideEffect,
      confirmation: preview.value.confirmation,
    },
  };
}

function executionDenied(): AgentCapabilityHandlerResult<AgentJsonValue> {
  return {
    state: 'denied',
    diagnostics: [{ code: 'agent.app.denied', message: 'Action execution is not permitted.', retryable: false }],
  };
}

function previewStale(): AgentCapabilityHandlerResult<AgentJsonValue> {
  return {
    state: 'stale',
    diagnostics: [
      {
        code: 'agent.app.preview-stale',
        message: 'The action preview is missing, expired, or already consumed.',
        retryable: false,
      },
    ],
  };
}

function clearPreview(state: ActionCapabilityState, previewId: string): void {
  state.previews.delete(previewId);
  state.confirmations.delete(previewId);
}

async function executionReceipt(
  state: ActionCapabilityState,
  previewId: string,
  preview: ActionPreview,
  context: AgentCapabilityContext,
): Promise<ReceiptStep> {
  const saved = state.confirmations.get(previewId);
  if (saved !== undefined) return { kind: 'ready', value: saved };
  if (preview.confirmation === 'required')
    return {
      kind: 'stopped',
      value: { state: 'needs-choice', value: { state: 'confirmation-required', previewId } },
    };
  const actionPort = state.actionPort;
  if (actionPort === undefined) return { kind: 'stopped', value: unavailable() };
  const confirmed = await actionPort.confirm(preview, { signal: context.signal });
  if (!confirmed.ok) {
    clearPreview(state, previewId);
    return { kind: 'stopped', value: { state: 'failed', diagnostics: confirmed.diagnostics } };
  }
  return { kind: 'ready', value: confirmed.value };
}

type ActionExecution = Awaited<ReturnType<ActionPort['execute']>>;

function executionFailure(
  execution: Extract<ActionExecution, { readonly ok: false }>,
): AgentCapabilityHandlerResult<AgentJsonValue> {
  return {
    state: execution.diagnostics[0]?.code === 'action.ambiguous' ? 'partial' : 'failed',
    diagnostics: execution.diagnostics,
  };
}

function executionSuccess(
  execution: Extract<Awaited<ReturnType<ActionPort['execute']>>, { readonly ok: true }>,
): AgentCapabilityHandlerResult<AgentJsonValue> {
  if (execution.value.state === 'ambiguous')
    return {
      state: 'partial',
      reason: execution.value.reason,
      value: { state: 'ambiguous', receiptId: execution.value.receiptId, action: execution.value.action },
    };
  return {
    state: 'accepted',
    value: {
      state: 'executed',
      receiptId: execution.value.receiptId,
      action: execution.value.action,
      output: execution.value.output,
    },
  };
}

async function executeAction(
  state: ActionCapabilityState,
  input: Extract<ParsedAction, { mode: 'execute' }>,
  context: AgentCapabilityContext,
): Promise<AgentCapabilityHandlerResult<AgentJsonValue>> {
  if (!context.authority.grants.includes('action.execute')) return executionDenied();
  const preview = state.previews.get(input.previewId);
  if (preview === undefined) return previewStale();
  const receipt = await executionReceipt(state, input.previewId, preview, context);
  if (receipt.kind === 'stopped') return receipt.value;
  const actionPort = state.actionPort;
  if (actionPort === undefined) return unavailable();
  const execution = await actionPort.execute(receipt.value, { signal: context.signal });
  clearPreview(state, input.previewId);
  if (!execution.ok) return executionFailure(execution);
  return executionSuccess(execution);
}

export function createActionCapability(
  state: ActionCapabilityState,
): AgentCapabilityManifest<ParsedAction, AgentJsonValue> {
  return {
    ref: { id: 'varendo.app.action', revision: '1' },
    operation: 'action.propose',
    label: 'Preview or execute a registered Varendo action',
    description:
      'Previews a registered action. Execution requires a separate execute grant and any required confirmation must come from the host UI.',
    parse: parseAction,
    async invoke(input, context): Promise<AgentCapabilityHandlerResult<AgentJsonValue>> {
      if (state.closed) return previewStale();
      if (state.actionPort === undefined) return unavailable();
      if (input.mode === 'preview') return previewAction(state, input, context);
      return executeAction(state, input, context);
    },
  };
}

export async function confirmAction(
  state: ActionCapabilityState,
  previewId: string,
  input: { readonly signal?: AbortSignal },
): Promise<import('@varendo/core').Outcome<ActionReceipt>> {
  const preview = state.previews.get(previewId);
  const actionPort = state.actionPort;
  if (state.closed || preview === undefined || actionPort === undefined)
    return {
      ok: false,
      diagnostics: [
        {
          code: 'agent.app.preview-stale',
          message: 'The action preview is missing, expired, or already consumed.',
          retryable: false,
        },
      ],
    };
  const signal =
    input.signal === undefined ? state.lifetime.signal : AbortSignal.any([state.lifetime.signal, input.signal]);
  const confirmed = await actionPort.confirm(preview, { signal });
  if (confirmed.ok && !state.closed && !input.signal?.aborted) state.confirmations.set(previewId, confirmed.value);
  else clearPreview(state, previewId);
  return confirmed;
}

export function closeActionState(state: ActionCapabilityState): void {
  state.closed = true;
  state.lifetime.abort();
  for (const preview of state.previews.values()) state.actionPort?.cancel(preview);
  state.previews.clear();
  state.confirmations.clear();
}

export function createActionCapabilityState(options: AppToolEndpointOptions): ActionCapabilityState {
  return {
    actionPort: options.runtime.actionPort,
    previews: new Map(),
    confirmations: new Map(),
    closed: false,
    lifetime: new AbortController(),
  };
}
