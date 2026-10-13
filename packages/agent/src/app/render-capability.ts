import { parseIntent } from '@varendo/core';
import type { Diagnostic, Intent } from '@varendo/core';
import type {
  AgentCapabilityContext,
  AgentCapabilityHandlerResult,
  AgentCapabilityManifest,
  AgentJsonValue,
} from '../capabilities/types.js';
import type { RuntimeRenderReceipt, RuntimeResourceContext } from '@varendo/runtime/app';
import { agentDiagnosticValue, guideDiagnostic } from './diagnostics.js';
import { currentContexts } from './context-capability.js';
import { measureShapeProblem, meaningHint, normalizeAgentIntent, unknownMeasure } from './intent-guide.js';
import { RENDER_TOOL_DESCRIPTION } from './intent-schema.js';
import type { AppRenderPort, AppToolEndpointOptions } from './types.js';
import { failure, record } from './values.js';

type RenderReceipt = Awaited<ReturnType<AppRenderPort['render']>>;

function committedReceipt(
  receipt: RenderReceipt,
): Extract<RuntimeRenderReceipt, { readonly status: 'committed' }> | undefined {
  if ('runtime' in receipt) return receipt.runtime;
  if (receipt.status === 'committed') return receipt;
  return undefined;
}

function renderValue(receipt: RenderReceipt, diagnostics: readonly Diagnostic[]): AgentJsonValue {
  const committed = committedReceipt(receipt);
  return {
    status: receipt.status,
    requestId: receipt.requestId,
    regionId: receipt.regionId,
    ...(committed === undefined
      ? {}
      : {
          intent: { id: committed.intent.id, kind: committed.intent.kind, resource: committed.intent.resource },
          task: { id: committed.task.id, revision: committed.task.revision, kind: committed.task.kind },
          results: committed.outputs.map((output) => summarizeOutput(output)),
        }),
    diagnostics: diagnostics.map(agentDiagnosticValue),
  };
}

/** Diagnostics name the tool input the agent wrote, not the compiled query it produced. */
function toolTerms(message: string): string {
  return message.replaceAll('timeBucket', 'time').replaceAll('Time buckets', 'Time grouping');
}

function summarizeOutput(output: Extract<RuntimeRenderReceipt, { status: 'committed' }>['outputs'][number]) {
  const snapshot = output.handle.snapshot();
  const descriptor = snapshot.descriptor;
  if (descriptor === undefined) return { outputId: output.outputId, status: 'unavailable' };
  return {
    outputId: output.outputId,
    status: snapshot.status,
    fields: descriptor.fields.map((field) => field.id),
    loaded: descriptor.counts.loaded,
    precision: descriptor.precision.kind,
    coverage: descriptor.coverage.kind,
  };
}

function canRender(context: AgentCapabilityContext): boolean {
  return context.authority.grants.includes('task.propose') && context.authority.grants.includes('experience.commit');
}

function denied(): AgentCapabilityHandlerResult<AgentJsonValue> {
  return {
    state: 'denied',
    diagnostics: [
      {
        code: 'agent.app.denied',
        message: 'Intent compilation and presentation commit are not both permitted.',
        retryable: false,
      },
    ],
  };
}

function renderOutcome(
  receipt: RenderReceipt,
  intent: Intent,
  contexts: readonly RuntimeResourceContext[],
): AgentCapabilityHandlerResult<AgentJsonValue> {
  const diagnostics = receipt.diagnostics.map((item) => {
    const guided = guideDiagnostic(item, intent, contexts);
    return {
      ...guided,
      message: toolTerms(guided.message),
      ...(guided.remedies === undefined ? {} : { remedies: guided.remedies.map(toolTerms) }),
      ...(guided.path === undefined
        ? {}
        : { path: guided.path.map((part) => (part === 'timeBucket' ? 'time' : part)) }),
    };
  });
  const value = renderValue(receipt, diagnostics);
  switch (receipt.status) {
    case 'renderer-ready':
      return { state: 'renderer-ready', value, regionRevision: receipt.runtime.region.regionRevision };
    case 'committed':
      return { state: 'plan-committed', value, regionRevision: receipt.region.regionRevision };
    default: {
      const state = receipt.status === 'needs-input' ? 'needs-choice' : receipt.status;
      return { state, value, diagnostics };
    }
  }
}

let intentSequence = 0;
const nextIntentId = (): string => `agent-intent-${Date.now().toString(36)}-${++intentSequence}`;

type IntentInput = Extract<ReturnType<typeof parseIntent>, { readonly ok: true }>['value'];

export function createRenderCapability(
  options: AppToolEndpointOptions,
  renderPort: AppRenderPort,
): AgentCapabilityManifest<IntentInput, AgentJsonValue> {
  return {
    ref: { id: 'varendo.app.render', revision: '1' },
    operation: 'task.evaluate',
    label: 'Render a registered Varendo intent',
    description: RENDER_TOOL_DESCRIPTION,
    parse(input) {
      const active = options.runtime.context(options.regionId);
      const read = active.ok ? currentContexts(options, active.value) : undefined;
      const contexts = read?.ok ? read.value : [];
      const malformedMeasure = measureShapeProblem(input);
      if (malformedMeasure !== undefined) return failure('agent.app.measure-shape', malformedMeasure);
      const unknown = contexts.length > 0 ? unknownMeasure(input, contexts) : undefined;
      if (unknown !== undefined)
        return failure(
          'agent.app.unknown-measure',
          `Measure ${unknown} is not declared for this resource. ${meaningHint(record(input) ? input.resource : undefined, contexts)}`,
        );
      return parseIntent(normalizeAgentIntent(input, contexts, nextIntentId));
    },
    async invoke(intent, context): Promise<AgentCapabilityHandlerResult<AgentJsonValue>> {
      if (!canRender(context)) return denied();
      const receipt = await renderPort.render({ regionId: options.regionId, intent, signal: context.signal });
      const active = options.runtime.context(options.regionId);
      const read = active.ok ? currentContexts(options, active.value) : undefined;
      const contexts = read?.ok ? read.value : [];
      return renderOutcome(receipt, intent, contexts);
    },
  };
}
