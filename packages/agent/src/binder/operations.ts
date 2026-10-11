import type { Outcome } from '@varendo/core';
import type { AgentBindingOutcome } from '@varendo/core/agent';
import type { AgentBindOptions, AgentBinder, AgentBinderOptions } from '../binder-types.js';
import { boundOutcome, diagnostic, failure, stateOutcome } from './common.js';
import { candidateFingerprint, taskFingerprint } from './fingerprint.js';
import { inspectProposal } from './inspect.js';
import type { Inspection, InspectionFailure } from './types.js';

const staleCodes = new Set([
  'agent.stale-epoch',
  'agent.stale-authority',
  'agent.stale-decisions',
  'commit.stale',
  'commit.missing-dependency',
  'agent.stale',
  'agent.stale-task',
]);
const deniedCodes = new Set(['agent.denied', 'agent.denied-result-inspect']);
const unsupportedCodes = new Set(['agent.unsupported', 'query.unsupported']);

function maxPending(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return 8;
  return Math.min(64, value);
}

function stateForDiagnostic(code: string | undefined): 'stale' | 'denied' | 'unsupported' | 'invalid' {
  if (code !== undefined && (staleCodes.has(code) || code.startsWith('query.stale'))) return 'stale';
  if (code !== undefined && deniedCodes.has(code)) return 'denied';
  if (code !== undefined && (unsupportedCodes.has(code) || code.startsWith('query.unsupported'))) return 'unsupported';
  return 'invalid';
}

function failedBinding(inspected: InspectionFailure): Outcome<AgentBindingOutcome> {
  if (inspected.state !== undefined) return { ok: true, value: inspected.state };
  const first = inspected.diagnostics[0];
  return stateOutcome(stateForDiagnostic(first?.code), inspected.diagnostics);
}

function bindingResult(inspected: Inspection, options: AgentBindOptions): Outcome<AgentBindingOutcome> {
  if (!inspected.ok) return failedBinding(inspected);
  if (options.signal?.aborted)
    return stateOutcome('stale', [diagnostic('agent.cancelled', 'Agent binding was cancelled.')]);
  return boundOutcome(inspected.value.task);
}

function bindingFailure(): Outcome<AgentBindingOutcome> {
  return stateOutcome('invalid', [diagnostic('agent.invalid', 'The proposal could not be bound safely.')]);
}

export function createBinderOperations(options: AgentBinderOptions): AgentBinder {
  const pendingLimit = maxPending(options.maxPending);
  let pending = 0;
  const bind = async (input: unknown, bindOptions: AgentBindOptions = {}): Promise<Outcome<AgentBindingOutcome>> => {
    if (pending >= pendingLimit)
      return stateOutcome('invalid', [diagnostic('agent.budget', 'The binding queue is full.')]);
    pending++;
    try {
      const inspected = await inspectProposal(input, bindOptions, options.host, options.queryLimits);
      return bindingResult(inspected, bindOptions);
    } catch {
      return bindingFailure();
    } finally {
      pending = Math.max(0, pending - 1);
    }
  };
  const fingerprint = async (input: unknown, bindOptions: AgentBindOptions = {}): Promise<Outcome<string>> => {
    if (pending >= pendingLimit) return failure('agent.budget', 'The binding queue is full.');
    pending++;
    try {
      const inspected = await inspectProposal(input, bindOptions, options.host, options.queryLimits);
      if (!inspected.ok) return { ok: true, value: candidateFingerprint(input) };
      return {
        ok: true,
        value: taskFingerprint(inspected.value.task, inspected.value.context, inspected.value.plans),
      };
    } finally {
      pending = Math.max(0, pending - 1);
    }
  };
  return Object.freeze({ bind, fingerprint });
}

export function validBinderOptions(options: AgentBinderOptions): boolean {
  return (
    options !== null &&
    typeof options === 'object' &&
    options.host !== null &&
    typeof options.host?.readContext === 'function'
  );
}

export function invalidBinderOptions(): TypeError {
  return new TypeError('An agent host readContext callback is required.');
}
