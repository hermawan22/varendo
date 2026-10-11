import * as z from 'zod/mini';
import { inspectWire } from '../contracts/ingress.js';
import { meaningSchema } from '../contracts/schemas.js';
import type { MeaningDefinition, Outcome } from '../contracts/types.js';
import { stableJson } from '../contracts/stable.js';
import { createCatalogIndex, versionKey } from './catalog.js';
import { isRecord, prependOutcomePath, semanticFailure } from './errors.js';
import { validateMeaningDependencyClosure, type MeaningClosureRoot } from './meaning-closure.js';
import { validateMeaningValueForBundle, type MeaningValidationContext } from './meaning-validation.js';
import type { CatalogIndex, MeaningBundle, MeaningBundleContext } from './types.js';

interface MeaningBundleInput {
  readonly catalogRevision: string;
  readonly functionRegistryDigest: string;
  readonly meanings: readonly unknown[];
}

function inspectBundle(input: unknown, context: MeaningBundleContext): Outcome<MeaningBundleInput> {
  const inspected = inspectWire(input);
  if (!inspected.ok) return inspected;
  if (!isRecord(inspected.value))
    return semanticFailure('semantic.bundle-shape', 'Meaning bundle must be a plain object.');
  const bundle = inspected.value;
  if (typeof bundle.catalogRevision !== 'string' || bundle.catalogRevision.length === 0)
    return semanticFailure('semantic.bundle-catalog', 'Meaning bundle must pin a catalog revision.', [
      'catalogRevision',
    ]);
  if (typeof bundle.functionRegistryDigest !== 'string' || bundle.functionRegistryDigest.length === 0)
    return semanticFailure('semantic.bundle-registry', 'Meaning bundle must pin a function registry digest.', [
      'functionRegistryDigest',
    ]);
  if (!Array.isArray(bundle.meanings))
    return semanticFailure('semantic.bundle-meanings', 'Meaning bundle meanings must be an array.', ['meanings']);
  if (bundle.catalogRevision !== context.catalog.revision)
    return semanticFailure(
      'semantic.stale-catalog',
      'Meaning bundle was authored against a different catalog revision.',
      ['catalogRevision'],
    );
  if (bundle.functionRegistryDigest !== context.registry.digest)
    return semanticFailure('semantic.stale-registry', 'Meaning bundle pins a different function registry digest.', [
      'functionRegistryDigest',
    ]);
  if (context.registry.digest !== context.catalog.functionRegistryDigest)
    return semanticFailure(
      'semantic.stale-registry',
      'The supplied function registry does not match the catalog registry pin.',
      ['functionRegistryDigest'],
    );
  return {
    ok: true,
    value: {
      catalogRevision: bundle.catalogRevision,
      functionRegistryDigest: bundle.functionRegistryDigest,
      meanings: bundle.meanings,
    },
  };
}

function inheritedDefinitions(context: MeaningBundleContext): Outcome<Map<string, MeaningDefinition>> {
  const inherited = new Map<string, MeaningDefinition>();
  for (const candidate of [...(context.definitions ?? []), ...context.catalog.meanings]) {
    const identity = versionKey(candidate);
    const prior = inherited.get(identity);
    if (prior !== undefined && stableJson(prior) !== stableJson(candidate))
      return semanticFailure(
        'semantic.definition-conflict',
        `Meaning ${candidate.id}@${candidate.revision} conflicts with an inherited definition.`,
        ['meanings'],
      );
    if (prior === undefined) inherited.set(identity, candidate);
  }
  return { ok: true, value: inherited };
}

interface SuppliedMeaning {
  readonly meaning: MeaningDefinition;
  readonly index: number;
}

