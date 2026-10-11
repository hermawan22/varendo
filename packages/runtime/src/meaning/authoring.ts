import {
  WIRE_LIMITS,
  parseWireValue,
  type Catalog,
  type MeaningDefinition,
  type Outcome,
  type VersionRef,
} from '@varendo/core';
import { canonicalJson } from '../canonical.js';
import { createTypedAuthoring, createFunctionRegistry } from '@varendo/core/expressions';
import type { DefineMetricInput, FunctionRegistry, TypedAuthoring } from '@varendo/core/expressions';
import { validateMeaning } from '@varendo/core/semantics';
import type {
  MeaningAuthoring,
  MeaningAuthoringOptions,
  MeaningDefinitionInput,
  MeaningDiff,
  MeaningDraft,
  MeaningSource,
} from './types.js';

function failure<T>(code: string, message: string, path?: readonly (string | number)[]): Outcome<T> {
  return {
    ok: false,
    diagnostics: [{ code, message, retryable: false, ...(path === undefined ? {} : { path: [...path] }) }],
  };
}

function outcomeCast<T>(outcome: Outcome<unknown>): Outcome<T> {
  return outcome.ok ? { ok: true, value: outcome.value as T } : { ok: false, diagnostics: outcome.diagnostics };
}

/** Stable object ordering is used only for equality and local registry identities. */
export function canonicalMeaning(value: unknown): string {
  return canonicalJson(value);
}

