import { WIRE_LIMITS } from '@varendo/core';
import type { MeaningDefinition, Outcome, VersionRef } from '@varendo/core';
import { canonicalMeaning, createMeaningDraft, snapshotMeaningAuthoringOptions } from './authoring.js';
import type { MeaningDraft, MeaningRegistryOptions, MeaningSource } from './types.js';

export function failure<T = never>(
  code: string,
  message: string,
  path?: readonly (string | number)[],
): Extract<Outcome<T>, { readonly ok: false }> {
  return {
    ok: false,
    diagnostics: [{ code, message, retryable: false, ...(path === undefined ? {} : { path: [...path] }) }],
  };
}

export function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= WIRE_LIMITS.id &&
    !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

export function sameRef(left: VersionRef, right: VersionRef): boolean {
  return left.id === right.id && left.revision === right.revision;
}

export function sourceForMeaning(meaning: MeaningDefinition, source?: MeaningSource): MeaningSource {
  if (source !== undefined) return source;
  if (meaning.origin !== 'ai-assisted') return { surface: 'code', ownership: 'code', readOnly: true };
  const ownership = meaning.scope === 'session' ? 'session' : meaning.scope;
  return { surface: 'ai-assisted', ownership };
}

function validDraftEnvelope(draft: MeaningDraft): boolean {
  return (
    draft !== null &&
    typeof draft === 'object' &&
    draft.version === '1' &&
    draft.meaning !== undefined &&
    draft.source !== undefined
  );
}

function canonicalRegistrationChecks(draft: MeaningDraft, prepared: MeaningDraft): Outcome<MeaningDraft> {
  if (typeof draft.digest !== 'string' || draft.digest !== prepared.digest)
    return failure('runtime.meaning-digest', 'Meaning draft digest does not match its canonical definition.', [
      'digest',
    ]);
  if (canonicalMeaning(draft.meaning) !== canonicalMeaning(prepared.meaning))
    return failure('runtime.meaning-registration', 'Meaning draft contents are not canonical.', ['meaning']);
  if (canonicalMeaning(draft.assumptions) !== canonicalMeaning(prepared.assumptions))
    return failure('runtime.meaning-assumptions', 'Meaning draft assumptions are not canonical.', ['assumptions']);
  return { ok: true, value: prepared };
}

export function validateRegistrationDraft(draft: MeaningDraft, options: MeaningRegistryOptions): Outcome<MeaningDraft> {
  if (!validDraftEnvelope(draft))
    return failure('runtime.meaning-registration', 'Meaning registration requires a canonical versioned draft.');
  try {
    const prepared = createMeaningDraft(
      draft.meaning,
      {
        catalog: options.catalog,
        registry: options.registry,
        ...(options.definitions === undefined ? {} : { definitions: options.definitions }),
        ...(options.policy === undefined ? {} : { policy: options.policy }),
      },
      {
        source: draft.source,
        assumptions: draft.assumptions,
        ...(draft.base === undefined ? {} : { base: draft.base }),
      },
    );
    if (!prepared.ok) return prepared;
    return canonicalRegistrationChecks(draft, prepared.value);
  } catch {
    return failure('runtime.meaning-registration', 'Meaning registration failed safely at the draft boundary.');
  }
}

export interface PreparedRegistryOptions {
  readonly options: MeaningRegistryOptions;
  readonly maxEntries: number;
  readonly maxBytes: number;
}

function validateRegistryShell(options: MeaningRegistryOptions): Outcome<void> {
  if (options === null || typeof options !== 'object')
    return failure('runtime.meaning-registry', 'Meaning registry options are required.');
  if (
    options.registry === null ||
    typeof options.registry !== 'object' ||
    Array.isArray(options.registry) ||
    options.catalog === null ||
    typeof options.catalog !== 'object' ||
    Array.isArray(options.catalog)
  )
    return failure('runtime.meaning-registry', 'A canonical catalog and function registry are required.');
  if (
    options.activationHost !== undefined &&
    (options.activationHost === null || typeof options.activationHost.readContext !== 'function')
  )
    return failure('runtime.meaning-authority', 'Meaning activation requires a callable trusted host.');
  return { ok: true, value: undefined };
}

function snapshotRegistryOptions(options: MeaningRegistryOptions): Outcome<MeaningRegistryOptions> {
  const snapshot = snapshotMeaningAuthoringOptions(options);
  if (!snapshot.ok) return snapshot;
  return {
    ok: true,
    value: Object.freeze({
      ...snapshot.value,
      ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      ...(options.activationHost === undefined
        ? {}
        : {
            activationHost: Object.freeze({
              readContext: options.activationHost.readContext.bind(options.activationHost),
            }),
          }),
    }),
  };
}

function validateCapacity(
  options: MeaningRegistryOptions,
): Outcome<Pick<PreparedRegistryOptions, 'maxEntries' | 'maxBytes'>> {
  const maxEntries = options.maxEntries ?? 512;
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0 || maxEntries > WIRE_LIMITS.presentationNodes)
    return failure('runtime.meaning-registry', 'Meaning registry capacity is outside its bound.', ['maxEntries']);
  const maxBytes = options.maxBytes ?? WIRE_LIMITS.bytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > WIRE_LIMITS.bytes)
    return failure('runtime.meaning-budget', 'Meaning registry byte capacity is outside its bound.', ['maxBytes']);
  return { ok: true, value: { maxEntries, maxBytes } };
}

function validateDefinitions(options: MeaningRegistryOptions): Outcome<void> {
  if (
    !Array.isArray(options.catalog.meanings) ||
    (options.definitions !== undefined && !Array.isArray(options.definitions))
  )
    return failure('runtime.meaning-registry', 'Meaning registry definitions must be arrays.', ['definitions']);
  return { ok: true, value: undefined };
}

export function prepareRegistryOptions(options: MeaningRegistryOptions): Outcome<PreparedRegistryOptions> {
  const shell = validateRegistryShell(options);
  if (!shell.ok) return shell;
  const snapshotted = snapshotRegistryOptions(options);
  if (!snapshotted.ok) return snapshotted;
  const capacity = validateCapacity(snapshotted.value);
  if (!capacity.ok) return capacity;
  const definitions = validateDefinitions(snapshotted.value);
  if (!definitions.ok) return definitions;
  return { ok: true, value: { options: snapshotted.value, ...capacity.value } };
}
