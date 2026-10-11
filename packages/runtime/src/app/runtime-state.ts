import { WIRE_LIMITS } from '@varendo/core';
import type { Diagnostic, Outcome, ResultRef, Task } from '@varendo/core';
import type { RegionAuthority, RegionSnapshot } from '../regions/types.js';
import type { RuntimeRegionState, RuntimeRenderStatus } from './types.js';
import type { RuntimeResourceBinding } from './types.js';
import type { AppAuthorityContext } from './types.js';

export interface MountedRegion {
  readonly regionId: string;
  readonly resourceId: string;
  readonly surfaceBinding?: RuntimeResourceBinding;
  readonly listeners: Set<(state: RuntimeRegionState) => void>;
  state: RuntimeRegionState;
  sequence: number;
  active?: AbortController;
  principalKey?: string;
  refs: readonly ResultRef[];
  pendingRefs: readonly ResultRef[];
}

export function diagnostic(code: string, message: string, path?: readonly (string | number)[]): Diagnostic {
  return { code, message, retryable: false, ...(path === undefined ? {} : { path }) };
}

export function failure<T = never>(code: string, message: string, path?: readonly (string | number)[]): Outcome<T> {
  return { ok: false, diagnostics: [diagnostic(code, message, path)] };
}

export function validId(value: string): boolean {
  return value.length > 0 && value.length <= WIRE_LIMITS.id && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

export function refKey(ref: ResultRef): string {
  return JSON.stringify([ref.id, ref.revision, ref.sourceLineage, ref.outputId, ref.queryDigest, ref.scopeDigest]);
}

export function uniqueRefs(refs: readonly ResultRef[]): readonly ResultRef[] {
  return Object.freeze([...new Map(refs.map((ref) => [refKey(ref), ref])).values()]);
}

export function statusFor(diagnostics: readonly Diagnostic[]): Exclude<RuntimeRenderStatus, 'committed'> {
  const code = diagnostics[0]?.code ?? '';
  if (matchesAny(code, ['cancel', 'abort', 'disposed', 'stale'])) return 'cancelled';
  if (matchesAny(code, ['denied', 'revoked', 'permission'])) return 'denied';
  if (matchesAny(code, ['unsupported']) || code.startsWith('intent.unknown-')) return 'unsupported';
  if (matchesAny(code, ['needs-choice', 'needs-input', 'identity'])) return 'needs-input';
  return 'failed';
}

function matchesAny(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term));
}

export function linkedSignal(parent: AbortSignal | undefined): {
  readonly controller: AbortController;
  cleanup(): void;
} {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted === true) controller.abort();
  return {
    controller,
    cleanup: () => parent?.removeEventListener('abort', abort),
  };
}

export function sameAuthority(current: AppAuthorityContext, expected: RegionAuthority): boolean {
  return (
    current.principalKey === expected.principalKey &&
    current.scopeDigest === expected.scopeDigest &&
    current.policyRevision === expected.policyRevision &&
    current.experienceRevision === expected.experienceRevision
  );
}

export function sameTask(current: RegionSnapshot, task: Task): boolean {
  return (
    current.readSet !== undefined && current.state?.task.id === task.id && current.state.task.revision === task.revision
  );
}
