import { failure } from './shared.js';
import type { Catalog, Expression, Outcome, QuerySpec } from '@varendo/core';
import type { CatalogEntity } from '@varendo/core/semantics';
import { createQueryFunctionRegistry, createStandardFunctionRegistry } from '@varendo/core/expressions';
import type { FunctionRegistry } from '@varendo/core/expressions';
import { createQueryPlanner, type LogicalPlan } from '@varendo/core/query';
import type { PlanNode, PredicateSpec, QueryField, QueryLimits, QueryPlanner, QuerySchema } from '@varendo/core/query';
import type { LocalDataServiceOptions, ReadGrant } from '../types.js';
import type { SourceLimits } from './shared.js';
import { allowedEntity, allowedField } from './access.js';

export interface PlanDependencies {
  readonly entities: ReadonlySet<string>;
  readonly fields: ReadonlyMap<string, ReadonlySet<string>>;
}

interface DependencyContext {
  readonly catalog: Catalog;
  readonly nodes: ReadonlyMap<string, PlanNode>;
  readonly entities: Set<string>;
  readonly fields: Map<string, Set<string>>;
}

const PLANNER_FAILURE_CODES: ReadonlyMap<string, string> = new Map([
  ['query.budget', 'data.budget'],
  ['query.denied', 'data.denied'],
  ['query.stale-catalog', 'data.stale-plan'],
  ['query.stale-source', 'data.stale-plan'],
  ['query.stale-registry', 'data.stale-plan'],
]);

export function plannerFailure<T>(outcome: Outcome<T>): Outcome<T> {
  if (outcome.ok) return outcome;
  const first = outcome.diagnostics[0];
  if (first === undefined) return failure('data.unsupported', 'The requested query cannot be executed by this source.');
  const code = PLANNER_FAILURE_CODES.get(first.code);
  if (code !== undefined) return failure(code, first.message, first.path, first.remedies);
  return failure(
    'data.unsupported',
    first.message,
    first.path,
    first.remedies ?? ['Use a source capability that declares this operation.'],
  );
}

export function queryPlanner(
  options: LocalDataServiceOptions,
  catalog: Catalog,
  sourceLimits: SourceLimits,
): Outcome<QueryPlanner> {
  const registry = queryRegistry(options, catalog);
  if (!registry.ok) return registry;
  const requested = options.queryLimits ?? {};
  const limits: Partial<QueryLimits> = {
    ...requested,
    maxRows: Math.min(sourceLimits.rows, requested.maxRows ?? sourceLimits.rows),
    maxBytes: Math.min(sourceLimits.bytes, requested.maxBytes ?? sourceLimits.bytes),
  };
  return plannerFailure(
    createQueryPlanner({ catalog, registry: registry.value, definitions: catalog.meanings, limits }),
  );
}

function queryRegistry(options: LocalDataServiceOptions, catalog: Catalog): Outcome<FunctionRegistry> {
  const registry = options.functionRegistry ?? options.meaningActivation?.registry;
  if (registry !== undefined) return validateHostRegistry(registry, catalog);
  return defaultRegistry(catalog);
}

function validateHostRegistry(registry: FunctionRegistry, catalog: Catalog): Outcome<FunctionRegistry> {
  if (registry.digest === catalog.functionRegistryDigest) return { ok: true, value: registry };
  return failure(
    'data.unsupported',
    'The host function registry does not match the catalog function registry revision.',
    ['functionRegistryDigest'],
  );
}

/** Resolves only the built-in registries named by their canonical digests; custom digests need a host registry. */
function defaultRegistry(catalog: Catalog): Outcome<FunctionRegistry> {
  const digest = catalog.functionRegistryDigest;
  if (digest === 'core-standard-1') return createStandardFunctionRegistry();
  if (digest === 'core-query-2') return createQueryFunctionRegistry({ version: '2' });
  return failure(
    'data.unsupported',
    'The catalog requires a host function registry that was not supplied.',
    ['functionRegistryDigest'],
    ['Provide a registry whose digest matches the catalog.'],
  );
}

export function dependenciesForPlan(plan: LogicalPlan, catalog: Catalog): PlanDependencies {
  const context: DependencyContext = {
    catalog,
    nodes: new Map(plan.nodes.map((node) => [node.id, node] as const)),
    entities: new Set(),
    fields: new Map(),
  };
  for (const node of plan.nodes) collectNodeDependencies(context, node);
  return { entities: context.entities, fields: context.fields };
}