function parseSuppliedMeanings(meanings: readonly unknown[]): Outcome<SuppliedMeaning[]> {
  const supplied: SuppliedMeaning[] = [];
  const identities = new Map<string, MeaningDefinition>();
  for (let index = 0; index < meanings.length; index += 1) {
    const parsed = z.safeParse(meaningSchema, meanings[index]);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return semanticFailure('semantic.shape', 'Meaning does not match the canonical meaning contract.', [
        'meanings',
        index,
        ...(issue?.path.filter((part): part is string | number => typeof part !== 'symbol') ?? []),
      ]);
    }
    const candidate = parsed.data as MeaningDefinition;
    const identity = versionKey(candidate);
    const prior = identities.get(identity);
    if (prior !== undefined && stableJson(prior) !== stableJson(candidate))
      return semanticFailure(
        'semantic.definition-conflict',
        `Meaning ${candidate.id}@${candidate.revision} has conflicting bundle contents.`,
        ['meanings', index],
      );
    if (prior === undefined) {
      identities.set(identity, candidate);
      supplied.push({ meaning: candidate, index });
    }
  }
  return { ok: true, value: supplied };
}

function combineDefinitions(
  supplied: readonly SuppliedMeaning[],
  inherited: ReadonlyMap<string, MeaningDefinition>,
): Outcome<Map<string, MeaningDefinition>> {
  const combined = new Map(inherited);
  for (const { meaning: candidate, index } of supplied) {
    const identity = versionKey(candidate);
    const prior = combined.get(identity);
    if (prior !== undefined && stableJson(prior) !== stableJson(candidate))
      return semanticFailure(
        'semantic.definition-conflict',
        `Meaning ${candidate.id}@${candidate.revision} conflicts with an inherited definition.`,
        ['meanings', index],
      );
    if (prior === undefined) combined.set(identity, candidate);
  }
  return { ok: true, value: combined };
}

function validateBundleEntries(
  supplied: readonly SuppliedMeaning[],
  context: MeaningBundleContext,
  index: CatalogIndex,
  available: ReadonlyMap<string, MeaningDefinition>,
): Outcome<MeaningDefinition[]> {
  const bundleMeanings: MeaningDefinition[] = [];
  const definitions = [...(context.definitions ?? []), ...supplied.map(({ meaning }) => meaning)];
  const validationContext: MeaningValidationContext = { ...context, index, definitions };
  for (const { meaning, index: inputIndex } of supplied) {
    const validated = validateMeaningValueForBundle(meaning, validationContext, available);
    if (!validated.ok) return prependOutcomePath(['meanings', inputIndex], validated);
    bundleMeanings.push(validated.value);
  }
  return { ok: true, value: bundleMeanings };
}

function validateBundleClosure(
  bundleMeanings: readonly MeaningDefinition[],
  context: MeaningBundleContext,
): Outcome<void> {
  const byIdentity = new Map<string, MeaningDefinition>();
  for (const meaning of [...(context.definitions ?? []), ...context.catalog.meanings, ...bundleMeanings])
    byIdentity.set(versionKey(meaning), meaning);
  const roots: MeaningClosureRoot[] = bundleMeanings.map((meaning, index) => ({ meaning, path: ['meanings', index] }));
  return validateMeaningDependencyClosure(roots, byIdentity, context, (candidate, nestedContext, definitions) =>
    validateMeaningValueForBundle(
      candidate,
      {
        ...nestedContext,
        definitions: [...definitions.values()],
      },
      definitions,
    ),
  );
}

/** Validate all definitions together so dependency ordering and cycles are independent of input order. */
export function validateMeaningBundle(input: unknown, context: MeaningBundleContext): Outcome<MeaningBundle> {
  const bundle = inspectBundle(input, context);
  if (!bundle.ok) return bundle;
  const index = createCatalogIndex(context.catalog);
  if (!index.ok) return index;
  const inherited = inheritedDefinitions(context);
  if (!inherited.ok) return inherited;
  const supplied = parseSuppliedMeanings(bundle.value.meanings);
  if (!supplied.ok) return supplied;
  const available = combineDefinitions(supplied.value, inherited.value);
  if (!available.ok) return available;
  const meanings = validateBundleEntries(supplied.value, context, index.value, available.value);
  if (!meanings.ok) return meanings;
  const closure = validateBundleClosure(meanings.value, context);
  if (!closure.ok) return closure;
  return {
    ok: true,
    value: {
      catalogRevision: bundle.value.catalogRevision,
      functionRegistryDigest: bundle.value.functionRegistryDigest,
      meanings: meanings.value,
    },
  };
}
