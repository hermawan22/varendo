import type { Outcome } from '@varendo/core';
import type {
  VarendoNavigationFeedbackAction,
  VarendoNavigationFeedbackContent,
  VarendoNavigationFeedbackRoute,
} from './navigation-feedback-types.js';
import {
  MAX_ITEMS,
  MAX_TEXT,
  bounded,
  copyScalarRecord,
  copyVersionRef,
  exactKeys,
  fail,
  record,
  ref,
  safeHref,
  scalarRecord,
} from './navigation-feedback-support.js';

export function normalizeContents(value: unknown): Outcome<readonly VarendoNavigationFeedbackContent[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return fail('bindings', 'contents must be a bounded array.');
  const seen = new Set<string>();
  const result: VarendoNavigationFeedbackContent[] = [];
  for (const item of value) {
    const candidate = record(item);
    if (
      candidate === undefined ||
      !exactKeys(candidate, ['id', 'text']) ||
      !bounded(candidate.id) ||
      !bounded(candidate.text, MAX_TEXT) ||
      seen.has(candidate.id)
    )
      return fail('bindings', 'Content bindings must have unique bounded IDs and text.');
    seen.add(candidate.id);
    result.push({ id: candidate.id, text: candidate.text });
  }
  return { ok: true, value: result };
}

export function normalizeRoutes(value: unknown): Outcome<readonly VarendoNavigationFeedbackRoute[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return fail('bindings', 'routes must be a bounded array.');
  const seen = new Set<string>();
  const result: VarendoNavigationFeedbackRoute[] = [];
  for (const item of value) {
    const candidate = record(item);
    if (
      candidate === undefined ||
      !exactKeys(candidate, ['id', 'route', 'params', 'href']) ||
      !bounded(candidate.id) ||
      seen.has(candidate.id) ||
      !ref(candidate.route) ||
      !scalarRecord(candidate.params) ||
      !safeHref(candidate.href)
    )
      return fail(
        'bindings',
        'Route bindings require unique IDs, versioned routes, scalar params and safe host destinations.',
      );
    seen.add(candidate.id);
    result.push({
      id: candidate.id,
      route: copyVersionRef(candidate.route),
      params: copyScalarRecord(candidate.params),
      href: candidate.href,
    });
  }
  return { ok: true, value: result };
}

export function normalizeActions(value: unknown): Outcome<readonly VarendoNavigationFeedbackAction[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return fail('bindings', 'actions must be a bounded array.');
  const seen = new Set<string>();
  const result: VarendoNavigationFeedbackAction[] = [];
  for (const item of value) {
    const candidate = record(item);
    if (
      candidate === undefined ||
      !exactKeys(candidate, ['id', 'action', 'input']) ||
      !bounded(candidate.id) ||
      seen.has(candidate.id) ||
      !ref(candidate.action) ||
      !scalarRecord(candidate.input)
    )
      return fail('bindings', 'Action bindings require unique IDs, versioned actions and scalar input.');
    seen.add(candidate.id);
    result.push({
      id: candidate.id,
      action: copyVersionRef(candidate.action),
      input: copyScalarRecord(candidate.input),
    });
  }
  return { ok: true, value: result };
}
