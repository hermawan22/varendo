import type { Catalog, Expression, MeaningDefinition, Outcome, SemanticType, VersionRef } from '../contracts/types.js';
import { versionRefKey } from '../contracts/stable.js';
import { createCatalogIndex } from '../semantics/catalog.js';
import { prependOutcomePath, semanticFailure } from '../semantics/errors.js';
import { validateMeaning, validateMeaningBundle } from '../semantics/meaning.js';
import type {
  CatalogIndex,
  MeaningBundle,
  MeaningBundleContext,
  MeaningScope,
  SemanticPolicy,
  ZeroDenominatorPolicy,
} from '../semantics/types.js';
import { checkExpression } from './check.js';
import { collectDefinitionRefs } from './check-reference.js';
import { createFunctionRegistry } from './registry.js';
import type { ExpressionInput, FunctionRegistry, TypedExpression } from './types.js';

type Entity<C extends Catalog> = C['entities'][number];
type EntityId<C extends Catalog> = Entity<C>['id'];
// Schema-loaded catalogs have string IDs; their membership is checked by the
// runtime index. Literal catalogs still narrow fields to the selected entity.
type EntityWithId<C extends Catalog, E extends string> =
  string extends EntityId<C> ? Entity<C> : Extract<Entity<C>, { readonly id: E }>;
type FieldId<C extends Catalog, E extends EntityId<C>> = EntityWithId<C, E>['fields'][number]['id'];

export interface AuthoringOptions<C extends Catalog> extends MeaningBundleContext {
  readonly catalog: C;
}

export interface RatioOfSumsInput {
  readonly numerator: ExpressionInput;
  readonly denominator: ExpressionInput;
  readonly zeroDenominator: ZeroDenominatorPolicy;
}

export interface MeanOfRatesInput {
  readonly rates: readonly [ExpressionInput, ...ExpressionInput[]];
}

export interface DefineMetricInput {
  readonly id: string;
  readonly revision?: string;
  readonly label: string;
  readonly description: string;
  readonly expression: ExpressionInput;
  readonly aggregation?: MeaningDefinition['aggregation'];
  readonly aggregationDimensions?: readonly string[];
  readonly missingPolicy?: MeaningDefinition['missingPolicy'];
  readonly scope?: MeaningScope;
  readonly dependencies?: readonly VersionRef[];
}

export interface TypedAuthoring<C extends Catalog> {
  readonly catalog: C;
  readonly registry: FunctionRegistry;
  field<E extends EntityId<C>>(entityId: E, fieldId: FieldId<C, E>): Outcome<TypedExpression>;
  literal(value: unknown, type: SemanticType): Outcome<TypedExpression>;
  call(ref: VersionRef, args: readonly ExpressionInput[]): Outcome<TypedExpression>;
  ratioOfSums(input: RatioOfSumsInput): Outcome<TypedExpression>;
  meanOfRates(input: MeanOfRatesInput): Outcome<TypedExpression>;
  defineMetric(input: DefineMetricInput): Outcome<MeaningDefinition>;
  bundle(meanings: readonly MeaningDefinition[]): Outcome<MeaningBundle>;
}

interface AuthoringSession<C extends Catalog> {
  readonly catalog: C;
  readonly index: CatalogIndex;
  readonly registry: FunctionRegistry;
  readonly definitions: readonly MeaningDefinition[];
  readonly policy?: SemanticPolicy;
}

function expressionContext<C extends Catalog>(session: AuthoringSession<C>, entityId?: string) {
  return {
    catalog: session.catalog,
    index: session.index,
    registry: session.registry,
    definitions: session.definitions,
    ...(entityId === undefined ? {} : { entityId }),
  };
}

function createField<C extends Catalog>(index: CatalogIndex): TypedAuthoring<C>['field'] {
  return <E extends EntityId<C>>(entityId: E, fieldId: FieldId<C, E>): Outcome<TypedExpression> => {
    const resolved = index.resolveField(entityId, fieldId);
    if (!resolved.ok) return resolved;
    const expression: Expression = { kind: 'field', ref: fieldId, entity: entityId };
    return {
      ok: true,
      value: { expression, type: resolved.value.type, context: 'row', entityId: resolved.value.entityId },
    };
  };
}