/** A bounded, deterministic digest for UI/cache identity. Equality also checks canonical contents. */
export function meaningDigest(value: unknown): string {
  let hash = 2166136261;
  for (const character of canonicalMeaning(value)) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `meaning-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function meaningRefKey(ref: VersionRef): string {
  return JSON.stringify([ref.id, ref.revision]);
}

export function freezeMeaningValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeMeaningValue(entry))) as T;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) copy[key] = freezeMeaningValue(child);
  return Object.freeze(copy) as T;
}

function snapshotWireValue<T>(value: T): Outcome<T> {
  const inspected = parseWireValue(value);
  if (!inspected.ok) return outcomeCast(inspected);
  return { ok: true, value: freezeMeaningValue(inspected.value) as T };
}

function snapshotRegistry(input: FunctionRegistry): Outcome<FunctionRegistry> {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.signatures))
    return failure('runtime.meaning-registry', 'A canonical function registry is required.', ['registry']);
  const signatures = snapshotWireValue(input.signatures);
  if (!signatures.ok) return signatures;
  const created = createFunctionRegistry({ digest: input.digest, signatures: signatures.value });
  if (!created.ok) return created;
  // The core registry already validates the declared signature shape. Deeply
  // freeze the returned signatures again so unknown wire members cannot retain
  // an alias to caller-owned nested data, and close resolve over that snapshot.
  const frozenSignatures = Object.freeze(created.value.signatures.map((signature) => freezeMeaningValue(signature)));
  const snapshot: FunctionRegistry = {
    digest: created.value.digest,
    signatures: frozenSignatures,
    resolve(ref: VersionRef) {
      return frozenSignatures.find(
        (signature) => signature.ref.id === ref.id && signature.ref.revision === ref.revision,
      );
    },
  };
  return { ok: true, value: Object.freeze(snapshot) };
}

type OptionalAuthoringInputs = Readonly<Record<string, unknown>>;

function snapshotOptionalInputs(options: MeaningAuthoringOptions<Catalog>): Outcome<OptionalAuthoringInputs> {
  const source: readonly (readonly [string, unknown])[] = [
    ['definitions', options.definitions],
    ['policy', options.policy],
    ['source', options.source],
    ['assumptions', options.assumptions],
  ];
  const snapshot: Record<string, unknown> = {};
  for (const [key, value] of source) {
    if (value === undefined) continue;
    const copied = snapshotWireValue(value);
    if (!copied.ok) return copied;
    snapshot[key] = copied.value;
  }
  return { ok: true, value: snapshot };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateOptionalInputs(values: OptionalAuthoringInputs): Outcome<void> {
  if (values.definitions !== undefined && !Array.isArray(values.definitions))
    return failure('runtime.meaning-definitions', 'Meaning definitions must be an array.', ['definitions']);
  if (values.policy !== undefined && !isRecord(values.policy))
    return failure('runtime.meaning-policy', 'Meaning policy must be a plain object.', ['policy']);
  if (values.source !== undefined && !isRecord(values.source))
    return failure('runtime.meaning-source', 'Meaning source must be a plain object.', ['source']);
  if (values.assumptions !== undefined && !Array.isArray(values.assumptions))
    return failure('runtime.meaning-assumptions', 'Meaning assumptions must be an array.', ['assumptions']);
  return { ok: true, value: undefined };
}

/**
 * Normalize the mutable host inputs once at the authoring boundary. This is
 * intentionally kept out of the public meaning barrel; the runtime registry
 * can reuse it while preserving one canonical catalog/registry snapshot.
 */
export function snapshotMeaningAuthoringOptions<const C extends Catalog>(
  options: MeaningAuthoringOptions<C>,
): Outcome<MeaningAuthoringOptions<C>> {
  if (!isRecord(options)) return failure('runtime.meaning-authoring', 'Meaning authoring options are required.');
  const registry = snapshotRegistry(options.registry);
  if (!registry.ok) return registry;
  const optional = snapshotOptionalInputs(options);
  if (!optional.ok) return optional;
  const valid = validateOptionalInputs(optional.value);
  if (!valid.ok) return valid;
  const candidate = {
    catalog: options.catalog,
    registry: registry.value,
    ...optional.value,
  } as MeaningAuthoringOptions<C>;
  let typed: Outcome<TypedAuthoring<C>>;
  try {
    typed = createTypedAuthoring(candidate);
  } catch {
    return failure('runtime.meaning-authoring', 'Meaning authoring options failed safely at the canonical boundary.');
  }
  if (!typed.ok) return typed;
  return {
    ok: true,
    value: Object.freeze({
      ...candidate,
      catalog: typed.value.catalog,
      registry: typed.value.registry,
    }),
  };
}

function validText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validRef(value: unknown): value is VersionRef {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    validText((value as Record<string, unknown>).id, WIRE_LIMITS.id) &&
    validText((value as Record<string, unknown>).revision, WIRE_LIMITS.id) &&
    !/[\s]/u.test((value as Record<string, unknown>).id as string) &&
    !/[\s]/u.test((value as Record<string, unknown>).revision as string)
  );
}

function defaultSource(meaning: MeaningDefinition): MeaningSource {
  if (meaning.origin === 'ai-assisted') return { surface: 'ai-assisted', ownership: meaning.scope };
  return { surface: 'code', ownership: 'code', readOnly: true };
}

function sourceSurfaceValid(value: MeaningSource): boolean {
  return value.surface === 'code' || value.surface === 'ai-assisted';
}

const SOURCE_OWNERSHIPS: ReadonlySet<string> = new Set(['code', 'session', 'personal', 'workspace', 'organization']);

function sourceOwnershipValid(value: MeaningSource): boolean {
  return SOURCE_OWNERSHIPS.has(value.ownership);
}

function sourceOriginValid(value: MeaningSource, meaning: MeaningDefinition): boolean {
  return value.surface !== 'ai-assisted' || meaning.origin === 'ai-assisted';
}

function sourceOwnerValid(value: MeaningSource): boolean {
  return value.ownerId === undefined || validText(value.ownerId, WIRE_LIMITS.id);
}

function normalizeSource(source: MeaningSource | undefined, meaning: MeaningDefinition): Outcome<MeaningSource> {
  const value = source ?? defaultSource(meaning);
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return failure('runtime.meaning-source', 'Meaning source must be a bounded object.', ['source']);
  if (!sourceSurfaceValid(value))
    return failure('runtime.meaning-source', 'Meaning source surface is unsupported.', ['source', 'surface']);
  if (!sourceOwnershipValid(value))
    return failure('runtime.meaning-source', 'Meaning ownership is unsupported.', ['source', 'ownership']);
  if (!sourceOriginValid(value, meaning))
    return failure('runtime.meaning-origin', 'AI-assisted source must preserve ai-assisted origin.', ['origin']);
  if (!sourceOwnerValid(value))
    return failure('runtime.meaning-source', 'Meaning owner identity is not bounded.', ['source', 'ownerId']);
  return {
    ok: true,
    value: freezeMeaningValue({
      surface: value.surface,
      ownership: value.ownership,
      ...(value.ownership === 'code' || value.readOnly === true ? { readOnly: true } : {}),
      ...(value.ownerId === undefined ? {} : { ownerId: value.ownerId }),
    }),
  };
}

function normalizeAssumptions(input: readonly string[] | undefined): Outcome<readonly string[]> {
  const assumptions = input === undefined ? [] : input;
  if (!Array.isArray(assumptions) || assumptions.length > WIRE_LIMITS.diagnostics)
    return failure('runtime.meaning-assumptions', 'Meaning assumptions exceed their bound.', ['assumptions']);
  if (assumptions.some((assumption) => !validText(assumption, WIRE_LIMITS.label)))
    return failure('runtime.meaning-assumptions', 'Meaning assumptions must be bounded text.', ['assumptions']);
  return { ok: true, value: Object.freeze([...assumptions]) };
}

function validateCandidate<C extends Catalog>(
  meaning: MeaningDefinition,
  options: MeaningAuthoringOptions<C>,
): Outcome<MeaningDefinition> {
  return validateMeaning(meaning, {
    catalog: options.catalog,
    registry: options.registry,
    ...(options.definitions === undefined ? {} : { definitions: options.definitions }),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
  });
}

function makeDraft<C extends Catalog>(
  meaning: MeaningDefinition,
  options: MeaningAuthoringOptions<C>,
  draftOptions: {
    readonly source?: MeaningSource;
    readonly assumptions?: readonly string[];
    readonly base?: VersionRef;
  } = {},
): Outcome<MeaningDraft> {
  if (draftOptions.base !== undefined && !validRef(draftOptions.base))
    return failure('runtime.meaning-base', 'Meaning draft base reference is malformed.', ['base']);
  const checked = validateCandidate(meaning, options);
  if (!checked.ok) return checked;
  const source = normalizeSource(draftOptions.source ?? options.source, checked.value);
  if (!source.ok) return source;
  const assumptions = normalizeAssumptions(draftOptions.assumptions ?? options.assumptions);
  if (!assumptions.ok) return assumptions;
  const canonical = freezeMeaningValue(checked.value);
  const digest = meaningDigest(canonical);
  return {
    ok: true,
    value: freezeMeaningValue({
      version: '1' as const,
      meaning: canonical,
      source: source.value,
      digest,
      assumptions: assumptions.value,
      ...(draftOptions.base === undefined ? {} : { base: freezeMeaningValue({ ...draftOptions.base }) }),
    }),
  };
}

function meaningFromBase(base: MeaningDraft | MeaningDefinition): {
  readonly meaning: MeaningDefinition;
  readonly source?: MeaningSource;
  readonly assumptions?: readonly string[];
} {
  if ('meaning' in base && 'source' in base) return base;
  return { meaning: base };
}

function validMeaningBase(base: unknown): base is MeaningDraft | MeaningDefinition {
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return false;
  const value = base as Record<string, unknown>;
  const meaning = 'meaning' in value ? value.meaning : value;
  return meaning !== null && typeof meaning === 'object' && validRef(meaning);
}

function changedFields(left: MeaningDefinition, right: MeaningDefinition): readonly string[] {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return Object.freeze(
    [...keys]
      .filter(
        (key) =>
          canonicalMeaning((left as Record<string, unknown>)[key]) !==
          canonicalMeaning((right as Record<string, unknown>)[key]),
      )
      .sort(),
  );
}

type DraftOptions = {
  readonly source?: MeaningSource;
  readonly assumptions?: readonly string[];
  readonly base?: VersionRef;
};

type EditOptions = { readonly source?: MeaningSource; readonly assumptions?: readonly string[] };

function metricInput(input: MeaningDefinitionInput): DefineMetricInput {
  return {
    id: input.id,
    ...(input.revision === undefined ? {} : { revision: input.revision }),
    label: input.label,
    description: input.description,
    expression: input.expression,
    ...(input.aggregation === undefined ? {} : { aggregation: input.aggregation }),
    ...(input.aggregationDimensions === undefined ? {} : { aggregationDimensions: input.aggregationDimensions }),
    ...(input.missingPolicy === undefined ? {} : { missingPolicy: input.missingPolicy }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.dependencies === undefined ? {} : { dependencies: input.dependencies }),
  };
}

function createDefinitionBuilder<C extends Catalog>(
  typed: TypedAuthoring<C>,
  options: MeaningAuthoringOptions<C>,
): (input: MeaningDefinitionInput) => Outcome<MeaningDraft> {
  return (input) => {
    const base = typed.defineMetric(metricInput(input));
    if (!base.ok) return base;
    const meaning: MeaningDefinition = {
      ...base.value,
      ...(input.origin === undefined ? {} : { origin: input.origin }),
      ...(input.lifecycle === undefined ? {} : { lifecycle: input.lifecycle }),
      ...(input.authority === undefined ? {} : { authority: input.authority }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
    };
    return makeDraft(meaning, options, input.assumptions === undefined ? {} : { assumptions: input.assumptions });
  };
}

function createDraftBuilder<C extends Catalog>(options: MeaningAuthoringOptions<C>) {
  return (meaning: MeaningDefinition, draftOptions: DraftOptions = {}): Outcome<MeaningDraft> =>
    makeDraft(meaning, options, draftOptions);
}

function createEditor<C extends Catalog>(options: MeaningAuthoringOptions<C>) {
  return (base: MeaningDraft | MeaningDefinition, meaning: MeaningDefinition, editOptions: EditOptions = {}) => {
    if (!validMeaningBase(base))
      return failure<MeaningDraft>('runtime.meaning-base', 'Meaning edit requires a canonical base definition.', [
        'base',
      ]);
    const previous = meaningFromBase(base);
    if (previous.source?.ownership === 'code' && canonicalMeaning(previous.meaning) !== canonicalMeaning(meaning))
      return failure<MeaningDraft>(
        'runtime.meaning-read-only',
        'Code-owned meanings are read-only; submit a proposed diff or a new reviewed revision.',
        ['meaning'],
      );
    return makeDraft(meaning, options, {
      ...((editOptions.source ?? previous.source) === undefined
        ? {}
        : { source: editOptions.source ?? previous.source }),
      ...((editOptions.assumptions ?? previous.assumptions) === undefined
        ? {}
        : { assumptions: editOptions.assumptions ?? previous.assumptions }),
      base: { id: previous.meaning.id, revision: previous.meaning.revision },
    });
  };
}

function sourceForDiff(supplied: MeaningSource | undefined, previous: ReturnType<typeof meaningFromBase>) {
  if (supplied !== undefined) return supplied;
  if (previous.source?.ownership === 'code') return { surface: 'code', ownership: 'code', readOnly: true } as const;
  return previous.source;
}

function diffDraftOptions(options: EditOptions, previous: ReturnType<typeof meaningFromBase>): DraftOptions {
  const source = sourceForDiff(options.source, previous);
  const assumptions = options.assumptions ?? previous.assumptions;
  return {
    ...(source === undefined ? {} : { source }),
    ...(assumptions === undefined ? {} : { assumptions }),
    base: { id: previous.meaning.id, revision: previous.meaning.revision },
  };
}

function priorDraft(
  base: MeaningDraft | MeaningDefinition,
  previous: ReturnType<typeof meaningFromBase>,
  options: MeaningAuthoringOptions<Catalog>,
): MeaningDraft | undefined {
  if ('meaning' in base && 'source' in base) return base;
  const draftOptions = {
    ...(previous.source === undefined ? {} : { source: previous.source }),
    ...(previous.assumptions === undefined ? {} : { assumptions: previous.assumptions }),
  };
  const result = makeDraft(previous.meaning, options, draftOptions);
  return result.ok ? result.value : undefined;
}

function definitionsEqual(left: MeaningDefinition, right: MeaningDefinition): boolean {
  return meaningRefKey(left) === meaningRefKey(right) && canonicalMeaning(left) === canonicalMeaning(right);
}

function createDiffProposer<C extends Catalog>(options: MeaningAuthoringOptions<C>) {
  return (
    base: MeaningDraft | MeaningDefinition,
    meaning: MeaningDefinition,
    diffOptions: EditOptions = {},
  ): Outcome<MeaningDiff> => {
    if (!validMeaningBase(base))
      return failure('runtime.meaning-base', 'Meaning diff requires a canonical base definition.', ['base']);
    const previous = meaningFromBase(base);
    const candidate = makeDraft(meaning, options, diffDraftOptions(diffOptions, previous));
    if (!candidate.ok) return candidate;
    if (definitionsEqual(previous.meaning, candidate.value.meaning))
      return failure(
        'runtime.meaning-no-change',
        'The proposed meaning diff does not change its canonical definition.',
        ['meaning'],
      );
    const baseValue = priorDraft(base, previous, options);
    if (baseValue === undefined)
      return failure('runtime.meaning-diff', 'The base meaning could not be normalized for diffing.', ['meaning']);
    return {
      ok: true,
      value: freezeMeaningValue({
        version: '1' as const,
        state: 'proposed-diff' as const,
        base: baseValue,
        candidate: candidate.value,
        changed: changedFields(previous.meaning, candidate.value.meaning),
      }),
    };
  };
}

/**
 * Shared manual authoring surface. It delegates expression construction and all
 * type/grain/dependency checks to core's canonical typed authoring helper.
 */
export function createMeaningAuthoring<const C extends Catalog>(
  options: MeaningAuthoringOptions<C>,
): Outcome<MeaningAuthoring<C>> {
  const snapshot = snapshotMeaningAuthoringOptions(options);
  if (!snapshot.ok) return snapshot;
  const typed = createTypedAuthoring(snapshot.value);
  if (!typed.ok) return typed;
  const value: TypedAuthoring<C> = typed.value;
  const defineMeaning = createDefinitionBuilder(value, snapshot.value);
  const draft = createDraftBuilder(snapshot.value);
  const edit = createEditor(snapshot.value);
  const proposeDiff = createDiffProposer(snapshot.value);
  return { ok: true, value: Object.freeze({ ...value, defineMeaning, draft, edit, proposeDiff }) };
}

export function createMeaningDraft<C extends Catalog>(
  meaning: MeaningDefinition,
  options: MeaningAuthoringOptions<C>,
  draftOptions?: {
    readonly source?: MeaningSource;
    readonly assumptions?: readonly string[];
    readonly base?: VersionRef;
  },
): Outcome<MeaningDraft> {
  return makeDraft(meaning, options, draftOptions);
}
