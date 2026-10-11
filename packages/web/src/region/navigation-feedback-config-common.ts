import type { Outcome, VersionRef } from '@varendo/core';
import type { InteractionPort } from '@varendo/core/interaction';
import type { PresentationValues } from '@varendo/core/presentation';
import type {
  AeliqoNavigationFeedbackBindings,
  AeliqoNavigationFeedbackContent,
  AeliqoNavigationFeedbackRoute,
  AeliqoNavigationFeedbackAction,
} from './navigation-feedback-types.js';
import type { RecordValue } from './navigation-feedback-support.js';
import { bounded, fail, record, exactKeys } from './navigation-feedback-support.js';

export interface ResolvedPresentation {
  readonly values: PresentationValues;
  readonly fields: readonly string[];
  readonly ports: readonly InteractionPort[];
  readonly operations: readonly VersionRef[];
}

export function configRecord(
  values: PresentationValues,
  allowed: readonly string[],
  bindings: AeliqoNavigationFeedbackBindings,
): Outcome<{ readonly input: RecordValue; readonly bindingRef: string }> {
  const input = record(values);
  if (input === undefined || !exactKeys(input, allowed))
    return fail('config', 'The navigation or feedback configuration contains an unknown field.');
  if (input.bindingRevision !== bindings.revision || typeof input.bindingRevision !== 'string')
    return fail('binding', 'The binding revision is stale or does not match the host table.');
  if (!bounded(input.bindingRef))
    return fail('binding', 'A navigation or feedback representation requires a bounded bindingRef.');
  return { ok: true, value: { input, bindingRef: input.bindingRef } };
}

export function content(
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  id: string | undefined,
  field: string,
  required = true,
): Outcome<string | undefined> {
  if (id === undefined)
    return required
      ? fail('binding', `${field} requires a registered host content reference.`)
      : { ok: true, value: undefined };
  const value = contents.get(id);
  return value === undefined
    ? fail('binding', `${field} does not name registered host content.`)
    : { ok: true, value: value.text };
}

export function routeValue(route: AeliqoNavigationFeedbackRoute): RecordValue {
  return { route: route.route, params: route.params, href: route.href };
}

export function actionValue(action: AeliqoNavigationFeedbackAction): RecordValue {
  return { action: action.action, input: action.input };
}

export function baseValues(bindings: AeliqoNavigationFeedbackBindings, bindingRef: string): RecordValue {
  return { bindingRevision: bindings.revision, bindingRef };
}

export function resolved(
  values: RecordValue,
  fields: readonly string[] = [],
  ports: readonly InteractionPort[] = [],
  operations: readonly VersionRef[] = [],
): Outcome<ResolvedPresentation> {
  return { ok: true, value: { values: values as PresentationValues, fields, ports, operations } };
}

export function navPort(id: string, payload: InteractionPort['payload']): InteractionPort {
  return { id, direction: 'output', payload };
}
