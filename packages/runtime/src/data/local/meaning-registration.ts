import { parseCatalog } from '@varendo/core';
import type { MeaningDefinition, Outcome } from '@varendo/core';
import { authorizeMeaningActivation, validateMeaningBundle } from '@varendo/core/semantics';
import type { MeaningActivationReceipt, MeaningBundle } from '@varendo/core/semantics';
import type { LocalSnapshot, MeaningRegistration } from '../types.js';
import { sourceSequenceNumber } from './service-state.js';
import type { LocalDataServiceState } from './service-state.js';
import { freezeCatalog, isSourceCapacityError, normalizeSnapshot, sourceDiagnosticCode } from './source.js';
import { canonical, failure, freezeDeep } from './shared.js';

interface ActivationControl {
  readonly registry: NonNullable<LocalDataServiceState['options']['meaningActivation']>['registry'];
  readonly policy: NonNullable<LocalDataServiceState['options']['meaningActivation']>['policy'];
}

export function replaceLocalSnapshot(state: LocalDataServiceState, next: LocalSnapshot): Outcome<void> {
  const normalized = normalizeReplacementSnapshot(state, next);
  if (!normalized.ok) return normalized;
  const revisionState = sameRevisionState(state.snapshot, normalized.value);
  if (revisionState === 'conflict')
    return failure('data.source-revision-conflict', 'Source content changed without a new revision.', [
      'sourceRevision',
    ]);
  if (revisionState === 'equivalent') return { ok: true, value: undefined };
  if (state.fixedCatalog !== undefined && canonical(state.fixedCatalog) !== canonical(normalized.value.catalog))
    return failure('data.source-catalog-conflict', 'The local catalog cannot change.', ['catalog']);
  const revision = normalized.value.sourceRevision;
  const checked = checkRevision(state, revision);
  if (!checked.ok) return checked;
  state.snapshot = normalized.value;
  state.currentCatalog = normalized.value.catalog;
  state.plans.clear();
  state.registeredBundles.clear();
  return { ok: true, value: undefined };
}

function checkRevision(state: LocalDataServiceState, revision: string): Outcome<void> {
  const sequence = state.sequence;
  if (sequence !== undefined) {
    const next = sourceSequenceNumber(revision, sequence.prefix);
    if (next === undefined || next <= sequence.last)
      return failure('data.source-revision-sequence', 'Old revision.', ['sourceRevision']);
    sequence.last = next;
  } else {
    if (state.revisionHistory.has(revision))
      return failure('data.source-revision-conflict', 'Source revision was already used.', ['sourceRevision']);
    if (state.revisionHistory.size >= state.maxSourceRevisions)
      return failure('data.source-revision-capacity', 'Source revision limit reached.', ['sourceRevision']);
    state.revisionHistory.add(revision);
  }
  return { ok: true, value: undefined };
}

function normalizeReplacementSnapshot(state: LocalDataServiceState, next: LocalSnapshot) {
  try {
    const normalized = normalizeSnapshot(next, state.sourceLimits, {
      rejectExecutableToJSON: state.rejectExecutableToJSON,
    });
    const shape = state.snapshotValidator?.(normalized);
    if (shape !== undefined && !shape.ok) return { ok: false as const, diagnostics: shape.diagnostics };
    return { ok: true as const, value: normalized };
  } catch (error) {
    const capacity = isSourceCapacityError(error);
    const sourceCode = sourceDiagnosticCode(error);
    return failure<ReturnType<typeof normalizeSnapshot>>(
      capacity ? 'data.source-capacity' : (sourceCode ?? 'data.source-shape'),
      capacity ? 'Replacement exceeds the source capacity.' : 'Replacement is not a bounded canonical source.',
    );
  }
}

function sameRevisionState(
  current: LocalDataServiceState['snapshot'],
  replacement: LocalDataServiceState['snapshot'],
): 'different' | 'equivalent' | 'conflict' {
  if (replacement.sourceRevision !== current.sourceRevision) return 'different';
  return canonical({ catalog: replacement.catalog, records: replacement.records }) ===
    canonical({ catalog: current.catalog, records: current.records })
    ? 'equivalent'
    : 'conflict';
}

export function registerMeaningBundle(
  state: LocalDataServiceState,
  bundle: MeaningBundle,
): Outcome<MeaningRegistration> {
  const control = activationControl(state);
  if (!control.ok) return control;
  const bundleKey = canonical(bundle);
  const existing = state.registeredBundles.get(bundleKey);
  if (existing !== undefined) return replayMeaningBundle(state, bundle, bundleKey, existing, control.value);
  return activateNewBundle(state, bundle, bundleKey, control.value);
}

function activationControl(state: LocalDataServiceState): Outcome<ActivationControl> {
  const control = state.options.meaningActivation;
  if (control === undefined) return failure('data.meaning-controlplane', 'Missing meaning policy or registry.');
  return { ok: true, value: control };
}

