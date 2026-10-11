import { inspectWire } from '../contracts/ingress.js';
import { parseCatalog, parseQuery } from '../contracts/parse.js';
import type { Catalog, MeaningDefinition } from '../contracts/types.js';
import { createFunctionRegistry } from '../expressions/registry.js';
import type { FunctionRegistry } from '../expressions/types.js';
import { createCatalogIndex } from '../semantics/catalog.js';
import { validateMeaning } from '../semantics/meaning.js';
import { evaluateLogicalPlan } from './evaluator.js';
import { DEFAULT_LIMITS, buildPlan, lowerQuerySpec } from './planner.js';
import { failure, immutableSnapshot } from './planner/shared.js';
import type {
  QueryLimits,
  QueryOutcome,
  QueryPlanner,
  QueryPlannerOptions,
  QuerySource,
  QueryExecutionContext,
  LogicalPlan,
  RelationalQuery,
} from './types.js';

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function prepareCatalog(input: unknown): QueryOutcome<Catalog> {
  const parsed = parseCatalog(input);
  if (!parsed.ok) return parsed;
  try {
    const catalog = immutableSnapshot(parsed.value);
    const indexed = createCatalogIndex(catalog);
    return indexed.ok ? { ok: true, value: catalog } : indexed;
  } catch {
    return failure('query.catalog', 'Catalog snapshot failed safely at the untrusted boundary.');
  }
}

function prepareRegistry(input: FunctionRegistry, catalog: Catalog): QueryOutcome<FunctionRegistry> {
  let created: QueryOutcome<FunctionRegistry>;
  try {
    created = createFunctionRegistry({ digest: input.digest, signatures: input.signatures });
  } catch {
    return failure('query.registry', 'Function registry snapshot failed safely at the untrusted boundary.', [
      'registry',
    ]);
  }
  if (!created.ok)
    return failure('query.registry', 'Function registry snapshot failed safely at the untrusted boundary.', [
      'registry',
    ]);
  if (created.value.digest !== catalog.functionRegistryDigest)
    return failure('query.stale-registry', 'The function registry does not match the catalog function registry pin.', [
      'registry',
    ]);
  return created;
}

function effectiveLimits(requested: Partial<QueryLimits> | undefined): QueryOutcome<QueryLimits> {
  const keys = Object.keys(DEFAULT_LIMITS) as (keyof QueryLimits)[];
  const entries = keys.map((key) => [key, requestedLimit(requested, key)] as const);
  const limits = Object.freeze(Object.fromEntries(entries)) as unknown as QueryLimits;
  for (const [key, value] of Object.entries(limits)) {
    if (!positiveInteger(value))
      return failure('query.budget', `Query limit ${key} must be a bounded positive safe integer.`, ['limits', key]);
  }
  return { ok: true, value: limits };
}

function requestedLimit(requested: Partial<QueryLimits> | undefined, key: keyof QueryLimits): number {
  const value = requested?.[key];
  if (value !== undefined) return value;
  return DEFAULT_LIMITS[key];
}

function prepareDefinitions(
  input: readonly MeaningDefinition[] | undefined,
): QueryOutcome<readonly MeaningDefinition[]> {
  try {
    return { ok: true, value: immutableSnapshot(input ?? []) };
  } catch {
    return failure('query.definitions', 'Meaning definition snapshot failed safely at the untrusted boundary.', [
      'definitions',
    ]);
  }
}

function allowedRelationalQuery(input: Record<string, unknown>): boolean {
  const fields = new Set([
    'root',
    'select',
    'filter',
    'semiJoins',
    'joins',
    'derives',
    'timeBuckets',
    'windows',
    'groupBy',
    'aggregates',
    'orderBy',
    'topK',
    'pins',
  ]);
  return Object.keys(input).every((key) => fields.has(key));
}

function lowerInput(
  input: unknown,
  catalog: Catalog,
  registry: FunctionRegistry,
  definitions: readonly MeaningDefinition[],
): QueryOutcome<RelationalQuery> {
  const ingress = inspectWire(input);
  if (!ingress.ok) return ingress;
  const value = ingress.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return failure('query.input', 'Query input must be a bounded data object.');
  if ('root' in value) {
    if (!allowedRelationalQuery(value)) return failure('query.input', 'Internal query contains an unknown field.');
    return { ok: true, value: immutableSnapshot(value) as RelationalQuery };
  }
  const parsed = parseQuery(value);
  if (!parsed.ok) return parsed;
  return lowerQuerySpec(parsed.value, catalog, registry, definitions);
}

function planInput(
  input: unknown,
  catalog: Catalog,
  registry: FunctionRegistry,
  definitions: readonly MeaningDefinition[],
  limits: QueryLimits,
): QueryOutcome<LogicalPlan> {
  try {
    const lowered = lowerInput(input, catalog, registry, definitions);
    return lowered.ok ? buildPlan(lowered.value, catalog, registry, limits) : lowered;
  } catch {
    return failure('query.input', 'Query input is malformed or exceeds the supported structural bounds.');
  }
}

function createPlanner(
  catalog: Catalog,
  registry: FunctionRegistry,
  definitions: readonly MeaningDefinition[],
  limits: QueryLimits,
): QueryPlanner {
  const planner: QueryPlanner = {
    catalog,
    registry,
    limits,
    plan: (input) => planInput(input, catalog, registry, definitions, limits),
    evaluate: (plan, source: QuerySource, context?: QueryExecutionContext) =>
      evaluateLogicalPlan(plan, source, catalog, registry, context, limits, definitions),
  };
  return Object.freeze(planner);
}

export function createQueryPlanner(options: QueryPlannerOptions): QueryOutcome<QueryPlanner> {
  const catalog = prepareCatalog(options.catalog);
  if (!catalog.ok) return catalog;
  const registry = prepareRegistry(options.registry, catalog.value);
  if (!registry.ok) return registry;
  const definitions = prepareDefinitions(options.definitions);
  if (!definitions.ok) return definitions;
  const meaningContext = { catalog: catalog.value, registry: registry.value, definitions: definitions.value };
  for (const meaning of catalog.value.meanings.concat(definitions.value)) {
    const validated = validateMeaning(meaning, meaningContext);
    if (!validated.ok) return validated;
  }
  const limits = effectiveLimits(options.limits);
  if (!limits.ok) return limits;
  return { ok: true, value: createPlanner(catalog.value, registry.value, definitions.value, limits.value) };
}
