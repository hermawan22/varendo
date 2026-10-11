import * as z from 'zod/mini';
import { inspectWire } from '../contracts/ingress.js';
import { idSchema, versionRefSchema } from '../contracts/schemas.js';
import { WIRE_LIMITS } from '../contracts/limits.js';
import type { Outcome } from '../contracts/types.js';
import { stableJson, versionRefKey as versionKey } from '../contracts/stable.js';
export { versionRefKey as versionKey } from '../contracts/stable.js';
import { validateInteractionGraph, interactionMappingManifestSchema } from '../interaction/graph.js';
import type { InteractionMappingManifest } from '../interaction/graph.js';
import type {
  PresentationManifest,
  PresentationPatternManifest,
  PresentationRegistry,
  PresentationStateMappingManifest,
} from './types.js';

export const presentationFailure = (code: string, message: string): Outcome<never> => ({
  ok: false,
  diagnostics: [{ code: `presentation.${code}`, message, retryable: false }],
});
/** Pattern IDs are allowlisted by ID in Experience, so revisions cannot be ambiguous. */
const PRESENTATION_PATTERN_LIMIT = 64;
export const isThenable = (value: unknown): value is { then: (...args: readonly unknown[]) => unknown } => {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    return typeof (value as { then?: unknown }).then === 'function';
  } catch {
    return true;
  }
};
// Cache only graphs recursively frozen by this function, never arbitrary shallow-frozen input.
const ownedFrozenGraphs = new WeakSet<object>();
const ownedRegistrations = new WeakSet<object>();
/** Only parsed, frozen factory registrations qualify for validation reuse. */
export const ownsPresentationRegistration = (value: object): boolean => ownedRegistrations.has(value);
export function freezePresentation<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !ownedFrozenGraphs.has(value)) {
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === 'object' && !ownedFrozenGraphs.has(child)) freezePresentation(child);
    }
    Object.freeze(value);
    ownedFrozenGraphs.add(value);
  }
  return value;
}
/** Freeze a new container cheaply when each object child is already recursively owned. */
export function freezePresentationContainer<T>(value: T): T {
  if (value === null || typeof value !== 'object' || ownedFrozenGraphs.has(value)) return value;
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !ownedFrozenGraphs.has(child)) return freezePresentation(value);
  }
  Object.freeze(value);
  ownedFrozenGraphs.add(value);
  return value;
}

const bound = z.int().check(z.minimum(0), z.maximum(WIRE_LIMITS.presentationNodes));
const manifestSchema = z.strictObject({
  ref: versionRefSchema,
  configSchema: versionRefSchema,
  roles: z.array(idSchema).check(z.minLength(1), z.maxLength(128)),
  operations: z.array(versionRefSchema).check(z.maxLength(128)),
  result: z.enum(['required', 'optional', 'none']),
  children: z.strictObject({ min: bound, max: bound }),
  visibility: z.enum(['simultaneous', 'exclusive', 'leaf']),
  extension: z.boolean(),
});
const stateMappingSchema = z.strictObject({
  ref: versionRefSchema,
  from: versionRefSchema,
  to: versionRefSchema,
  fromRole: idSchema,
  toRole: idSchema,
  kind: z.enum(['transfer', 'archive']),
});
const patternSchema = z.strictObject({ ref: versionRefSchema });

function validateManifestCallbacks(manifest: PresentationManifest): Outcome<never> | undefined {
  const { resolveConfig, suggestConfig, assess } = manifest;
  if (
    typeof resolveConfig === 'function' &&
    (suggestConfig === undefined || typeof suggestConfig === 'function') &&
    (assess === undefined || typeof assess === 'function')
  )
    return undefined;
  return presentationFailure('registry', 'Representation configuration handlers must be registered local functions.');
}

function validateManifestShape(metadata: Omit<PresentationManifest, 'resolveConfig' | 'suggestConfig' | 'assess'>) {
  const wire = inspectWire(metadata);
  if (!wire.ok) return wire;
  const parsed = z.safeParse(manifestSchema, wire.value);
  if (!parsed.success)
    return presentationFailure('registry', 'Representation metadata does not match the bounded registry contract.');
  return { ok: true as const, value: parsed.data };
}