function replayMeaningBundle(
  state: LocalDataServiceState,
  bundle: MeaningBundle,
  bundleKey: string,
  existing: MeaningRegistration,
  control: ActivationControl,
): Outcome<MeaningRegistration> {
  const replayBundle: MeaningBundle = {
    catalogRevision: state.currentCatalog.revision,
    functionRegistryDigest: bundle.functionRegistryDigest,
    meanings: existing.meanings,
  };
  const validated = validateBundle(state, replayBundle, control);
  if (!validated.ok) return validated;
  const receipts = activationReceipts(validated.value.meanings, control);
  if (!receipts.ok) return receipts;
  const registration = freezeDeep({
    catalogRevision: state.currentCatalog.revision,
    meanings: validated.value.meanings,
    receipts: receipts.value,
    idempotent: true,
  });
  state.registeredBundles.set(bundleKey, registration);
  return { ok: true, value: registration };
}

function activateNewBundle(
  state: LocalDataServiceState,
  bundle: MeaningBundle,
  bundleKey: string,
  control: ActivationControl,
): Outcome<MeaningRegistration> {
  if (bundle.catalogRevision !== state.currentCatalog.revision)
    return failure('data.stale-catalog', 'Catalog revision is stale.', ['catalogRevision']);
  const validated = validateBundle(state, bundle, control);
  if (!validated.ok) return validated;
  const reviewed = reviewOrigin(validated.value.meanings);
  if (!reviewed.ok) return reviewed;
  const added = uniqueCatalogMeanings(validated.value.meanings, state.currentCatalog.meanings);
  if (!added.ok) return added;
  const receipts = activationReceipts(validated.value.meanings, control);
  if (!receipts.ok) return receipts;
  if (added.value.length > 0) {
    const update = appendMeanings(state, added.value);
    if (!update.ok) return update;
  }
  const registration = freezeDeep({
    catalogRevision: state.currentCatalog.revision,
    meanings: validated.value.meanings,
    receipts: receipts.value,
    idempotent: false,
  });
  state.registeredBundles.set(bundleKey, registration);
  return { ok: true, value: registration };
}

function validateBundle(state: LocalDataServiceState, bundle: MeaningBundle, control: ActivationControl) {
  return validateMeaningBundle(bundle, {
    catalog: state.currentCatalog,
    registry: control.registry,
    definitions: state.currentCatalog.meanings,
    policy: { allowHostCapabilities: true },
  });
}

function reviewOrigin(meanings: readonly MeaningDefinition[]): Outcome<void> {
  if (!meanings.some((meaning) => meaning.origin === 'ai-assisted')) return { ok: true, value: undefined };
  return failure('data.meaning-origin', 'Only reviewed code-owned meanings may be activated.', ['meanings']);
}

function uniqueCatalogMeanings(
  meanings: readonly MeaningDefinition[],
  current: readonly MeaningDefinition[],
): Outcome<readonly MeaningDefinition[]> {
  const added: MeaningDefinition[] = [];
  for (const meaning of meanings) {
    const prior = current.find((candidate) => candidate.id === meaning.id && candidate.revision === meaning.revision);
    if (prior === undefined) {
      added.push(meaning);
      continue;
    }
    if (canonical(prior) !== canonical(meaning))
      return failure(
        'data.meaning-conflict',
        `Meaning ${meaning.id}@${meaning.revision} conflicts with the current catalog.`,
        ['meanings'],
      );
  }
  return { ok: true, value: added };
}

function activationReceipts(
  meanings: readonly MeaningDefinition[],
  control: ActivationControl,
): Outcome<readonly MeaningActivationReceipt[]> {
  const reviewed = reviewOrigin(meanings);
  if (!reviewed.ok) return reviewed;
  const receipts: MeaningActivationReceipt[] = [];
  for (const meaning of meanings) {
    const activation = authorizeMeaningActivation(meaning, control.policy);
    if (!activation.ok) return activation;
    receipts.push(activation.value);
  }
  return { ok: true, value: receipts };
}

function appendMeanings(state: LocalDataServiceState, meanings: readonly MeaningDefinition[]): Outcome<void> {
  const revision = secureToken('catalog');
  if (revision === undefined) return failure('data.crypto', 'WebCrypto unavailable.');
  const catalog = parseCatalog({
    ...state.currentCatalog,
    revision,
    meanings: [...state.currentCatalog.meanings, ...meanings],
  });
  if (!catalog.ok) return catalog;
  state.currentCatalog = freezeCatalog(catalog.value);
  state.plans.clear();
  return { ok: true, value: undefined };
}

function secureToken(prefix: string): string | undefined {
  const provider = globalThis.crypto;
  if (provider?.getRandomValues === undefined) return undefined;
  const bytes = new Uint8Array(16);
  provider.getRandomValues(bytes);
  let encoded = '';
  for (const byte of bytes) encoded += byte.toString(16).padStart(2, '0');
  return `${prefix}-${encoded}`;
}
