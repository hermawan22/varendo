import type { MeaningDefinition, Outcome, VersionRef } from '@varendo/core';
import { validateMeaningBundle } from '@varendo/core/semantics';
import type { MeaningBundle } from '@varendo/core/semantics';
import { canonicalMeaning, createMeaningDraft, freezeMeaningValue, meaningDigest, meaningRefKey } from './authoring.js';
import { activateMeaning } from './registry-activation.js';
import type { MeaningActivationState } from './registry-activation.js';
import { failure, sameRef, sourceForMeaning, validId, validateRegistrationDraft } from './registry-helpers.js';
import type {
  MeaningActivationOptions,
  MeaningActivationContext,
  MeaningEntry,
  MeaningRegistrationInput,
  MeaningRegistrationReceipt,
  MeaningRegistry,
  MeaningRevocationReceipt,
  MeaningSource,
} from './types.js';
import type { PreparedRegistryOptions } from './registry-helpers.js';

type BundleValidation = ReturnType<typeof validateMeaningBundle>;

function revokedReceipt(entry: MeaningEntry, catalogRevision: string): MeaningRevocationReceipt {
  return freezeMeaningValue({
    state: 'revoked' as const,
    meaning: { id: entry.draft.meaning.id, revision: entry.draft.meaning.revision },
    catalogRevision,
  });
}

function dependentClosure(root: string, entries: ReadonlyMap<string, MeaningEntry>): ReadonlySet<string> {
  const revoked = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, entry] of entries) {
      if (revoked.has(key) || !hasRevokedDependency(entry, revoked)) continue;
      revoked.add(key);
      changed = true;
    }
  }
  return revoked;
}

function hasRevokedDependency(entry: MeaningEntry, revoked: ReadonlySet<string>): boolean {
  return entry.draft.meaning.dependencies.some((dependency) => revoked.has(meaningRefKey(dependency)));
}

function definitionsWithoutBrokenDependencies(output: Map<string, MeaningDefinition>): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, meaning] of output) {
      if (!meaning.dependencies.some((ref) => !output.has(meaningRefKey(ref)))) continue;
      output.delete(key);
      changed = true;
    }
  }
}

export class MeaningRegistryController implements MeaningActivationState {
  readonly options: PreparedRegistryOptions['options'];
  readonly revokedScopes = new Set<string>();
  generation = 0;
  activatedOwner: { readonly principalKey: string; readonly scopeDigest: string } | undefined;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly inheritedDefinitions: readonly MeaningDefinition[];
  private readonly entries = new Map<string, MeaningEntry>();
  private readonly activeScopes = new Map<string, string>();
  private retainedBytes = 0;

  constructor(prepared: PreparedRegistryOptions) {
    this.options = prepared.options;
    this.maxEntries = prepared.maxEntries;
    this.maxBytes = prepared.maxBytes;
    this.inheritedDefinitions = [...prepared.options.catalog.meanings, ...(prepared.options.definitions ?? [])];
  }

  initialize(): Outcome<MeaningRegistry> {
    const checked = this.validateInitialBundle();
    if (!checked.ok) return checked;
    return { ok: true, value: this.registryApi() };
  }

  private validateInitialBundle(): BundleValidation {
    const bundle: MeaningBundle = {
      catalogRevision: this.options.catalog.revision,
      functionRegistryDigest: this.options.registry.digest,
      meanings: this.inheritedDefinitions,
    };
    try {
      return validateMeaningBundle(bundle, {
        catalog: this.options.catalog,
        registry: this.options.registry,
        definitions: this.inheritedDefinitions,
        ...(this.options.policy === undefined ? {} : { policy: this.options.policy }),
      });
    } catch {
      return failure('runtime.meaning-registry', 'Meaning registry initialization failed safely.');
    }
  }

