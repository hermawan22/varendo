import { parseWireValue } from '@varendo/core';
import type { MeaningDefinition, Outcome, VersionRef } from '@varendo/core';
import { authorizeMeaningActivation, validateMeaningBundle } from '@varendo/core/semantics';
import type { MeaningActivationReceipt } from '@varendo/core/semantics';
import { canonicalMeaning, freezeMeaningValue, meaningRefKey } from './authoring.js';
import { failure, sameRef, validId } from './registry-helpers.js';
import type {
  MeaningActivationContext,
  MeaningActivationHost,
  MeaningActivationOptions,
  MeaningEntry,
  MeaningRegistryOptions,
} from './types.js';

type ActivationFailure = Extract<Outcome<MeaningActivationReceipt>, { readonly ok: false }>;
type ExpectedAuthority = NonNullable<MeaningActivationOptions['expectedAuthority']>;

export interface MeaningActivationState {
  readonly options: MeaningRegistryOptions;
  readonly generation: number;
  readonly revokedScopes: ReadonlySet<string>;
  readonly activatedOwner: { readonly principalKey: string; readonly scopeDigest: string } | undefined;
  get(ref: VersionRef): MeaningEntry | undefined;
  definitions(filter?: { readonly activeOnly?: boolean }): readonly MeaningDefinition[];
  validationOptions(): MeaningRegistryOptions;
  commitActivation(ref: VersionRef, approved: MeaningDefinition, context: MeaningActivationContext): void;
}

interface PreparedActivation {
  readonly entry: MeaningEntry;
  readonly before: MeaningActivationContext;
  readonly beforeGeneration: number;
  readonly approved: MeaningDefinition;
  readonly authorized: MeaningActivationReceipt;
}

function malformedContext(): ActivationFailure {
  return failure('runtime.meaning-authority', 'The trusted meaning activation context is malformed.');
}

function contextShapeFailure(context: MeaningActivationContext): ActivationFailure | undefined {
  if (
    context === null ||
    typeof context !== 'object' ||
    !Array.isArray(context.grants) ||
    context.policy === null ||
    typeof context.policy !== 'object' ||
    !Array.isArray(context.policy.allowlistedDefinitions)
  )
    return malformedContext();
  return undefined;
}

function contextPinFailure(
  context: MeaningActivationContext,
  catalogRevision: string,
  registryDigest: string,
): ActivationFailure | undefined {
  if (!validId(context.principalKey) || !validId(context.scopeDigest) || !validId(context.policyRevision))
    return malformedContext();
  if (context.policy.policyRevision !== context.policyRevision)
    return failure('runtime.meaning-stale', 'Meaning activation policy revisions disagree.');
  if (context.catalogRevision !== catalogRevision || context.functionRegistryDigest !== registryDigest)
    return failure(
      'runtime.meaning-stale',
      'Meaning activation is stale for the current catalog or function registry.',
    );
  return readSetFailure(context);
}

function readSetFailure(context: MeaningActivationContext): ActivationFailure | undefined {
  const readSet = context.readSet;
  if (readSet === undefined) return undefined;
  if (
    readSet === null ||
    typeof readSet !== 'object' ||
    readSet.scopeDigest !== context.scopeDigest ||
    readSet.policyRevision !== context.policyRevision ||
    readSet.catalogRevision !== context.catalogRevision ||
    readSet.functionRegistryDigest !== context.functionRegistryDigest
  )
    return failure('runtime.meaning-stale', 'Meaning activation read-set pins disagree with the current authority.');
  return undefined;
}

function contextPermissionFailure(
  context: MeaningActivationContext,
  meaning: MeaningDefinition,
): ActivationFailure | undefined {
  if (!context.grants.includes('meaning.activate'))
    return failure('runtime.meaning-grant', 'The host did not grant meaning activation.');
  if (context.allowedScopes === undefined) return undefined;
  if (!Array.isArray(context.allowedScopes) || !context.allowedScopes.includes(meaning.scope))
    return failure('runtime.meaning-scope', 'The host activation policy does not allow this meaning scope.', ['scope']);
  return undefined;
}

function contextFailure(
  context: MeaningActivationContext,
  meaning: MeaningDefinition,
  catalogRevision: string,
  registryDigest: string,
): ActivationFailure | undefined {
  const shape = contextShapeFailure(context);
  if (shape !== undefined) return shape;
  const pins = contextPinFailure(context, catalogRevision, registryDigest);
  if (pins !== undefined) return pins;
  return contextPermissionFailure(context, meaning);
}

function snapshotContext(
  result: Awaited<ReturnType<MeaningActivationHost['readContext']>>,
): Outcome<MeaningActivationContext> {
  if (!result || result.ok !== true)
    return failure('runtime.meaning-authority', 'Meaning activation authority was unavailable.');
  const parsed = parseWireValue(result.value);
  if (!parsed.ok) return failure('runtime.meaning-authority', 'Meaning activation context must be bounded plain data.');
  return { ok: true, value: freezeMeaningValue(parsed.value) as unknown as MeaningActivationContext };
}