function collectNodeDependencies(context: DependencyContext, node: PlanNode): void {
  collectNodeInputs(context, node);
  collectRelationshipDependencies(context, node);
}

function collectNodeInputs(context: DependencyContext, node: PlanNode): void {
  switch (node.op) {
    case 'scan':
      collectScan(context, node.entity);
      return;
    case 'filter':
      collectPredicate(node.predicate, inputSchema(context, node), context);
      return;
    case 'project':
    case 'derive':
    case 'time-bucket':
      collectExpressions(
        node.items.map((item) => item.expression),
        inputSchema(context, node),
        context,
      );
      return;
    case 'window':
      collectWindow(context, node);
      return;
    case 'group':
      collectExpressions(
        node.keys.map((item) => item.expression),
        inputSchema(context, node),
        context,
      );
      return;
    case 'aggregate':
      collectExpressions(
        node.items.flatMap((item) => item.arguments),
        inputSchema(context, node),
        context,
      );
      return;
    case 'sort':
      collectExpressions(
        node.items.map((item) => item.expression),
        inputSchema(context, node),
        context,
      );
      return;
    default:
      return;
  }
}

function collectScan(context: DependencyContext, entityId: string): void {
  addEntity(context, entityId);
  const entity = context.catalog.entities.find((candidate) => candidate.id === entityId);
  if (entity === undefined) return;
  for (const field of [...entity.identity, ...entity.rowGrain]) addField(context, entityId, field);
}

function collectWindow(context: DependencyContext, node: Extract<PlanNode, { readonly op: 'window' }>): void {
  const schema = inputSchema(context, node);
  for (const item of node.items) {
    collectExpressions([...item.arguments, ...item.partitionBy], schema, context);
    collectExpressions(
      item.orderBy.map((order) => order.expression),
      schema,
      context,
    );
  }
}

function collectRelationshipDependencies(context: DependencyContext, node: PlanNode): void {
  if (node.op !== 'join' && node.op !== 'semijoin') return;
  const relationship = context.catalog.relationships.find(
    (candidate) => candidate.id === node.spec.relationship.id && candidate.revision === node.spec.relationship.revision,
  );
  if (relationship === undefined) return;
  addEntity(context, relationship.sourceEntity);
  addEntity(context, relationship.targetEntity);
  for (const key of relationship.keys) {
    addField(context, relationship.sourceEntity, key.sourceField);
    addField(context, relationship.targetEntity, key.targetField);
  }
  if (node.spec.where !== undefined) collectPredicate(node.spec.where, inputSchema(context, node, 1), context);
}

function collectExpressions(expressions: readonly Expression[], schema: QuerySchema, context: DependencyContext): void {
  for (const expression of expressions) collectExpression(expression, schema, context);
}

function collectExpression(
  expression: Expression,
  schema: QuerySchema,
  context: DependencyContext,
  seenDefinitions: ReadonlySet<string> = new Set(),
): void {
  switch (expression.kind) {
    case 'field':
      collectFieldReference(expression, schema, context);
      return;
    case 'call':
      for (const argument of expression.arguments) collectExpression(argument as Expression, schema, context);
      return;
    case 'definition':
      collectDefinition(expression.ref, schema, context, seenDefinitions);
      return;
    default:
      return;
  }
}

function collectFieldReference(
  expression: Extract<Expression, { readonly kind: 'field' }>,
  schema: QuerySchema,
  context: DependencyContext,
): void {
  const source =
    expression.entity === undefined
      ? schema.fields.find((field) => field.id === expression.ref)?.source
      : { entity: expression.entity, field: expression.ref };
  if (source !== undefined) addField(context, source.entity, source.field);
}

function collectDefinition(
  ref: Extract<Expression, { readonly kind: 'definition' }>['ref'],
  schema: QuerySchema,
  context: DependencyContext,
  seenDefinitions: ReadonlySet<string>,
): void {
  const key = `${ref.id}@${ref.revision}`;
  if (seenDefinitions.has(key)) return;
  const nextSeen = new Set(seenDefinitions).add(key);
  const meaning = context.catalog.meanings.find(
    (candidate) => candidate.id === ref.id && candidate.revision === ref.revision,
  );
  if (meaning?.implementation.kind === 'expression')
    collectExpression(meaning.implementation.expression, schema, context, nextSeen);
}