  private registryApi(): MeaningRegistry {
    const api: MeaningRegistry = {
      catalog: this.options.catalog,
      registry: this.options.registry,
      register: (input) => this.register(input),
      registerBundle: (bundle, source) => this.registerBundle(bundle, source),
      get: (ref) => this.get(ref),
      list: (filter) => this.list(filter),
      definitions: (filter) => this.definitions(filter),
      activate: (ref, options) => this.activate(ref, options),
      revoke: (ref) => this.revoke(ref),
      revokeScope: (scopeDigest) => this.revokeScope(scopeDigest),
    };
    return Object.freeze(api);
  }

  private availableDefinitions(): readonly MeaningDefinition[] {
    const visible = new Map(this.inheritedDefinitions.map((meaning) => [meaningRefKey(meaning), meaning]));
    for (const [key, entry] of this.entries) {
      if (entry.revoked) visible.delete(key);
      else visible.set(key, entry.draft.meaning);
    }
    return [...visible.values()];
  }

  validationOptions(definitions = this.availableDefinitions()): PreparedRegistryOptions['options'] {
    return {
      ...this.options,
      catalog: {
        ...this.options.catalog,
        meanings: this.options.catalog.meanings.filter((meaning) => !this.entries.get(meaningRefKey(meaning))?.revoked),
      },
      definitions,
    };
  }

  private draftBytes(draft: import('./types.js').MeaningDraft): number {
    return new TextEncoder().encode(canonicalMeaning(draft)).byteLength;
  }

  private publishRegistration(draft: import('./types.js').MeaningDraft): Outcome<MeaningRegistrationReceipt> {
    const key = meaningRefKey(draft.meaning);
    const prior = this.entries.get(key);
    if (prior !== undefined) return this.existingRegistration(prior, draft);
    if (this.entries.size >= this.maxEntries) return failure('runtime.meaning-budget', 'The meaning registry is full.');
    const bytes = this.draftBytes(draft);
    if (this.retainedBytes + bytes > this.maxBytes)
      return failure('runtime.meaning-budget', 'The meaning registry byte capacity is exhausted.');
    this.retainedBytes += bytes;
    this.entries.set(key, Object.freeze({ draft: freezeMeaningValue(draft), active: false, revoked: false }));
    this.generation += 1;
    return { ok: true, value: this.registrationReceipt(draft, false, false) };
  }

  private existingRegistration(
    prior: MeaningEntry,
    draft: import('./types.js').MeaningDraft,
  ): Outcome<MeaningRegistrationReceipt> {
    if (prior.revoked)
      return failure('runtime.meaning-revoked', 'A revoked meaning version cannot be silently re-registered.', [
        'meaning',
        'revision',
      ]);
    if (canonicalMeaning(prior.draft.meaning) !== canonicalMeaning(draft.meaning))
      return failure(
        'runtime.meaning-conflict',
        'A meaning with this immutable ID and revision has different contents.',
        ['meaning', 'id', 'revision'],
      );
    return { ok: true, value: this.registrationReceipt(prior.draft, true, prior.active) };
  }

  private registrationReceipt(
    draft: import('./types.js').MeaningDraft,
    idempotent: boolean,
    active: boolean,
  ): MeaningRegistrationReceipt {
    return freezeMeaningValue({
      state: 'registered' as const,
      meaning: { id: draft.meaning.id, revision: draft.meaning.revision },
      digest: draft.digest,
      catalogRevision: this.options.catalog.revision,
      idempotent,
      active,
    });
  }

  register(input: MeaningRegistrationInput): Outcome<MeaningRegistrationReceipt> {
    const draft = input?.draft;
    if (draft === null || typeof draft !== 'object')
      return failure('runtime.meaning-registration', 'Meaning registration requires a canonical draft.');
    if (input.activate !== undefined && typeof input.activate !== 'boolean')
      return failure('runtime.meaning-registration', 'Meaning registration activation must be a boolean.', [
        'activate',
      ]);
    const checked = validateRegistrationDraft(draft, this.validationOptions());
    if (!checked.ok) return checked;
    const canonicalDraft = checked.value;
    if (canonicalDraft.meaning.functionRegistryDigest !== this.options.registry.digest)
      return failure('runtime.meaning-stale', 'Meaning definition pins a different function registry digest.', [
        'meaning',
        'functionRegistryDigest',
      ]);
    if (input.activate === true)
      return failure(
        'runtime.meaning-activation-required',
        'Registration cannot activate a meaning without a fresh host activation pass.',
      );
    return this.publishRegistration(canonicalDraft);
  }

