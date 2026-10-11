import * as z from 'zod/mini';
import { inspectWire } from '../contracts/ingress.js';
import { meaningSchema } from '../contracts/schemas.js';
import type { MeaningDefinition, Outcome, VersionRef } from '../contracts/types.js';
import { collectDefinitionRefs } from '../expressions/check-reference.js';
import { checkExpression } from '../expressions/check.js';
import { createCatalogIndex, versionKey } from './catalog.js';
import { semanticFailure } from './errors.js';
import { validateMeaningDependencyClosure } from './meaning-closure.js';
import { stableJson } from '../contracts/stable.js';
import { sameStringSet, validateSemanticType } from './type-utils.js';
import type { CatalogIndex, MeaningBundleContext, SemanticPolicy } from './types.js';

export interface MeaningValidationContext extends MeaningBundleContext {
  readonly index?: CatalogIndex;
  readonly entityId?: string;
}

interface MeaningValidationOptions {
  readonly skipDependencyClosure?: boolean;
  readonly availableDefinitions?: ReadonlyMap<string, MeaningDefinition>;
}

type ValidationFailure = Outcome<never> | undefined;

const authorityRank: Record<MeaningDefinition['authority'], number> = {
  hypothesis: 0,
  reviewed: 1,
  approved: 2,
};

function policyAuthorityRank(authority: MeaningDefinition['authority']): number {
  return authorityRank[authority];
}

function resolveMeaningIndex(context: MeaningValidationContext): Outcome<CatalogIndex> {
  if (context.registry.digest !== context.catalog.functionRegistryDigest)
    return semanticFailure(
      'semantic.stale-registry',
      'The supplied function registry does not match the catalog registry pin.',
      ['functionRegistryDigest'],
    );
  const indexOutcome =
    context.index === undefined ? createCatalogIndex(context.catalog) : { ok: true as const, value: context.index };
  if (!indexOutcome.ok) return indexOutcome;
  const index = indexOutcome.value;
  if (
    index.catalog.revision !== context.catalog.revision ||
    index.catalog.functionRegistryDigest !== context.catalog.functionRegistryDigest
  )
    return semanticFailure(
      'semantic.stale-catalog-index',
      'The supplied catalog index belongs to a different catalog revision or function registry pin.',
      ['catalog'],
    );
  return { ok: true, value: index };
}

function validateMeaningMetadata(meaning: MeaningDefinition, context: MeaningValidationContext): ValidationFailure {
  if (meaning.functionRegistryDigest !== context.registry.digest)
    return semanticFailure('semantic.stale-registry', 'Meaning pins a different function registry digest.', [
      'functionRegistryDigest',
    ]);
  const outputType = validateSemanticType(meaning.output, ['output']);
  if (!outputType.ok) return outputType;
  if (meaning.aggregation !== 'none' && meaning.missingPolicy === 'propagate' && !meaning.output.nullable)
    return semanticFailure('semantic.missing-policy', 'Nullable.', ['output', 'nullable']);
  const policyResult = validatePolicy(meaning, context.policy);
  if (policyResult !== undefined) return policyResult;
  if (new Set(meaning.dependencies.map(versionKey)).size !== meaning.dependencies.length)
    return semanticFailure('semantic.duplicate-dependency', 'Meaning dependencies must be unique.', ['dependencies']);
  return undefined;
}

function makeAvailableDefinitions(
  meaning: MeaningDefinition,
  context: MeaningValidationContext,
  options: MeaningValidationOptions,
): Outcome<ReadonlyMap<string, MeaningDefinition>> {
  let available: ReadonlyMap<string, MeaningDefinition>;
  if (options.availableDefinitions !== undefined) available = options.availableDefinitions;
  else {
    const indexed = new Map<string, MeaningDefinition>();
    for (const candidate of context.catalog.meanings) indexed.set(versionKey(candidate), candidate);
    for (const candidate of context.definitions ?? []) {
      const identity = versionKey(candidate);
      const prior = indexed.get(identity);
      if (prior !== undefined && stableJson(prior) !== stableJson(candidate))
        return semanticFailure(
          'semantic.definition-conflict',
          `Meaning ${candidate.id}@${candidate.revision} conflicts with an existing definition.`,
          ['definitions'],
        );
      if (prior === undefined) indexed.set(identity, candidate);
    }
    available = indexed;
  }
  const existing = available.get(versionKey(meaning));
  if (existing !== undefined && stableJson(existing) !== stableJson(meaning))
    return semanticFailure(
      'semantic.definition-conflict',
      `Meaning ${meaning.id}@${meaning.revision} conflicts with an existing definition.`,
      ['id', 'revision'],
    );
  return { ok: true, value: available };
}