function collectPredicate(predicate: PredicateSpec, schema: QuerySchema, context: DependencyContext): void {
  switch (predicate.op) {
    case 'and':
    case 'or':
      for (const child of predicate.predicates) collectPredicate(child, schema, context);
      return;
    case 'not':
      collectPredicate(predicate.predicate, schema, context);
      return;
    case 'compare':
      collectExpressions([predicate.left, predicate.right], schema, context);
      return;
    case 'is-null':
      collectExpression(predicate.expression, schema, context);
      return;
    case 'in':
      collectExpressions([predicate.expression, ...predicate.values], schema, context);
      return;
    default:
      return;
  }
}

function inputSchema(context: DependencyContext, node: PlanNode, index = 0): QuerySchema {
  return context.nodes.get(node.inputs[index] ?? '')?.output ?? node.output;
}

function addEntity(context: DependencyContext, entityId: string): void {
  context.entities.add(entityId);
  if (!context.fields.has(entityId)) context.fields.set(entityId, new Set());
}

function addField(context: DependencyContext, entityId: string, fieldId: string): void {
  addEntity(context, entityId);
  context.fields.get(entityId)!.add(fieldId);
}

export function checkPlanDependencies(dependencies: PlanDependencies, grant: ReadGrant): Outcome<void> {
  for (const entity of dependencies.entities) {
    const entityError = dependencyEntityError(entity, grant);
    if (entityError !== undefined) return entityError;
    const fieldError = dependencyFieldError(dependencies.fields.get(entity) ?? [], entity, grant);
    if (fieldError !== undefined) return fieldError;
  }
  return { ok: true, value: undefined };
}

function dependencyEntityError(entity: string, grant: ReadGrant): Outcome<void> | undefined {
  if (allowedEntity(grant, entity)) return undefined;
  return failure('data.denied', 'The requested query relation is not available in the current authorization scope.', [
    'query',
  ]);
}

function dependencyFieldError(fields: Iterable<string>, entity: string, grant: ReadGrant): Outcome<void> | undefined {
  for (const field of fields) {
    if (allowedField(grant, entity, field)) continue;
    return failure('data.denied', 'The requested query field is not available in the current authorization scope.', [
      'query',
    ]);
  }
  return undefined;
}

export function supportedOperations(plan: LogicalPlan, query: QuerySpec): readonly string[] {
  const operations = new Set<string>();
  for (const node of plan.nodes) {
    const operation = operationForNode(node);
    if (operation !== undefined) operations.add(operation);
  }
  if (query.page !== undefined) operations.add('paging');
  return Object.freeze(SUPPORTED_OPERATION_ORDER.filter((operation) => operations.has(operation)));
}

const SUPPORTED_OPERATION_ORDER = [
  'projection',
  'predicates',
  'order',
  'top-k',
  'paging',
  'relation',
  'grouping',
  'aggregation',
  'temporal',
  'window',
  'derive',
] as const;

function operationForNode(node: PlanNode): string | undefined {
  switch (node.op) {
    case 'project':
      return 'projection';
    case 'filter':
      return 'predicates';
    case 'sort':
      return 'order';
    case 'top-k':
      return 'top-k';
    case 'join':
    case 'semijoin':
      return 'relation';
    case 'group':
      return 'grouping';
    case 'aggregate':
      return 'aggregation';
    case 'time-bucket':
      return 'temporal';
    case 'window':
      return 'window';
    case 'derive':
      return 'derive';
    default:
      return undefined;
  }
}

export function scanEntityIds(plan: LogicalPlan): readonly string[] {
  const entityIds = plan.nodes.flatMap((node) => (node.op === 'scan' ? [node.entity] : []));
  return Object.freeze([...new Set(entityIds)]);
}

export function queryFieldDefinition(field: QueryField, query: QuerySpec): CatalogEntity['fields'][number] {
  const derivation = query.measures.find((reference) => reference.id === field.id);
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    role: field.role,
    ...(derivation === undefined ? {} : { derivation }),
  };
}
