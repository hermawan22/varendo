import type { Outcome, Scalar, VersionRef } from '@varendo/core';
import type { AeliqoEmptyStateKind } from '../feedback/empty-state.js';
import type {
  AeliqoNavigationFeedbackAction,
  AeliqoNavigationFeedbackBindings,
  AeliqoNavigationFeedbackContent,
  AeliqoNavigationFeedbackRoute,
} from './navigation-feedback-types.js';
export { freezeValue as freeze } from './registry-value.js';

export const MAX_ITEMS = 128;
export const MAX_TREE_NODES = 512;
export const MAX_TEXT = 4_096;
export const MAX_PAGE = 1_000_000;
export const EMPTY_STATE_KINDS: readonly AeliqoEmptyStateKind[] = [
  'no-records',
  'no-matches',
  'forbidden',
  'loading',
  'failure',
];
export const FEEDBACK_TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const;
export const SKELETON_VARIANTS: readonly string[] = ['text', 'rect', 'circle'];

export type RecordValue = Record<string, unknown>;

export const fail = <T>(code: string, message: string): Outcome<T> => ({
  ok: false,
  diagnostics: [{ code: `web.presentation.navigation-feedback.${code}`, message, retryable: false }],
});

export function boundedArray(value: unknown, name: string, maximum = MAX_ITEMS): Outcome<readonly unknown[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > maximum) return fail('bindings', `${name} must be a bounded array.`);
  return { ok: true, value };
}

export function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : undefined;
}

export function bounded(value: unknown, maximum = 160): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export function ref(value: unknown): value is VersionRef {
  const candidate = record(value);
  return (
    candidate !== undefined &&
    Object.keys(candidate).length === 2 &&
    bounded(candidate.id) &&
    bounded(candidate.revision)
  );
}

function scalar(value: unknown): value is Scalar {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= MAX_TEXT;
  const candidate = record(value);
  return (
    candidate !== undefined &&
    Object.keys(candidate).length === 1 &&
    typeof candidate.decimal === 'string' &&
    candidate.decimal.length <= 512 &&
    /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(candidate.decimal)
  );
}

export function scalarRecord(value: unknown): value is Readonly<Record<string, Scalar>> {
  const candidate = record(value);
  return (
    candidate !== undefined &&
    Object.keys(candidate).length <= MAX_ITEMS &&
    Object.entries(candidate).every(([key, item]) => bounded(key) && scalar(item))
  );
}

export function copyVersionRef(value: VersionRef): VersionRef {
  return { id: value.id, revision: value.revision };
}

function copyScalar(value: Scalar): Scalar {
  if (value === null || typeof value !== 'object') return value;
  return { decimal: value.decimal };
}

export function copyScalarRecord(value: Readonly<Record<string, Scalar>>): Readonly<Record<string, Scalar>> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyScalar(item)]));
}

export function safeHref(value: unknown, image = false): value is string {
  if (!bounded(value, 4_096)) return false;
  try {
    return (image ? ['http:', 'https:'] : ['http:', 'https:', 'mailto:', 'tel:']).includes(
      new URL(value, 'https://aeliqo.invalid').protocol,
    );
  } catch {
    return false;
  }
}

export function exactKeys(value: RecordValue, allowed: readonly string[]): boolean {
  const permitted = new Set(allowed);
  return Object.keys(value).every((key) => permitted.has(key));
}

export function uniqueRefs(values: readonly VersionRef[]): readonly VersionRef[] {
  return [...new Map(values.map((value) => [JSON.stringify([value.id, value.revision]), value])).values()];
}

export function contentMap(bindings: AeliqoNavigationFeedbackBindings): Map<string, AeliqoNavigationFeedbackContent> {
  return new Map((bindings.contents ?? []).map((entry) => [entry.id, entry]));
}

export function routeMap(bindings: AeliqoNavigationFeedbackBindings): Map<string, AeliqoNavigationFeedbackRoute> {
  return new Map((bindings.routes ?? []).map((entry) => [entry.id, entry]));
}

export function actionMap(bindings: AeliqoNavigationFeedbackBindings): Map<string, AeliqoNavigationFeedbackAction> {
  return new Map((bindings.actions ?? []).map((entry) => [entry.id, entry]));
}

export function requireContent(contents: Map<string, AeliqoNavigationFeedbackContent>, value: unknown): boolean {
  return bounded(value) && contents.has(value);
}

export function requireRoute(routes: Map<string, AeliqoNavigationFeedbackRoute>, value: unknown): boolean {
  return bounded(value) && routes.has(value);
}

export function requireAction(actions: Map<string, AeliqoNavigationFeedbackAction>, value: unknown): boolean {
  return bounded(value) && actions.has(value);
}