function createCall<C extends Catalog>(session: AuthoringSession<C>): TypedAuthoring<C>['call'] {
  return (ref, args) => {
    const unwrapped = unwrapAll(args);
    if (!unwrapped.ok) return unwrapped;
    const entityIds = [
      ...new Set(
        unwrapped.value
          .map((argument) => argument.entityId)
          .filter((entityId): entityId is string => entityId !== undefined),
      ),
    ];
    if (entityIds.length > 1)
      return semanticFailure(
        'semantic.entity-grain',
        'An expression cannot combine fields from different entity bindings without an explicit registered relation.',
        ['arguments'],
      );
    const expression: Expression = {
      kind: 'call',
      function: ref,
      arguments: unwrapped.value.map((argument) => argument.expression),
    };
    const entityId = entityIds[0] ?? inferEntity(expression, session.index);
    return checkExpression(expression, expressionContext(session, entityId));
  };
}

function createRatioOfSums<C extends Catalog>(call: TypedAuthoring<C>['call']): TypedAuthoring<C>['ratioOfSums'] {
  return (input) => {
    const numerator = unwrap(input.numerator);
    if (!numerator.ok) return numerator;
    const denominator = unwrap(input.denominator);
    if (!denominator.ok) return denominator;
    return call({ id: `core.ratio-of-sums.${input.zeroDenominator}`, revision: '1' }, [
      numerator.value,
      denominator.value,
    ]);
  };
}

function createMeanOfRates<C extends Catalog>(call: TypedAuthoring<C>['call']): TypedAuthoring<C>['meanOfRates'] {
  return (input) => {
    const rates = unwrapAll(input.rates);
    if (!rates.ok) return rates;
    const result = call({ id: 'core.mean-of-rates', revision: '1' }, rates.value);
    if (!result.ok) return result;
    return { ok: true, value: { ...result.value, aggregation: 'non-additive' } };
  };
}

function createDefineMetric<C extends Catalog>(session: AuthoringSession<C>): TypedAuthoring<C>['defineMetric'] {
  return (input) => {
    const expression = unwrap(input.expression);
    if (!expression.ok) return expression;
    const inferredAggregation = input.aggregation ?? expression.value.aggregation ?? 'none';
    if (aggregationMismatch(input, expression.value.aggregation))
      return semanticFailure(
        'semantic.aggregation-mismatch',
        'Declared aggregation does not match the expression operation.',
        ['aggregation'],
      );
    const meaning: MeaningDefinition = {
      id: input.id,
      revision: input.revision ?? '1',
      label: input.label,
      explanation: input.description,
      output: expression.value.type,
      implementation: { kind: 'expression', expression: expression.value.expression },
      dependencies: uniqueRefs([...(input.dependencies ?? []), ...collectDefinitionRefs(expression.value.expression)]),
      functionRegistryDigest: session.registry.digest,
      origin: 'manual',
      lifecycle: 'draft',
      scope: input.scope ?? 'session',
      authority: 'hypothesis',
      aggregation: inferredAggregation,
      aggregationDimensions: input.aggregationDimensions ?? [],
      missingPolicy: input.missingPolicy ?? 'propagate',
    };
    return validateMeaning(meaning, {
      catalog: session.catalog,
      registry: session.registry,
      index: session.index,
      definitions: session.definitions,
      ...(session.policy === undefined ? {} : { policy: session.policy }),
    });
  };
}

function aggregationMismatch(
  input: DefineMetricInput,
  inferred: MeaningDefinition['aggregation'] | undefined,
): boolean {
  return input.aggregation !== undefined && inferred !== undefined && input.aggregation !== inferred;
}