function validateDeclaredDependencies(
  meaning: MeaningDefinition,
  context: MeaningValidationContext,
  available: ReadonlyMap<string, MeaningDefinition>,
): ValidationFailure {
  for (let index = 0; index < meaning.dependencies.length; index += 1) {
    const dependency = meaning.dependencies[index]!;
    const dependencyMeaning = available.get(versionKey(dependency));
    if (dependencyMeaning === undefined)
      return semanticFailure(
        'semantic.unknown-dependency',
        `Meaning dependency ${versionKey(dependency)} is not available.`,
        ['dependencies', index],
      );
    if (dependencyMeaning.functionRegistryDigest !== context.registry.digest)
      return semanticFailure(
        'semantic.stale-registry',
        `Meaning dependency ${dependencyMeaning.id}@${dependencyMeaning.revision} pins a different function registry digest.`,
        ['dependencies', index],
      );
  }
  return undefined;
}

function validateHostCapability(
  capability: VersionRef,
  context: MeaningValidationContext,
  index: CatalogIndex,
): ValidationFailure {
  if (context.policy?.allowHostCapabilities === false)
    return semanticFailure('semantic.host-capability-denied', 'Host-backed meanings are not allowed by this policy.', [
      'implementation',
      'capability',
    ]);
  if (index.resolveCapability(capability) === undefined)
    return semanticFailure('semantic.unknown-capability', `Capability ${versionKey(capability)} is not declared.`, [
      'implementation',
      'capability',
    ]);
  return undefined;
}

function validateOperationAggregation(meaning: MeaningDefinition, operation: string | undefined): ValidationFailure {
  if (operation === 'ratio-of-sums' && meaning.aggregation !== 'ratio-of-sums')
    return semanticFailure(
      'semantic.aggregation-mismatch',
      'A ratio-of-sums expression must declare ratio-of-sums aggregation.',
      ['aggregation'],
    );
  if (operation === 'mean-of-rates' && meaning.aggregation !== 'non-additive')
    return semanticFailure('semantic.aggregation-mismatch', 'Mean-of-rates must declare non-additive aggregation.', [
      'aggregation',
    ]);
  if (meaning.aggregation === 'ratio-of-sums' && operation !== 'ratio-of-sums')
    return semanticFailure(
      'semantic.aggregation-mismatch',
      'Ratio-of-sums aggregation requires a ratio-of-sums function identity.',
      ['implementation', 'expression'],
    );
  return undefined;
}

function validateExpressionImplementation(
  meaning: MeaningDefinition,
  context: MeaningValidationContext,
  index: CatalogIndex,
  definitions: readonly MeaningDefinition[],
): ValidationFailure {
  const expression = meaning.implementation.kind === 'expression' ? meaning.implementation.expression : undefined;
  if (expression === undefined) return undefined;
  const expressionDependencies = collectDefinitionRefs(expression);
  const expectedType =
    meaning.aggregation === 'none'
      ? meaning.output
      : {
          ...meaning.output,
          grain: [],
          nullable: true,
        };
  const checked = checkExpression(expression, {
    catalog: context.catalog,
    index,
    registry: context.registry,
    definitions: expressionDependencies.length === 0 ? [] : definitions,
    ...(context.entityId === undefined ? {} : { entityId: context.entityId }),
    ...(meaning.aggregation === 'none' ? {} : { evaluationContext: 'group' as const }),
    expectedType,
  });
  if (!checked.ok) return checked;
  for (const dependency of expressionDependencies) {
    if (!meaning.dependencies.some((candidate) => versionKey(candidate) === versionKey(dependency)))
      return semanticFailure(
        'semantic.unlisted-dependency',
        `Expression references ${versionKey(dependency)} without listing it as a dependency.`,
        ['implementation', 'expression'],
      );
  }
  return validateOperationAggregation(meaning, checked.value.operation);
}

