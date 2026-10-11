import type { ResultRef } from '@varendo/core';
import type { ResultHandle } from '../results/types.js';
import type { AppAuthorityContext, RuntimeResourceBinding, RuntimeResourceContext } from './types.js';
import { refKey } from './runtime-state.js';

function availableActions(binding: RuntimeResourceBinding, grants: readonly string[]) {
  if (!grants.includes('action.propose')) return [];
  return (['create', 'edit'] as const).flatMap((intent) => {
    const form = binding.resource.forms?.[intent];
    return form === undefined ? [] : [{ intent, action: form.action }];
  });
}

function visibleFields(binding: RuntimeResourceBinding) {
  return binding.resource.entity.fields.flatMap((field) => {
    const metadata = binding.resource.fieldMetadata[field.id];
    if (metadata?.hidden === true) return [];
    return [
      Object.freeze({
        id: field.id,
        label: field.label,
        ...(metadata?.description === undefined ? {} : { description: metadata.description }),
        role: field.role,
        type: field.type,
        ...(metadata?.values === undefined ? {} : { values: metadata.values }),
      }),
    ];
  });
}

function visibleMeanings(binding: RuntimeResourceBinding) {
  return binding.resource.catalog.meanings.map((meaning) =>
    Object.freeze({
      id: meaning.id,
      revision: meaning.revision,
      label: meaning.label,
      explanation: meaning.explanation,
      output: meaning.output,
      aggregation: meaning.aggregation,
    }),
  );
}

export function describeResource(
  binding: RuntimeResourceBinding,
  authority: AppAuthorityContext,
): RuntimeResourceContext {
  return Object.freeze({
    resource: Object.freeze({
      id: binding.resource.id,
      label: binding.resource.label,
      ...(binding.resource.description === undefined ? {} : { description: binding.resource.description }),
    }),
    intents: Object.freeze([...binding.resource.intents]),
    fields: Object.freeze(visibleFields(binding)),
    meanings: Object.freeze(visibleMeanings(binding)),
    views: Object.freeze([...binding.resource.presentation.allowedViews]),
    actions: Object.freeze(availableActions(binding, authority.grants).map((action) => Object.freeze(action))),
    authority: Object.freeze({
      principalKey: authority.principalKey,
      scopeDigest: authority.scopeDigest,
      policyRevision: authority.policyRevision,
      experienceRevision: authority.experienceRevision,
      grants: Object.freeze([...authority.grants]),
    }),
  });
}

export function resolveTrackedResult(refs: Set<ResultHandle>, ref: ResultRef): ResultHandle | undefined {
  for (const handle of refs) {
    const snapshot = handle.snapshot();
    if (snapshot.status === 'disposed' || snapshot.status === 'denied') {
      refs.delete(handle);
      continue;
    }
    if (snapshot.descriptor !== undefined && refKey(snapshot.descriptor.ref) === refKey(ref)) return handle;
  }
  return undefined;
}