function validateManifestIdentity(
  manifest: z.infer<typeof manifestSchema>,
  seen: ReadonlySet<string>,
): Outcome<never> | undefined {
  if (
    !seen.has(versionKey(manifest.ref)) &&
    new Set(manifest.roles).size === manifest.roles.length &&
    new Set(manifest.operations.map(versionKey)).size === manifest.operations.length &&
    manifest.children.min <= manifest.children.max &&
    (manifest.visibility !== 'leaf' || manifest.children.max === 0)
  )
    return undefined;
  return presentationFailure(
    'registry',
    'Representation identities, operations, roles or child bounds are inconsistent.',
  );
}

function registerManifest(manifest: PresentationManifest, seen: Set<string>): Outcome<PresentationManifest> {
  const callbacks = validateManifestCallbacks(manifest);
  if (callbacks !== undefined) return callbacks;
  const { resolveConfig, suggestConfig, assess, ...metadata } = manifest;
  const parsed = validateManifestShape(metadata);
  if (!parsed.ok) return parsed;
  const consistent = validateManifestIdentity(parsed.value, seen);
  if (consistent !== undefined) return consistent;
  seen.add(versionKey(parsed.value.ref));
  ownedRegistrations.add(parsed.value.operations);
  return {
    ok: true,
    value: freezePresentation({
      ...parsed.value,
      resolveConfig,
      ...(suggestConfig === undefined ? {} : { suggestConfig }),
      ...(assess === undefined ? {} : { assess }),
    }),
  };
}

function registerManifests(input: readonly PresentationManifest[]): Outcome<PresentationManifest[]> {
  const manifests: PresentationManifest[] = [];
  const seen = new Set<string>();
  try {
    for (const manifest of input) {
      const registered = registerManifest(manifest, seen);
      if (!registered.ok) return registered;
      manifests.push(registered.value);
    }
  } catch {
    return presentationFailure('registry', 'Representation registration failed.');
  }
  return { ok: true, value: manifests };
}

function registerPattern(pattern: PresentationPatternManifest, ids: Set<string>): Outcome<PresentationPatternManifest> {
  const { expand, matches, ...metadata } = pattern;
  if (typeof expand !== 'function' || typeof matches !== 'function')
    return presentationFailure('registry', 'Pattern expanders and matchers must be registered local functions.');
  const wire = inspectWire(metadata);
  if (!wire.ok) return wire;
  const parsed = z.safeParse(patternSchema, wire.value);
  if (!parsed.success || ids.has(parsed.data.ref.id))
    return presentationFailure('registry', 'Pattern references must be valid and unique by ID.');
  ids.add(parsed.data.ref.id);
  return { ok: true, value: freezePresentation({ ...parsed.data, expand, matches }) };
}

function registerPatterns(patterns: readonly PresentationPatternManifest[]): Outcome<PresentationPatternManifest[]> {
  const owned: PresentationPatternManifest[] = [];
  const ids = new Set<string>();
  try {
    for (const pattern of patterns) {
      const registered = registerPattern(pattern, ids);
      if (!registered.ok) return registered;
      owned.push(registered.value);
    }
  } catch {
    return presentationFailure('registry', 'Pattern registration failed.');
  }
  return { ok: true, value: owned };
}

function invalidStateMapping(
  mapping: z.infer<typeof stateMappingSchema>,
  seen: ReadonlySet<string>,
  manifests: readonly PresentationManifest[],
): boolean {
  const fromKey = versionKey(mapping.from);
  const toKey = versionKey(mapping.to);
  const from = manifests.find((manifest) => versionKey(manifest.ref) === fromKey);
  const to = manifests.find((manifest) => versionKey(manifest.ref) === toKey);
  return (
    mapping.ref.id === 'aeliqo.state.identity' ||
    !(
      seen.has(fromKey) &&
      seen.has(toKey) &&
      from?.roles.includes(mapping.fromRole) &&
      to?.roles.includes(mapping.toRole)
    )
  );
}

