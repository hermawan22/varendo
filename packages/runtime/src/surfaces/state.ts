import type { SurfaceAddress, SurfacePhase, SurfaceRevision, SurfaceSnapshot } from './types.js';

export function freezeAddress(address: SurfaceAddress): SurfaceAddress {
  return Object.freeze({ ...address });
}

export function sameAddress(left: SurfaceAddress, right: SurfaceAddress): boolean {
  return (
    left.runtimeId === right.runtimeId &&
    left.scopeInstanceId === right.scopeInstanceId &&
    left.activationEpoch === right.activationEpoch &&
    left.surfaceId === right.surfaceId &&
    left.surfaceGeneration === right.surfaceGeneration
  );
}

export function nextRevision(revision: SurfaceRevision): SurfaceRevision {
  const numeric = Number.parseInt(revision, 10);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? String(numeric + 1) : '1';
}

export function freezeSnapshot<I, S>(input: {
  readonly id: string;
  readonly address: SurfaceAddress;
  readonly revision: SurfaceRevision;
  readonly phase: SurfacePhase;
  readonly intent: I;
  readonly state: S;
}): SurfaceSnapshot<I, S> {
  return Object.freeze({
    ...input,
    address: freezeAddress(input.address),
    intent: immutableCopy(input.intent),
    state: immutableCopy(input.state),
  });
}

function immutableCopy<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => immutableCopy(entry))) as T;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const copy: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    copy[key] = immutableCopy(descriptor.value);
  }
  return Object.freeze(copy) as T;
}