function abortFailure(signal: AbortSignal | undefined): ActivationFailure | undefined {
  return signal?.aborted ? failure('runtime.meaning-cancelled', 'Meaning activation was cancelled.') : undefined;
}

function activationCandidate(
  context: MeaningActivationContext,
  meaning: MeaningDefinition,
): MeaningDefinition | undefined {
  if (
    context.policy === null ||
    typeof context.policy !== 'object' ||
    !Array.isArray(context.policy.allowlistedDefinitions)
  )
    return undefined;
  return context.policy.allowlistedDefinitions.find(
    (candidate) => candidate !== null && typeof candidate === 'object' && sameRef(candidate, meaning),
  );
}

function sameActivationContext(left: MeaningActivationContext, right: MeaningActivationContext): boolean {
  return (
    left.principalKey === right.principalKey &&
    left.scopeDigest === right.scopeDigest &&
    left.policyRevision === right.policyRevision &&
    left.catalogRevision === right.catalogRevision &&
    left.functionRegistryDigest === right.functionRegistryDigest &&
    canonicalMeaning(left.allowedScopes) === canonicalMeaning(right.allowedScopes) &&
    canonicalMeaning(left.policy) === canonicalMeaning(right.policy) &&
    canonicalMeaning(left.readSet) === canonicalMeaning(right.readSet)
  );
}

function validateActivationOptions(value: MeaningActivationOptions): ActivationFailure | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return failure('runtime.meaning-invalid', 'Meaning activation options must be an object.');
  return undefined;
}

function expectedAuthority(
  value: MeaningActivationOptions['expectedAuthority'],
): Outcome<ExpectedAuthority | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const parsed = parseWireValue(value);
  if (!parsed.ok) return failure('runtime.meaning-authority', 'Calling activation authority is malformed.');
  const normalized = freezeMeaningValue(parsed.value) as unknown as ExpectedAuthority;
  if (!validId(normalized?.principalKey))
    return failure('runtime.meaning-authority', 'Calling activation principal is malformed.');
  return { ok: true, value: normalized };
}

async function readActivationContext(
  host: MeaningActivationHost,
  entry: MeaningEntry,
  signal: AbortSignal | undefined,
  phase: 'initial' | 'recheck',
): Promise<Outcome<MeaningActivationContext>> {
  try {
    return snapshotContext(
      await host.readContext({
        meaning: { id: entry.draft.meaning.id, revision: entry.draft.meaning.revision },
        signal: signal ?? new AbortController().signal,
      }),
    );
  } catch {
    const message =
      phase === 'initial'
        ? 'Meaning activation authority failed safely.'
        : 'Meaning activation authority could not be rechecked safely.';
    return failure('runtime.meaning-authority', message);
  }
}

function validateInitialContext(
  state: MeaningActivationState,
  context: MeaningActivationContext,
  entry: MeaningEntry,
  expected: ExpectedAuthority | undefined,
): Outcome<void> {
  const error = contextFailure(
    context,
    entry.draft.meaning,
    state.options.catalog.revision,
    state.options.registry.digest,
  );
  if (error !== undefined) return error;
  if (
    expected !== undefined &&
    (expected.principalKey !== context.principalKey ||
      (expected.readSet !== undefined && canonicalMeaning(expected.readSet) !== canonicalMeaning(context.readSet)))
  )
    return failure('runtime.meaning-stale', 'The activation registry does not match the trusted calling authority.');
  if (state.revokedScopes.has(context.scopeDigest))
    return failure('runtime.meaning-revoked', 'The activation scope has been revoked.');
  const owner = state.activatedOwner;
  if (owner !== undefined && (owner.principalKey !== context.principalKey || owner.scopeDigest !== context.scopeDigest))
    return failure(
      'runtime.meaning-scope',
      'A meaning registry belongs to one activated principal and scope. Create an isolated registry for a different owner.',
    );
  return { ok: true, value: undefined };
}

function validateCandidate(
  state: MeaningActivationState,
  entry: MeaningEntry,
  context: MeaningActivationContext,
): Outcome<MeaningDefinition> {
  const candidate = activationCandidate(context, entry.draft.meaning);
  if (candidate === undefined)
    return failure(
      'runtime.meaning-activation-denied',
      'The exact meaning version is not present in the trusted host activation allowlist.',
      ['meaning'],
    );
  if (canonicalMeaning(candidate) !== canonicalMeaning(entry.draft.meaning))
    return failure(
      'runtime.meaning-conflict',
      'Activation cannot replace the contents of an immutable registered version. Register a new reviewed version.',
      ['meaning'],
    );
  if (candidate.origin !== entry.draft.meaning.origin)
    return failure('runtime.meaning-origin', 'Activation cannot erase the meaning origin recorded in the draft.', [
      'origin',
    ]);
  if (candidate.lifecycle !== 'active')
    return failure('runtime.meaning-lifecycle', 'Activation requires a host-approved active definition.', [
      'lifecycle',
    ]);
  if (!dependenciesActive(state, candidate))
    return failure('runtime.meaning-dependency', 'Meaning activation requires every dependency to remain active.', [
      'dependencies',
    ]);
  return validateCandidateBundle(state, candidate);
}

