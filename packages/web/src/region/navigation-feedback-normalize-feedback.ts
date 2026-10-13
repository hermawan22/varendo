import type { Outcome } from '@varendo/core';
import type { VarendoEmptyStateKind } from '../feedback/empty-state.js';
import type {
  VarendoFeedbackBinding,
  VarendoNavigationFeedbackAction,
  VarendoNavigationFeedbackContent,
} from './navigation-feedback-types.js';
import {
  EMPTY_STATE_KINDS,
  bounded,
  boundedArray,
  exactKeys,
  fail,
  record,
  requireAction,
  requireContent,
} from './navigation-feedback-support.js';

const FEEDBACK_KEYS = [
  'id',
  'labelRef',
  'contentRef',
  'headingRef',
  'messageRef',
  'actionLabelRef',
  'actionRef',
  'kind',
  'progressValue',
  'progressMax',
] as const;

const CONTENT_REFERENCE_KEYS = ['labelRef', 'contentRef', 'headingRef', 'messageRef', 'actionLabelRef'] as const;

export function normalizeFeedback(
  value: unknown,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  actions: Map<string, VarendoNavigationFeedbackAction>,
): Outcome<readonly VarendoFeedbackBinding[]> {
  const source = boundedArray(value, 'feedback');
  if (!source.ok) return source;
  const seen = new Set<string>();
  const result: VarendoFeedbackBinding[] = [];
  for (const raw of source.value) {
    const entry = normalizeFeedbackEntry(raw, contents, actions, seen);
    if (!entry.ok) return entry;
    seen.add(entry.value.id);
    result.push(entry.value);
  }
  return { ok: true, value: result };
}

function normalizeFeedbackEntry(
  raw: unknown,
  contents: Map<string, VarendoNavigationFeedbackContent>,
  actions: Map<string, VarendoNavigationFeedbackAction>,
  seen: ReadonlySet<string>,
): Outcome<VarendoFeedbackBinding> {
  const entry = record(raw);
  if (!validFeedbackIdentity(entry, seen)) return fail('bindings', 'Feedback bindings require unique bounded IDs.');
  if (!validFeedbackContent(entry, contents))
    return fail('bindings', 'Feedback text must use registered content references.');
  if (!validFeedbackAction(entry, actions))
    return fail('bindings', 'Feedback actions must use registered action references.');
  if (!validFeedbackKind(entry)) return fail('bindings', 'Empty-state kind is not supported.');
  const progressError = feedbackProgressError(entry);
  if (progressError !== undefined) return fail('bindings', progressError);
  return { ok: true, value: feedbackValue(entry) };
}

function validFeedbackIdentity(
  entry: Record<string, unknown> | undefined,
  seen: ReadonlySet<string>,
): entry is Record<string, unknown> {
  if (entry === undefined || !exactKeys(entry, FEEDBACK_KEYS) || !bounded(entry.id)) return false;
  return !seen.has(entry.id);
}

function validFeedbackContent(
  entry: Record<string, unknown>,
  contents: Map<string, VarendoNavigationFeedbackContent>,
): boolean {
  for (const key of CONTENT_REFERENCE_KEYS) {
    if (entry[key] === undefined) continue;
    if (!requireContent(contents, entry[key])) return false;
  }
  return true;
}

function validFeedbackAction(
  entry: Record<string, unknown>,
  actions: Map<string, VarendoNavigationFeedbackAction>,
): boolean {
  return entry.actionRef === undefined || requireAction(actions, entry.actionRef);
}

function validFeedbackKind(entry: Record<string, unknown>): boolean {
  if (entry.kind === undefined) return true;
  if (typeof entry.kind !== 'string') return false;
  return EMPTY_STATE_KINDS.includes(entry.kind as VarendoEmptyStateKind);
}

function feedbackProgressError(entry: Record<string, unknown>): string | undefined {
  if (!validProgressValue(entry.progressValue)) return 'Progress values must be finite and nonnegative.';
  if (!validProgressMaximum(entry.progressMax)) return 'Progress max must be finite and positive.';
  if (progressExceedsMaximum(entry.progressValue, entry.progressMax))
    return 'Progress value cannot exceed its host max.';
  return undefined;
}

function validProgressValue(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function validProgressMaximum(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value > 0);
}

function progressExceedsMaximum(value: unknown, maximum: unknown): boolean {
  return typeof value === 'number' && typeof maximum === 'number' && value > maximum;
}

function feedbackValue(entry: Record<string, unknown>): VarendoFeedbackBinding {
  return {
    id: entry.id as string,
    ...(entry.labelRef === undefined ? {} : { labelRef: entry.labelRef as string }),
    ...(entry.contentRef === undefined ? {} : { contentRef: entry.contentRef as string }),
    ...(entry.headingRef === undefined ? {} : { headingRef: entry.headingRef as string }),
    ...(entry.messageRef === undefined ? {} : { messageRef: entry.messageRef as string }),
    ...(entry.actionLabelRef === undefined ? {} : { actionLabelRef: entry.actionLabelRef as string }),
    ...(entry.actionRef === undefined ? {} : { actionRef: entry.actionRef as string }),
    ...(entry.kind === undefined ? {} : { kind: entry.kind as VarendoEmptyStateKind }),
    ...(entry.progressValue === undefined ? {} : { progressValue: entry.progressValue as number }),
    ...(entry.progressMax === undefined ? {} : { progressMax: entry.progressMax as number }),
  };
}