function registerStateMappings(
  stateMappings: readonly PresentationStateMappingManifest[],
  seen: ReadonlySet<string>,
  manifests: readonly PresentationManifest[],
): Outcome<readonly PresentationStateMappingManifest[]> {
  const wire = inspectWire(stateMappings);
  if (!wire.ok) return wire;
  const parsed = z.safeParse(z.array(stateMappingSchema).check(z.maxLength(128)), wire.value);
  if (!parsed.success)
    return presentationFailure('registry', 'State mappings must be unique registered representation/role pairs.');
  const invalid =
    new Set(parsed.data.map((mapping) => versionKey(mapping.ref))).size !== parsed.data.length ||
    new Set(parsed.data.map((mapping) => stableJson({ ...mapping, ref: undefined }))).size !== parsed.data.length ||
    parsed.data.some((mapping) => invalidStateMapping(mapping, seen, manifests));
  if (invalid)
    return presentationFailure('registry', 'State mappings must be unique registered representation/role pairs.');
  return { ok: true, value: parsed.data };
}

function registerMappings(mappings: readonly InteractionMappingManifest[]) {
  const wire = inspectWire(mappings);
  if (!wire.ok) return wire;
  const parsed = z.safeParse(z.array(interactionMappingManifestSchema), wire.value);
  if (!parsed.success) return presentationFailure('registry', 'The registered mappings are malformed.');
  const mappingValues = parsed.data as unknown as readonly InteractionMappingManifest[];
  const graph = validateInteractionGraph({ nodes: [], links: [] }, mappingValues);
  if (!graph.ok) return graph;
  return { ok: true as const, value: mappingValues };
}

function validateRegistryInput(
  manifests: readonly PresentationManifest[],
  patterns: readonly PresentationPatternManifest[],
): Outcome<void> {
  if (!Array.isArray(manifests) || manifests.length === 0 || manifests.length > WIRE_LIMITS.presentationNodes)
    return presentationFailure('registry', 'A bounded nonempty representation registry is required.');
  if (!Array.isArray(patterns) || patterns.length > PRESENTATION_PATTERN_LIMIT)
    return presentationFailure('registry', 'A bounded pattern registry is required.');
  return { ok: true, value: undefined };
}

function registerRegistryParts(
  input: readonly PresentationManifest[],
  mappings: readonly InteractionMappingManifest[],
  patterns: readonly PresentationPatternManifest[],
  stateMappings: readonly PresentationStateMappingManifest[],
): Outcome<PresentationRegistry> {
  const manifestResult = registerManifests(input);
  if (!manifestResult.ok) return manifestResult;
  const patternResult = registerPatterns(patterns);
  if (!patternResult.ok) return patternResult;
  const seen = new Set(manifestResult.value.map((manifest) => versionKey(manifest.ref)));
  const stateResult = registerStateMappings(stateMappings, seen, manifestResult.value);
  if (!stateResult.ok) return stateResult;
  const mappingResult = registerMappings(mappings);
  if (!mappingResult.ok) return mappingResult;
  return {
    ok: true,
    value: freezePresentation({
      manifests: manifestResult.value,
      mappings: mappingResult.value,
      patterns: patternResult.value,
      stateMappings: stateResult.value,
    }),
  };
}

/** Registry installation is trusted local code, not a serializable proposal operation. */
export function createPresentationRegistry(
  input: readonly PresentationManifest[],
  mappings: readonly InteractionMappingManifest[] = [],
  patterns: readonly PresentationPatternManifest[] = [],
  stateMappings: readonly PresentationStateMappingManifest[] = [],
): Outcome<PresentationRegistry> {
  const valid = validateRegistryInput(input, patterns);
  if (!valid.ok) return valid;
  const registered = registerRegistryParts(input, mappings, patterns, stateMappings);
  if (registered.ok) ownedRegistrations.add(registered.value);
  return registered;
}