function validateImplementation(
  meaning: MeaningDefinition,
  context: MeaningValidationContext,
  index: CatalogIndex,
  definitions: readonly MeaningDefinition[],
): ValidationFailure {
  if (meaning.implementation.kind === 'host-capability')
    return validateHostCapability(meaning.implementation.capability, context, index);
  return validateExpressionImplementation(meaning, context, index, definitions);
}

function validateAggregationDimensions(meaning: MeaningDefinition): ValidationFailure {
  if (new Set(meaning.aggregationDimensions).size !== meaning.aggregationDimensions.length)
    return semanticFailure('semantic.aggregation-grain', 'Aggregation dimensions must be unique.', [
      'aggregationDimensions',
    ]);
  if (meaning.aggregationDimensions.length === 0) return undefined;
  const grain = meaning.output.grain ?? [];
  if (
    !sameStringSet(
      meaning.aggregationDimensions,
      meaning.aggregationDimensions.filter((dimension) => grain.includes(dimension)),
    )
  )
    return semanticFailure(
      'semantic.aggregation-grain',
      'Aggregation dimensions must be declared output grain dimensions.',
      ['aggregationDimensions'],
    );
  return undefined;
}

function validateMeaningValue(
  meaning: MeaningDefinition,
  context: MeaningValidationContext,
  options: MeaningValidationOptions = {},
): Outcome<MeaningDefinition> {
  const indexOutcome = resolveMeaningIndex(context);
  if (!indexOutcome.ok) return indexOutcome;
  const metadata = validateMeaningMetadata(meaning, context);
  if (metadata !== undefined) return metadata;
  const available = makeAvailableDefinitions(meaning, context, options);
  if (!available.ok) return available;
  const dependencies = validateDeclaredDependencies(meaning, context, available.value);
  if (dependencies !== undefined) return dependencies;
  if (!options.skipDependencyClosure) {
    const closure = validateMeaningDependencyClosure(
      [{ meaning, path: [] }],
      available.value,
      context,
      (candidate, nestedContext, definitions) =>
        validateMeaningValue(
          candidate,
          { ...nestedContext, definitions: [...definitions.values()] },
          {
            availableDefinitions: definitions,
            skipDependencyClosure: true,
          },
        ),
    );
    if (!closure.ok) return closure;
  }
  const implementation = validateImplementation(meaning, context, indexOutcome.value, context.definitions ?? []);
  if (implementation !== undefined) return implementation;
  const dimensions = validateAggregationDimensions(meaning);
  if (dimensions !== undefined) return dimensions;
  return { ok: true, value: meaning };
}

export function validateMeaning(input: unknown, context: MeaningValidationContext): Outcome<MeaningDefinition> {
  const inspected = inspectWire(input);
  if (!inspected.ok) return inspected;
  const parsed = z.safeParse(meaningSchema, inspected.value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return semanticFailure(
      'semantic.shape',
      'Meaning does not match the canonical meaning contract.',
      issue?.path.filter((part): part is string | number => typeof part !== 'symbol'),
    );
  }
  return validateMeaningValue(parsed.data as MeaningDefinition, context);
}

export function validateMeaningValueForBundle(
  meaning: MeaningDefinition,
  context: MeaningValidationContext,
  availableDefinitions: ReadonlyMap<string, MeaningDefinition>,
): Outcome<MeaningDefinition> {
  return validateMeaningValue(meaning, context, {
    availableDefinitions,
    skipDependencyClosure: true,
  });
}

function validatePolicy(meaning: MeaningDefinition, policy: SemanticPolicy | undefined): ValidationFailure {
  if (policy?.allowedScopes !== undefined && !policy.allowedScopes.includes(meaning.scope))
    return semanticFailure('semantic.scope', `Meaning scope ${meaning.scope} is not permitted by this policy.`, [
      'scope',
    ]);
  if (
    meaning.lifecycle === 'active' &&
    policy?.minAuthorityForActive !== undefined &&
    policyAuthorityRank(meaning.authority) < policyAuthorityRank(policy.minAuthorityForActive)
  )
    return semanticFailure(
      'semantic.authority',
      `Active meaning requires ${policy.minAuthorityForActive} authority under this policy.`,
      ['authority'],
    );
  return undefined;
}