  registerBundle(input: MeaningBundle, source?: MeaningSource): Outcome<readonly MeaningRegistrationReceipt[]> {
    const validated = this.validateBundle(input);
    if (!validated.ok) return validated;
    const drafts = this.prepareBundleDrafts(validated.value, source);
    if (!drafts.ok) return drafts;
    const capacity = this.validateBundleCapacity(drafts.value);
    if (!capacity.ok) return capacity;
    return this.publishBundleDrafts(drafts.value);
  }

  private validateBundle(input: MeaningBundle): BundleValidation {
    try {
      return validateMeaningBundle(input, this.validationOptions());
    } catch {
      return failure('runtime.meaning-registration', 'Meaning bundle validation failed safely.');
    }
  }

  private prepareBundleDrafts(
    bundle: MeaningBundle,
    source?: MeaningSource,
  ): Outcome<readonly import('./types.js').MeaningDraft[]> {
    const prospective = this.validationOptions([...this.availableDefinitions(), ...bundle.meanings]);
    const drafts: import('./types.js').MeaningDraft[] = [];
    for (const meaning of bundle.meanings) {
      const prepared = createMeaningDraft(meaning, prospective, { source: sourceForMeaning(meaning, source) });
      if (!prepared.ok) return prepared;
      drafts.push(prepared.value);
    }
    return { ok: true, value: drafts };
  }

  private validateBundleCapacity(drafts: readonly import('./types.js').MeaningDraft[]): Outcome<void> {
    for (const draft of drafts) {
      const prior = this.entries.get(meaningRefKey(draft.meaning));
      if (
        prior !== undefined &&
        (prior.revoked || canonicalMeaning(prior.draft.meaning) !== canonicalMeaning(draft.meaning))
      )
        return failure('runtime.meaning-conflict', 'Meaning bundle conflicts with an immutable registered version.', [
          'meanings',
        ]);
    }
    const additions = drafts.filter((draft) => !this.entries.has(meaningRefKey(draft.meaning)));
    if (this.entries.size + additions.length > this.maxEntries)
      return failure('runtime.meaning-budget', 'The meaning registry is full.');
    const bytes = additions.reduce((sum, draft) => sum + this.draftBytes(draft), 0);
    if (this.retainedBytes + bytes > this.maxBytes)
      return failure('runtime.meaning-budget', 'The meaning registry byte capacity is exhausted.');
    return { ok: true, value: undefined };
  }

  private publishBundleDrafts(
    drafts: readonly import('./types.js').MeaningDraft[],
  ): Outcome<readonly MeaningRegistrationReceipt[]> {
    const receipts: MeaningRegistrationReceipt[] = [];
    for (const draft of drafts) {
      const receipt = this.publishRegistration(draft);
      if (!receipt.ok) return receipt;
      receipts.push(receipt.value);
    }
    return { ok: true, value: Object.freeze(receipts) };
  }

  get(ref: VersionRef): MeaningEntry | undefined {
    if (!validId(ref?.id) || !validId(ref?.revision)) return undefined;
    return this.entries.get(meaningRefKey(ref));
  }

  list(filter: { readonly includeRevoked?: boolean; readonly activeOnly?: boolean } = {}): readonly MeaningEntry[] {
    return Object.freeze(
      [...this.entries.values()].filter(
        (entry) => (filter?.includeRevoked === true || !entry.revoked) && (filter?.activeOnly !== true || entry.active),
      ),
    );
  }

  definitions(filter: { readonly activeOnly?: boolean } = {}): readonly MeaningDefinition[] {
    const output = this.definitionMap(filter);
    definitionsWithoutBrokenDependencies(output);
    return Object.freeze([...output.values()]);
  }

