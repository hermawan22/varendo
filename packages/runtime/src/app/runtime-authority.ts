import type { Outcome } from '@varendo/core';
import type { VarendoRuntimeOptions, AppAuthorityContext, RuntimeEffect } from './types.js';
import type { MountedRegion } from './runtime-state.js';
import { failure, validId } from './runtime-state.js';

export function readAuthority(
  options: VarendoRuntimeOptions,
  disposed: boolean,
  slot: MountedRegion,
  resourceId: string,
  effect: RuntimeEffect,
  signal?: AbortSignal,
): Outcome<AppAuthorityContext> {
  if (disposed) return failure('runtime.app-disposed', 'The Varendo runtime is disposed.');
  const outcome = invokeAuthority(options, slot, resourceId, effect, signal);
  if (!outcome.ok) return outcome;
  return validAuthority(outcome.value) ? outcome : invalidAuthority();
}

function invokeAuthority(
  options: VarendoRuntimeOptions,
  slot: MountedRegion,
  resourceId: string,
  effect: RuntimeEffect,
  signal?: AbortSignal,
): ReturnType<VarendoRuntimeOptions['authority']['read']> {
  try {
    return options.authority.read({
      resourceId,
      regionId: slot.regionId,
      effect,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    return failure('runtime.authority-denied', 'The authority adapter failed safely.');
  }
}

function validAuthority(value: AppAuthorityContext): boolean {
  return (
    validId(value.scopeDigest) &&
    validId(value.policyRevision) &&
    validId(value.experienceRevision) &&
    value.principalKey.length > 0 &&
    value.principalKey.length <= 1024
  );
}

function invalidAuthority(): Outcome<never> {
  return failure(
    'runtime.authority-invalid',
    'The authority adapter returned invalid bounded identity or revision metadata.',
  );
}
