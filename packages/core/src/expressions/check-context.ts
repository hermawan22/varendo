import type { Catalog, MeaningDefinition, Outcome, SemanticType } from '../contracts/types.js';
import { createCatalogIndex } from '../semantics/catalog.js';
import { semanticFailure } from '../semantics/errors.js';
import type { CatalogIndex, EvaluationContext } from '../semantics/types.js';
import type { FunctionRegistry } from './types.js';
import { expressionReferenceKey } from './check-reference.js';
import { stableJson } from '../contracts/stable.js';

export interface ExpressionCheckContext {
  readonly catalog: Catalog;
  readonly registry: FunctionRegistry;
  readonly index?: CatalogIndex;
  readonly definitions?: readonly MeaningDefinition[];
  readonly entityId?: string;
  readonly evaluationContext?: EvaluationContext;
  readonly expectedType?: SemanticType;
  readonly maxNodes?: number;
  readonly maxDepth?: number;
}

export interface PreparedExpressionContext {
  readonly index: CatalogIndex;
  readonly definitions: ReadonlyMap<string, MeaningDefinition>;
  readonly maxNodes: number;
  readonly maxDepth: number;
}

export function prepareExpressionContext(context: ExpressionCheckContext): Outcome<PreparedExpressionContext> {
  if (context.registry.digest !== context.catalog.functionRegistryDigest)
    return semanticFailure(
      'semantic.stale-registry',
      'The supplied function registry does not match the catalog registry pin.',
      ['functionRegistryDigest'],
    );
  const index =
    context.index === undefined ? createCatalogIndex(context.catalog) : { ok: true as const, value: context.index };
  if (!index.ok) return index;
  if (!matchesCatalogRevision(index.value, context.catalog))
    return semanticFailure(
      'semantic.stale-catalog-index',
      'The supplied catalog index belongs to a different catalog revision or function registry pin.',
      ['catalog'],
    );
  const definitions = collectDefinitions(context.catalog.meanings, context.definitions ?? []);
  if (!definitions.ok) return definitions;
  const maxNodes = context.maxNodes ?? 256;
  const maxDepth = context.maxDepth ?? 64;
  const budgetFailure = validateBudgets(maxNodes, maxDepth);
  if (budgetFailure !== undefined) return budgetFailure;
  return { ok: true, value: { index: index.value, definitions: definitions.value, maxNodes, maxDepth } };
}

function matchesCatalogRevision(index: CatalogIndex, catalog: Catalog): boolean {
  return (
    index.catalog.revision === catalog.revision &&
    index.catalog.functionRegistryDigest === catalog.functionRegistryDigest
  );
}

function collectDefinitions(
  catalogDefinitions: readonly MeaningDefinition[],
  suppliedDefinitions: readonly MeaningDefinition[],
): Outcome<Map<string, MeaningDefinition>> {
  const definitions = new Map<string, MeaningDefinition>();
  for (const meaning of catalogDefinitions) definitions.set(expressionReferenceKey(meaning), meaning);
  for (const meaning of suppliedDefinitions) {
    const identity = expressionReferenceKey(meaning);
    const prior = definitions.get(identity);
    if (prior !== undefined && stableJson(prior) !== stableJson(meaning))
      return semanticFailure(
        'semantic.definition-conflict',
        `Meaning ${meaning.id}@${meaning.revision} conflicts with the catalog definition.`,
        ['definitions'],
      );
    if (prior === undefined) definitions.set(identity, meaning);
  }
  return { ok: true, value: definitions };
}

function validateBudgets(maxNodes: number, maxDepth: number): Outcome<never> | undefined {
  if (!Number.isSafeInteger(maxNodes) || maxNodes <= 0)
    return semanticFailure('semantic.budget', 'Expression node budget must be a positive safe integer.', ['maxNodes']);
  if (!Number.isSafeInteger(maxDepth) || maxDepth <= 0)
    return semanticFailure('semantic.budget', 'Expression depth budget must be a positive safe integer.', ['maxDepth']);
  return undefined;
}