  private definitionMap(filter: { readonly activeOnly?: boolean }): Map<string, MeaningDefinition> {
    const visible = this.availableDefinitions().filter((meaning) => this.shouldExposeDefinition(meaning, filter));
    return new Map(visible.map((meaning) => [meaningRefKey(meaning), meaning]));
  }

  private shouldExposeDefinition(meaning: MeaningDefinition, filter: { readonly activeOnly?: boolean }): boolean {
    const entry = this.entries.get(meaningRefKey(meaning));
    const exposed =
      entry === undefined || entry.active || this.inheritedDefinitions.some((item) => sameRef(item, meaning));
    return exposed && (filter?.activeOnly !== true || meaning.lifecycle === 'active');
  }

  activate(
    ref: VersionRef,
    options: MeaningActivationOptions = {},
  ): Promise<Outcome<import('@varendo/core/semantics').MeaningActivationReceipt>> {
    return activateMeaning(this, ref, options);
  }

  revoke(ref: VersionRef): Outcome<MeaningRevocationReceipt> {
    if (!validId(ref?.id) || !validId(ref?.revision))
      return failure('runtime.meaning-invalid', 'The meaning reference is malformed.', ['meaning']);
    const key = meaningRefKey(ref);
    const prior = this.entries.get(key);
    if (prior === undefined)
      return failure('runtime.meaning-unknown', 'The requested meaning version is not registered.', ['meaning']);
    if (prior.revoked) return { ok: true, value: revokedReceipt(prior, this.options.catalog.revision) };
    this.markRevoked(dependentClosure(key, this.entries));
    this.generation += 1;
    return { ok: true, value: revokedReceipt(prior, this.options.catalog.revision) };
  }

  private markRevoked(keys: ReadonlySet<string>): void {
    for (const key of keys) {
      const entry = this.entries.get(key)!;
      this.entries.set(key, Object.freeze({ draft: entry.draft, active: false, revoked: true }));
      this.activeScopes.delete(key);
    }
  }

  revokeScope(scopeDigest: string): Outcome<readonly MeaningRevocationReceipt[]> {
    if (!validId(scopeDigest))
      return failure('runtime.meaning-scope', 'The scope digest is malformed.', ['scopeDigest']);
    if (!this.revokedScopes.has(scopeDigest) && this.revokedScopes.size >= this.maxEntries)
      return failure('runtime.meaning-budget', 'The meaning registry scope revocation capacity is exhausted.');
    this.revokedScopes.add(scopeDigest);
    this.generation += 1;
    const before = new Set([...this.entries].filter(([, entry]) => !entry.revoked).map(([key]) => key));
    const result = this.revokeActiveScope(scopeDigest);
    if (!result.ok) return result;
    return { ok: true, value: this.scopeReceipts(before) };
  }

  private revokeActiveScope(scopeDigest: string): Outcome<void> {
    for (const [key, entry] of this.entries) {
      if (this.activeScopes.get(key) !== scopeDigest || !entry.active) continue;
      const result = this.revoke({ id: entry.draft.meaning.id, revision: entry.draft.meaning.revision });
      if (!result.ok) return result;
    }
    return { ok: true, value: undefined };
  }

  private scopeReceipts(before: ReadonlySet<string>): readonly MeaningRevocationReceipt[] {
    return [...this.entries]
      .filter(([key, entry]) => before.has(key) && entry.revoked)
      .map(([, entry]) => revokedReceipt(entry, this.options.catalog.revision));
  }

  commitActivation(ref: VersionRef, approved: MeaningDefinition, context: MeaningActivationContext): void {
    const current = this.get(ref)!;
    const draft = freezeMeaningValue({ ...current.draft, meaning: approved, digest: meaningDigest(approved) });
    this.entries.set(meaningRefKey(ref), Object.freeze({ draft, active: true, revoked: false }));
    this.activatedOwner ??= { principalKey: context.principalKey, scopeDigest: context.scopeDigest };
    this.activeScopes.set(meaningRefKey(ref), context.scopeDigest);
    this.generation += 1;
  }
}