function dependenciesActive(state: MeaningActivationState, candidate: MeaningDefinition): boolean {
  const active = new Set(state.definitions({ activeOnly: true }).map(meaningRefKey));
  return candidate.dependencies.every((dependency) => active.has(meaningRefKey(dependency)));
}

function validateCandidateBundle(
  state: MeaningActivationState,
  candidate: MeaningDefinition,
): Outcome<MeaningDefinition> {
  let checked: ReturnType<typeof validateMeaningBundle>;
  try {
    checked = validateMeaningBundle(
      {
        catalogRevision: state.options.catalog.revision,
        functionRegistryDigest: state.options.registry.digest,
        meanings: [candidate],
      },
      state.validationOptions(),
    );
  } catch {
    return failure('runtime.meaning-stale', 'Meaning activation validation failed safely.');
  }
  if (!checked.ok) return checked;
  return { ok: true, value: candidate };
}

async function prepareActivation(
  state: MeaningActivationState,
  ref: VersionRef,
  options: MeaningActivationOptions,
): Promise<Outcome<PreparedActivation>> {
  const invalidOptions = validateActivationOptions(options);
  if (invalidOptions !== undefined) return invalidOptions;
  const cancelled = abortFailure(options.signal);
  if (cancelled !== undefined) return cancelled;
  const entry = state.get(ref);
  if (entry === undefined)
    return failure('runtime.meaning-unknown', 'The requested meaning version is not registered.', ['meaning']);
  if (entry.revoked)
    return failure('runtime.meaning-revoked', 'The requested meaning version has been revoked.', ['meaning']);
  const host = state.options.activationHost;
  if (host === undefined)
    return failure('runtime.meaning-authority', 'Meaning activation requires a trusted host authority callback.');
  const expected = expectedAuthority(options.expectedAuthority);
  if (!expected.ok) return expected;
  const beforeGeneration = state.generation;
  const before = await readActivationContext(host, entry, options.signal, 'initial');
  if (!before.ok) return before;
  const validContext = validateInitialContext(state, before.value, entry, expected.value);
  if (!validContext.ok) return validContext;
  const approved = validateCandidate(state, entry, before.value);
  if (!approved.ok) return approved;
  const authorized = authorizeMeaningActivation(approved.value, before.value.policy);
  if (!authorized.ok) return authorized;
  return {
    ok: true,
    value: { entry, before: before.value, beforeGeneration, approved: approved.value, authorized: authorized.value },
  };
}

function validateRecheckedContext(
  state: MeaningActivationState,
  prepared: PreparedActivation,
  after: MeaningActivationContext,
  ref: VersionRef,
): Outcome<MeaningDefinition> {
  const contextError = contextFailure(
    after,
    prepared.approved,
    state.options.catalog.revision,
    state.options.registry.digest,
  );
  if (contextError !== undefined) return contextError;
  if (
    !sameActivationContext(prepared.before, after) ||
    state.generation !== prepared.beforeGeneration ||
    state.get(ref)?.revoked === true
  )
    return failure('runtime.meaning-stale', 'Meaning activation authority changed before the atomic publish.');
  const candidate = activationCandidate(after, prepared.approved);
  if (candidate === undefined || canonicalMeaning(candidate) !== canonicalMeaning(prepared.approved))
    return failure('runtime.meaning-stale', 'The host activation definition changed before the atomic publish.');
  return { ok: true, value: candidate };
}

async function recheckActivation(
  state: MeaningActivationState,
  ref: VersionRef,
  options: MeaningActivationOptions,
  prepared: PreparedActivation,
): Promise<Outcome<MeaningActivationReceipt>> {
  const host = state.options.activationHost!;
  const after = await readActivationContext(host, prepared.entry, options.signal, 'recheck');
  const cancelled = abortFailure(options.signal);
  if (cancelled !== undefined) return cancelled;
  if (!after.ok) return failure('runtime.meaning-stale', 'Meaning activation authority could not be rechecked safely.');
  const current = validateRecheckedContext(state, prepared, after.value, ref);
  if (!current.ok) return current;
  const entry = state.get(ref);
  if (entry === undefined || entry.revoked)
    return failure('runtime.meaning-revoked', 'Meaning was revoked before activation completed.');
  state.commitActivation(ref, current.value, prepared.before);
  return { ok: true, value: prepared.authorized };
}

export async function activateMeaning(
  state: MeaningActivationState,
  ref: VersionRef,
  options: MeaningActivationOptions = {},
): Promise<Outcome<MeaningActivationReceipt>> {
  const prepared = await prepareActivation(state, ref, options);
  if (!prepared.ok) return prepared;
  const cancelled = abortFailure(options.signal);
  if (cancelled !== undefined) return cancelled;
  return recheckActivation(state, ref, options, prepared.value);
}
