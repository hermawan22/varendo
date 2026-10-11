import {
  parseContract,
  parseWireValue,
  WIRE_LIMITS,
  type Diagnostic,
  type Outcome,
  type VersionRef,
} from '@varendo/core';
import type { AgentCapabilityLimits, AgentCapabilityManifest, AgentCapabilityRegistry } from './types.js';
import { boundedId as validId } from '../guards.js';

const failure = <T>(code: string, message: string, path?: readonly (string | number)[]): Outcome<T> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false, ...(path === undefined ? {} : { path: [...path] }) }],
});

export const capabilityRefKey = (ref: VersionRef): string => JSON.stringify([ref.id, ref.revision]);

function validLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= WIRE_LIMITS.label;
}

function validLimits(input: AgentCapabilityLimits | undefined): boolean {
  if (input === undefined) return true;
  return (
    (input.maxInputBytes === undefined ||
      (Number.isSafeInteger(input.maxInputBytes) &&
        input.maxInputBytes > 0 &&
        input.maxInputBytes <= WIRE_LIMITS.bytes)) &&
    (input.maxOutputBytes === undefined ||
      (Number.isSafeInteger(input.maxOutputBytes) &&
        input.maxOutputBytes > 0 &&
        input.maxOutputBytes <= WIRE_LIMITS.bytes))
  );
}

function validManifestShape(manifest: unknown): manifest is AgentCapabilityManifest {
  return manifest !== null && typeof manifest === 'object';
}

function validManifestLabels<TInput, TOutput>(manifest: AgentCapabilityManifest<TInput, TOutput>): boolean {
  return validLabel(manifest.label) && (manifest.description === undefined || validLabel(manifest.description));
}

function validManifestHandlers<TInput, TOutput>(manifest: AgentCapabilityManifest<TInput, TOutput>): boolean {
  return validLimits(manifest.limits) && typeof manifest.parse === 'function' && typeof manifest.invoke === 'function';
}

function boundedManifestMetadata<TInput, TOutput>(
  manifest: AgentCapabilityManifest<TInput, TOutput>,
  operation: string,
): boolean {
  const metadata = {
    ref: manifest.ref,
    operation,
    label: manifest.label,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    ...(manifest.limits === undefined ? {} : { limits: manifest.limits }),
  };
  return parseWireValue(metadata).ok;
}

function validManifest<TInput, TOutput>(manifest: AgentCapabilityManifest<TInput, TOutput>): Outcome<void> {
  try {
    if (!validManifestShape(manifest))
      return failure('agent.capability.registry', 'A capability manifest must be an object.');
    if (!validId(manifest.ref?.id) || !validId(manifest.ref?.revision))
      return failure('agent.capability.registry', 'A capability reference is malformed.', ['ref']);
    const operation = parseContract('operation-grant', JSON.stringify(manifest.operation));
    if (!operation.ok)
      return failure('agent.capability.registry', 'A capability operation is not a registered grant.', ['operation']);
    if (!validManifestLabels(manifest))
      return failure('agent.capability.registry', 'Capability labels and descriptions must be bounded text.');
    if (!validManifestHandlers(manifest))
      return failure('agent.capability.registry', 'A capability manifest has invalid bounds or handlers.');
    // Metadata is trusted registration data, but it must still be plain wire
    // data when the manifest is exposed to protocol adapters.
    if (!boundedManifestMetadata(manifest, operation.value))
      return failure('agent.capability.registry', 'Capability registration metadata is not bounded wire data.');
    return { ok: true, value: undefined };
  } catch {
    return failure('agent.capability.registry', 'Capability registration failed safely.');
  }
}

/** Host-owned registry for a small, typed capability surface. Model or tool
 * input can select a registered reference, but it cannot install a handler. */
export function createAgentCapabilityRegistry(
  initial: readonly AgentCapabilityManifest[] = [],
): Outcome<AgentCapabilityRegistry> {
  if (!Array.isArray(initial) || initial.length > WIRE_LIMITS.presentationNodes)
    return failure('agent.capability.registry', 'The capability registry exceeds its bound.');
  const entries = new Map<string, AgentCapabilityManifest<unknown, unknown>>();
  const register = <TInput, TOutput>(manifest: AgentCapabilityManifest<TInput, TOutput>): Outcome<void> => {
    const valid = validManifest(manifest);
    if (!valid.ok) return valid;
    const key = capabilityRefKey(manifest.ref);
    if (entries.has(key))
      return failure('agent.capability.duplicate', 'A capability reference is already registered.', ['ref']);
    if (entries.size >= WIRE_LIMITS.presentationNodes)
      return failure('agent.capability.registry', 'The capability registry is full.');
    entries.set(
      key,
      Object.freeze({
        ...manifest,
        ref: Object.freeze({ id: manifest.ref.id, revision: manifest.ref.revision }),
        ...(manifest.limits === undefined ? {} : { limits: Object.freeze({ ...manifest.limits }) }),
      }) as unknown as AgentCapabilityManifest<unknown, unknown>,
    );
    return { ok: true, value: undefined };
  };
  for (const manifest of initial) {
    const result = register(manifest);
    if (!result.ok) return result;
  }
  const registry: AgentCapabilityRegistry = {
    register,
    get(ref) {
      if (!validId(ref?.id) || !validId(ref?.revision)) return undefined;
      return entries.get(capabilityRefKey(ref));
    },
    list() {
      return Object.freeze([...entries.values()]);
    },
  };
  return { ok: true, value: Object.freeze(registry) };
}

export function sameCapabilityRef(left: VersionRef, right: VersionRef): boolean {
  return left.id === right.id && left.revision === right.revision;
}

export type CapabilityRegistrationDiagnostic = Diagnostic;
