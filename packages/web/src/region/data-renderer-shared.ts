import type { InteractionPayload, InteractionState, ResultRef } from '@varendo/core';
import { materializedDataStatus } from '../data/shared.js';
import type { AeliqoDataStatus } from '../data/types.js';
import type { AeliqoDataResolvedNode } from './data-registry.js';
import type { AeliqoDataHostRequestHandler, AeliqoDataRenderContext } from './data-renderer-types.js';
import { resultRefKey as refKey } from './registry-value.js';

const RESULT_REF_KEYS = ['id', 'revision', 'sourceLineage', 'outputId', 'queryDigest', 'scopeDigest'] as const;

/**
 * Read only plain data records at the event boundary.  Event details come
 * from component/application code and may be proxies, class instances or
 * accessor-backed objects.  Copying data descriptors both prevents an
 * accidental getter from becoming trusted input and gives callers one
 * fail-closed representation to validate.
 */
export const record = (value: unknown): Record<string, unknown> | undefined => {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) return undefined;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) return undefined;
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return undefined;
  }
};

export function exactRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): Record<string, unknown> | undefined {
  const candidate = record(value);
  if (candidate === undefined) return undefined;
  const keys = Object.keys(candidate);
  if (keys.some((key) => !allowed.includes(key))) return undefined;
  if (required.some((key) => !Object.hasOwn(candidate, key))) return undefined;
  return candidate;
}

export function resultRef(value: unknown): ResultRef | undefined {
  const required = RESULT_REF_KEYS.filter((key) => key !== 'sourceLineage');
  const candidate = exactRecord(value, RESULT_REF_KEYS, required);
  if (
    candidate === undefined ||
    required.some((key) => typeof candidate[key] !== 'string' || !validId(candidate[key])) ||
    (candidate.sourceLineage !== undefined &&
      (typeof candidate.sourceLineage !== 'string' || !validId(candidate.sourceLineage)))
  )
    return undefined;
  return {
    id: candidate.id as string,
    revision: candidate.revision as string,
    ...(candidate.sourceLineage === undefined ? {} : { sourceLineage: candidate.sourceLineage as string }),
    outputId: candidate.outputId as string,
    queryDigest: candidate.queryDigest as string,
    scopeDigest: candidate.scopeDigest as string,
  };
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

export function eventType(event: Event): string | undefined {
  try {
    return typeof event.type === 'string' ? event.type : undefined;
  } catch {
    return undefined;
  }
}

export const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

export function sameRef(left: ResultRef | undefined, right: ResultRef): boolean {
  try {
    const checked = resultRef(left);
    return checked !== undefined && refKey(checked) === refKey(right);
  } catch {
    return false;
  }
}

export function statusFor(node: AeliqoDataResolvedNode): AeliqoDataStatus {
  return materializedDataStatus(node.result);
}

export function selectionPort(node: AeliqoDataResolvedNode, output = false) {
  try {
    return node.config.ports.find(
      (candidate) =>
        candidate.id === 'selection' &&
        candidate.payload === 'selection' &&
        (!output || candidate.direction === 'output' || candidate.direction === 'inout'),
    );
  } catch {
    return undefined;
  }
}

export function port(node: AeliqoDataResolvedNode, id: string, payload: InteractionPayload['kind']): boolean {
  try {
    return node.config.ports.some(
      (candidate) =>
        candidate.id === id &&
        candidate.payload === payload &&
        (candidate.direction === 'output' || candidate.direction === 'inout'),
    );
  } catch {
    return false;
  }
}

/** Typed host requests have no core payload/port.  Their availability comes
 * from the validated component capability and an installed host callback. */
export function hostOutput(context: AeliqoDataRenderContext): AeliqoDataHostRequestHandler | undefined {
  try {
    return typeof context.onRequest === 'function' ? context.onRequest : undefined;
  } catch {
    return undefined;
  }
}

export function interactionPayload(
  node: AeliqoDataResolvedNode,
  interaction: InteractionState | undefined,
  kind: 'selection' | 'filter',
  portId: string,
): Record<string, unknown> | undefined {
  try {
    const values = interaction?.values;
    if (!Array.isArray(values)) return undefined;
    for (const raw of values) {
      const entry = exactRecord(raw, ['nodeId', 'portId', 'payload']);
      if (entry === undefined || entry.nodeId !== node.id || entry.portId !== portId) continue;
      const payload = exactRecord(
        entry.payload,
        kind === 'selection' ? ['kind', 'selection'] : ['kind', 'predicates', 'outputId'],
      );
      if (payload?.kind === kind) return payload;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function exactKeys(keys: readonly unknown[]): keys is readonly string[] {
  try {
    return (
      keys.length > 0 &&
      new Set(keys).size === keys.length &&
      keys.every((key) => typeof key === 'string' && key.length > 0)
    );
  } catch {
    return false;
  }
}

export function eventDetail<T>(event: Event): T | undefined {
  try {
    if (typeof CustomEvent === 'undefined' || !(event instanceof CustomEvent)) return undefined;
    return (event.detail as T) ?? undefined;
  } catch {
    return undefined;
  }
}