function createBundle<C extends Catalog>(session: AuthoringSession<C>): TypedAuthoring<C>['bundle'] {
  return (meanings) =>
    validateMeaningBundle(
      {
        catalogRevision: session.catalog.revision,
        functionRegistryDigest: session.registry.digest,
        meanings,
      },
      {
        catalog: session.catalog,
        registry: session.registry,
        definitions: session.definitions,
        ...(session.policy === undefined ? {} : { policy: session.policy }),
      },
    );
}

function createAuthoringMethods<C extends Catalog>(
  session: AuthoringSession<C>,
): Omit<TypedAuthoring<C>, 'catalog' | 'registry'> {
  const call = createCall(session);
  return {
    field: createField(session.index),
    literal: (value, type) => checkExpression({ kind: 'literal', value, type }, expressionContext(session)),
    call,
    ratioOfSums: createRatioOfSums(call),
    meanOfRates: createMeanOfRates(call),
    defineMetric: createDefineMetric(session),
    bundle: createBundle(session),
  };
}

export function createTypedAuthoring<const C extends Catalog>(
  options: AuthoringOptions<C>,
): Outcome<TypedAuthoring<C>> {
  const indexOutcome = createCatalogIndex(options.catalog);
  if (!indexOutcome.ok) return indexOutcome;
  const index = indexOutcome.value;
  if (options.registry.digest !== index.catalog.functionRegistryDigest)
    return semanticFailure(
      'semantic.stale-registry',
      'The supplied function registry does not match the catalog registry pin.',
      ['functionRegistryDigest'],
    );
  const registryOutcome = createFunctionRegistry({
    digest: options.registry.digest,
    signatures: options.registry.signatures,
  });
  if (!registryOutcome.ok) return registryOutcome;
  const session: AuthoringSession<C> = {
    catalog: snapshotValue(index.catalog) as C,
    index,
    registry: registryOutcome.value,
    definitions: snapshotDefinitions(options.definitions ?? []),
    ...(options.policy === undefined ? {} : { policy: snapshotValue(options.policy) }),
  };
  return {
    ok: true,
    value: Object.freeze({
      catalog: session.catalog,
      registry: session.registry,
      ...createAuthoringMethods(session),
    }),
  };
}

/** Keep a typed authoring session pinned even when caller-owned wire objects are edited later. */
function snapshotDefinitions(definitions: readonly MeaningDefinition[]): readonly MeaningDefinition[] {
  return Object.freeze(definitions.map((definition) => snapshotValue(definition) as MeaningDefinition));
}

function snapshotValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshotValue(item))) as T;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) copy[key] = snapshotValue(child);
  return Object.freeze(copy) as T;
}

function unwrap(input: ExpressionInput): Outcome<TypedExpression> {
  if (isOutcome(input)) return input;
  return { ok: true, value: input };
}

function unwrapAll(inputs: readonly ExpressionInput[]): Outcome<readonly TypedExpression[]> {
  const values: TypedExpression[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const value = unwrap(inputs[index]!);
    if (!value.ok) return prependOutcomePath(['arguments', index], value);
    values.push(value.value);
  }
  return { ok: true, value: values };
}

function isOutcome(input: ExpressionInput): input is Outcome<TypedExpression> {
  return typeof input === 'object' && input !== null && 'ok' in input && typeof input.ok === 'boolean';
}

function inferEntity(
  expression: Expression,
  index: ReturnType<typeof createCatalogIndex> extends Outcome<infer I> ? I : never,
): string | undefined {
  const stack = [expression];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'field') {
      const bindings = index.fieldsById.get(node.ref);
      if (bindings?.length === 1) return bindings[0]!.entityId;
    }
    if (node.kind === 'call')
      for (let position = node.arguments.length - 1; position >= 0; position -= 1)
        stack.push(node.arguments[position]!);
  }
  return undefined;
}

function uniqueRefs(refs: readonly VersionRef[]): readonly VersionRef[] {
  const seen = new Set<string>();
  const result: VersionRef[] = [];
  for (const ref of refs) {
    const identity = versionRefKey(ref);
    if (!seen.has(identity)) {
      seen.add(identity);
      result.push(ref);
    }
  }
  return result;
}
