import { WIRE_LIMITS } from '@varendo/core';
import type { AgentBindingDecision } from '../binder-types.js';
import { isRecord } from '../guards.js';
import { validId, validText } from './common.js';

type Choice = Extract<AgentBindingDecision, { readonly state: 'needs-choice' }>['choices'][number];
type MeaningDecision = Extract<AgentBindingDecision, { readonly state: 'needs-meaning' }>;
type ChoiceDecision = Extract<AgentBindingDecision, { readonly state: 'needs-choice' }>;

function validPath(value: unknown): value is readonly (string | number)[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > WIRE_LIMITS.depth) return false;
  return value.every((part) => (typeof part === 'string' ? validId(part) : Number.isSafeInteger(part) && part >= 0));
}

function decisionIdentity(record: Record<string, unknown>): boolean {
  return (
    validId(record.goalEpoch) &&
    validId(record.diagnosticCode) &&
    (record.scope === 'goal' || record.scope === 'diagnostic') &&
    validPath(record.diagnosticPath)
  );
}

function normalizeChoice(value: unknown): Choice | undefined {
  if (!isRecord(value)) return undefined;
  if (!validId(value.id) || !validText(value.label) || !validText(value.consequence)) return undefined;
  return Object.freeze({ id: value.id, label: value.label, consequence: value.consequence });
}

function normalizeChoices(value: unknown): readonly Choice[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > WIRE_LIMITS.array) return undefined;
  const choices = value.map(normalizeChoice);
  if (choices.some((choice) => choice === undefined)) return undefined;
  return Object.freeze(choices as Choice[]);
}

function normalizeChoiceDecision(record: Record<string, unknown>): ChoiceDecision | undefined {
  const choices = normalizeChoices(record.choices);
  if (choices === undefined) return undefined;
  return Object.freeze({
    state: 'needs-choice',
    scope: record.scope as 'goal' | 'diagnostic',
    goalEpoch: record.goalEpoch as string,
    diagnosticCode: record.diagnosticCode as string,
    ...(record.diagnosticPath === undefined
      ? {}
      : { diagnosticPath: Object.freeze([...(record.diagnosticPath as readonly (string | number)[])]) }),
    choices,
  });
}

function validAuthoringRoutes(value: unknown): value is readonly ('ai-assisted' | 'manual')[] {
  if (!Array.isArray(value) || value.length > 2) return false;
  return value.every((route) => route === 'ai-assisted' || route === 'manual');
}

function normalizeMeaningDecision(record: Record<string, unknown>): MeaningDecision | undefined {
  if (!validText(record.concept) || !validAuthoringRoutes(record.authoringRoutes)) return undefined;
  return Object.freeze({
    state: 'needs-meaning',
    scope: record.scope as 'goal' | 'diagnostic',
    goalEpoch: record.goalEpoch as string,
    diagnosticCode: record.diagnosticCode as string,
    ...(record.diagnosticPath === undefined
      ? {}
      : { diagnosticPath: Object.freeze([...(record.diagnosticPath as readonly (string | number)[])]) }),
    concept: record.concept,
    authoringRoutes: Object.freeze([...record.authoringRoutes]),
  });
}

export function normalizeDecision(input: unknown): AgentBindingDecision | undefined {
  if (!isRecord(input)) return undefined;
  if (input.state !== 'needs-choice' && input.state !== 'needs-meaning') return undefined;
  if (!decisionIdentity(input)) return undefined;
  if (input.state === 'needs-choice') return normalizeChoiceDecision(input);
  return normalizeMeaningDecision(input);
}
