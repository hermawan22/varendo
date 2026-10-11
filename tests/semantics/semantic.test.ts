import { describe, expect, it } from 'vitest';
import type { Catalog, Expression, MeaningDefinition, SemanticType } from '../../packages/core/src/contracts/types.js';
import { WIRE_LIMITS } from '../../packages/core/src/contracts/limits.js';
import { createCatalogIndex } from '../../packages/core/src/semantics/catalog.js';
import {
  authorizeMeaningActivation,
  validateMeaning,
  validateMeaningBundle,
} from '../../packages/core/src/semantics/meaning.js';
import { sameTemporal, sameUnit } from '../../packages/core/src/semantics/type-utils.js';
import { checkExpression } from '../../packages/core/src/expressions/check.js';
import { createTypedAuthoring } from '../../packages/core/src/expressions/builder.js';
import {
  createFunctionRegistry,
  createStandardFunctionRegistry,
  standardFunctionSignatures,
} from '../../packages/core/src/expressions/registry.js';
import type { FunctionSignature } from '../../packages/core/src/expressions/types.js';

const text = (id: string, role: 'identity' | 'measure' = 'measure') => ({
  id,
  label: id,
  type: { value: 'text' as const, nullable: false },
  role,
});
const number = (id: string, unit?: { dimension: string; symbol: string; currency?: string }) => ({
  id,
  label: id,
  type: { value: 'integer' as const, nullable: false, ...(unit === undefined ? {} : { unit }) },
  role: 'measure' as const,
});

function makeCatalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    version: '1',
    revision: 'catalog-1',
    functionRegistryDigest: 'core-standard-1',
    entities: [
      {
        id: 'employees',
        label: 'Employees',
        identity: ['employee.id'],
        rowGrain: ['employee.id'],
        fields: [
          text('employee.id', 'identity'),
          number('numerator', { dimension: 'count', symbol: 'day' }),
          number('denominator', { dimension: 'count', symbol: 'day' }),
          number('usd', { dimension: 'currency', symbol: 'USD' }),
          number('cents', { dimension: 'currency', symbol: 'cent' }),
        ],
      },
    ],
    relationships: [],
    meanings: [],
    capabilities: [],
    ...overrides,
  };
}

function capabilityMeaning(): MeaningDefinition {
  return {
    id: 'employees.count',
    revision: '1',
    label: 'Employee count',
    explanation: 'Count of employees in the authorized population.',
    output: { value: 'integer', nullable: false },
    implementation: {
      kind: 'expression',
      expression: { kind: 'literal', value: 1, type: { value: 'integer', nullable: false } },
    },
    dependencies: [],
    functionRegistryDigest: 'core-standard-1',
    origin: 'system',
    lifecycle: 'active',
    scope: 'organization',
    authority: 'approved',
    aggregation: 'additive',
    aggregationDimensions: [],
    missingPolicy: 'reject',
  };
}

function dataCapability(overrides: Partial<Catalog['capabilities'][number]> = {}): Catalog['capabilities'][number] {
  return {
    ref: { id: 'employees.read', revision: '1' },
    entity: 'employees',
    operators: [],
    fields: ['employee.id', 'numerator'],
    relations: [],
    metrics: [{ id: 'employees.count', revision: '1' }],
    pagination: {
      mode: 'snapshot',
      stableOrder: [{ field: 'employee.id', direction: 'asc', nulls: 'last' }],
      identity: ['employee.id'],
    },
    maxOutputRows: 100,
    ...overrides,
  };
}

function standard() {
  const registry = createStandardFunctionRegistry();
  if (!registry.ok) throw new Error('standard registry fixture failed');
  return registry.value;
}

function field(ref: string): Expression {
  return { kind: 'field', ref };
}

function call(id: string, arguments_: readonly Expression[]): Expression {
  return { kind: 'call', function: { id, revision: '1' }, arguments: arguments_ };
}

describe('typed semantic expressions', () => {
  it('validates capability metrics and deterministic pagination against the entity', () => {
    const valid = createCatalogIndex(
      makeCatalog({ meanings: [capabilityMeaning()], capabilities: [dataCapability()] }),
    );
    expect(valid.ok).toBe(true);

    const missingMetric = createCatalogIndex(
      makeCatalog({
        meanings: [capabilityMeaning()],
        capabilities: [dataCapability({ metrics: [{ id: 'missing', revision: '1' }] })],
      }),
    );
    expect(missingMetric.ok ? '' : missingMetric.diagnostics[0]?.code).toBe('semantic.capability-metric');

    const missingRelation = createCatalogIndex(
      makeCatalog({
        meanings: [capabilityMeaning()],
        capabilities: [dataCapability({ relations: [{ id: 'missing', revision: '1' }] })],
      }),
    );
    expect(missingRelation.ok ? '' : missingRelation.diagnostics[0]?.code).toBe('semantic.capability-relation');

    const unknownOrderField = createCatalogIndex(
      makeCatalog({
        meanings: [capabilityMeaning()],
        capabilities: [
          dataCapability({
            pagination: {
              mode: 'snapshot',
              stableOrder: [{ field: 'missing', direction: 'asc', nulls: 'last' }],
              identity: ['employee.id'],
            },
          }),
        ],
      }),
    );
    expect(unknownOrderField.ok ? '' : unknownOrderField.diagnostics[0]?.code).toBe(
      'semantic.capability-pagination-field',
    );

    const unstableOrder = createCatalogIndex(
      makeCatalog({
        meanings: [capabilityMeaning()],
        capabilities: [
          dataCapability({
            pagination: {
              mode: 'keyset',
              stableOrder: [{ field: 'numerator', direction: 'asc', nulls: 'last' }],
              identity: ['employee.id'],
            },
          }),
        ],
      }),
    );
    expect(unstableOrder.ok ? '' : unstableOrder.diagnostics[0]?.code).toBe('semantic.capability-pagination-order');
  });

  it('treats unit symbols and currency qualifiers as part of unit identity', () => {
    const catalog = makeCatalog();
    const registry = standard();
    const index = createCatalogIndex(catalog);
    expect(index.ok).toBe(true);
    if (!index.ok) return;
    const result = checkExpression(call('core.add', [field('usd'), field('cents')]), {
      catalog,
      index: index.value,
      registry,
      entityId: 'employees',
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.diagnostics[0]?.code).toBe('semantic.unit-mismatch');
    expect(
      sameUnit(
        { value: 'integer', nullable: false, unit: { dimension: 'currency', symbol: 'USD' } },
        { value: 'integer', nullable: false, unit: { dimension: 'currency', symbol: 'cent' } },
      ),
    ).toBe(false);
  });

  it('rejects generic division of unequal units instead of inventing money/time semantics', () => {
    const catalog = makeCatalog({
      entities: [
        {
          id: 'employees',
          label: 'Employees',
          identity: ['employee.id'],
          rowGrain: ['employee.id'],
          fields: [
            text('employee.id', 'identity'),
            number('usd', { dimension: 'currency', symbol: 'USD' }),
            number('elapsed', { dimension: 'duration', symbol: 'hour' }),
          ],
        },
      ],
    });
    const registry = standard();
    const index = createCatalogIndex(catalog);
    expect(index.ok).toBe(true);
    if (!index.ok) return;
    const result = checkExpression(call('core.divide.null', [field('usd'), field('elapsed')]), {
      catalog,
      index: index.value,
      registry,
      entityId: 'employees',
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.diagnostics[0]?.code).toBe('semantic.unit-division');
  });

  it('preserves exact decimal output and rejects implicit decimal/float mixing', () => {
    const catalog = makeCatalog();
    const registry = standard();
    const decimal: Expression = {
      kind: 'literal',
      value: { decimal: '1.20' },
      type: { value: 'decimal', nullable: false },
    };
    const floating: Expression = { kind: 'literal', value: 2.5, type: { value: 'float', nullable: false } };
    const mixed = checkExpression(call('core.add', [decimal, floating]), { catalog, registry });
    expect(mixed.ok).toBe(false);
    expect(mixed.ok ? '' : mixed.diagnostics[0]?.code).toBe('semantic.precision-mismatch');
    const integer: Expression = { kind: 'literal', value: 2, type: { value: 'integer', nullable: false } };
    const exact = checkExpression(call('core.add', [decimal, decimal]), { catalog, registry });
    expect(exact.ok).toBe(true);
    expect(exact.ok && exact.value.type.value).toBe('decimal');
    const ratio = checkExpression(call('core.divide.null', [integer, integer]), { catalog, registry });
    expect(ratio.ok).toBe(true);
    expect(ratio.ok && ratio.value.type.unit).toBeUndefined();
  });

  it('does not claim a unit for multiplication or nullability for nullable coalesce', () => {
    const catalog = makeCatalog();
    const registry = standard();
    const index = createCatalogIndex(catalog);
    expect(index.ok).toBe(true);
    if (!index.ok) return;
    const multiply = checkExpression(call('core.multiply', [field('usd'), field('usd')]), {
      catalog,
      index: index.value,
      registry,
      entityId: 'employees',
    });
    expect(multiply.ok).toBe(false);
    expect(multiply.ok ? '' : multiply.diagnostics[0]?.code).toBe('semantic.unit-multiply');
    const nullable: Expression = { kind: 'literal', value: null, type: { value: 'integer', nullable: true } };
    const coalesce = checkExpression(call('core.coalesce', [nullable, nullable]), { catalog, registry });
    expect(coalesce.ok).toBe(true);
    expect(coalesce.ok && coalesce.value.type.nullable).toBe(true);
    const isNull = checkExpression(call('core.is-null', [nullable]), { catalog, registry });
    expect(isNull.ok).toBe(true);
    expect(isNull.ok && isNull.value.type.nullable).toBe(false);
    const count = checkExpression(call('core.aggregate.count', [nullable]), { catalog, registry });
    expect(count.ok).toBe(true);
    expect(count.ok && count.value.type.value).toBe('integer');
    expect(count.ok && count.value.type.nullable).toBe(false);
  });

  it('honours non-null result metadata for numeric registered functions', () => {
    const nonNull: FunctionSignature = {
      ref: { id: 'test.non-null', revision: '1' },
      parameters: [{ constraint: { kind: 'numeric' } }],
      output: { kind: 'numeric' },
      contexts: ['row'],
      nullPolicy: 'propagate',
      nullResult: 'non-null',
      aggregation: { kind: 'none', dimensions: [] },
      operation: 'other',
      deterministic: true,
      cost: { maxNodes: 8 },
      realization: 'local',
    };
    const registryOutcome = createFunctionRegistry({ digest: 'non-null-registry', signatures: [nonNull] });
    expect(registryOutcome.ok).toBe(true);
    if (!registryOutcome.ok) return;
    const catalog = makeCatalog({ functionRegistryDigest: registryOutcome.value.digest });
    const nullable: Expression = { kind: 'literal', value: null, type: { value: 'integer', nullable: true } };
    const result = checkExpression(
      { kind: 'call', function: nonNull.ref, arguments: [nullable] },
      { catalog, registry: registryOutcome.value },
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.type.nullable).toBe(false);
  });

  it('allows only a proven dimensionless literal to broadcast in scalar multiplication', () => {
    const catalog = makeCatalog();
    const registry = standard();
    const scalar: Expression = { kind: 'literal', value: 2, type: { value: 'integer', nullable: false } };
    const result = checkExpression(call('core.multiply', [field('numerator'), scalar]), {
      catalog,
      registry,
      entityId: 'employees',
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.type.unit?.symbol).toBe('day');
    expect(result.ok && result.value.type.grain).toEqual(['employee.id']);
    const unsafe = checkExpression(call('core.multiply', [field('numerator'), field('denominator')]), {
      catalog,
      registry,
      entityId: 'employees',
    });
    expect(unsafe.ok).toBe(false);
  });

  it('keeps temporal calendar, timezone and grain in compatibility', () => {
    const left: SemanticType = {
      value: 'instant',
      nullable: false,
      temporal: { calendar: 'gregorian', timezone: 'UTC', grain: 'day' },
    };
    const right: SemanticType = {
      value: 'instant',
      nullable: false,
      temporal: { calendar: 'gregorian', timezone: 'Asia/Jakarta', grain: 'day' },
    };
    expect(sameTemporal(left, right)).toBe(false);
  });

  it('checks units and grains for custom numeric comparisons', () => {
    const comparison: FunctionSignature = {
      ref: { id: 'test.compare', revision: '1' },
      parameters: [{ constraint: { kind: 'numeric' } }, { constraint: { kind: 'numeric' } }],
      output: { value: 'boolean', nullable: false },
      contexts: ['row'],
      nullPolicy: 'propagate',
      aggregation: { kind: 'none', dimensions: [] },
      operation: 'comparison',
      deterministic: true,
      cost: { maxNodes: 8 },
      realization: 'local',
    };
    const registryOutcome = createFunctionRegistry({ digest: 'comparison-registry', signatures: [comparison] });
    expect(registryOutcome.ok).toBe(true);
    if (!registryOutcome.ok) return;
    const catalog = makeCatalog({ functionRegistryDigest: registryOutcome.value.digest });
    const index = createCatalogIndex(catalog);
    expect(index.ok).toBe(true);
    if (!index.ok) return;
    const result = checkExpression(
      { kind: 'call', function: comparison.ref, arguments: [field('usd'), field('cents')] },
      { catalog, index: index.value, registry: registryOutcome.value, entityId: 'employees' },
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.diagnostics[0]?.code).toBe('semantic.unit-mismatch');
  });

  it('does not let an any-typed comparison mix text and numeric values', () => {
    const comparison: FunctionSignature = {
      ref: { id: 'test.compare.any', revision: '1' },
      parameters: [{ constraint: { kind: 'any' } }, { constraint: { kind: 'any' } }],
      output: { value: 'boolean', nullable: false },
      contexts: ['row'],
      nullPolicy: 'propagate',
      aggregation: { kind: 'none', dimensions: [] },
      operation: 'comparison',
      deterministic: true,
      cost: { maxNodes: 8 },
      realization: 'local',
    };
    const registryOutcome = createFunctionRegistry({ digest: 'comparison-any-registry', signatures: [comparison] });
    expect(registryOutcome.ok).toBe(true);
    if (!registryOutcome.ok) return;
    const catalog = makeCatalog({ functionRegistryDigest: registryOutcome.value.digest });
    const textValue: Expression = { kind: 'literal', value: '1', type: { value: 'text', nullable: false } };
    const numberValue: Expression = { kind: 'literal', value: 1, type: { value: 'integer', nullable: false } };
    const result = checkExpression(
      { kind: 'call', function: comparison.ref, arguments: [textValue, numberValue] },
      { catalog, registry: registryOutcome.value },
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.diagnostics[0]?.code).toBe('semantic.type-mismatch');
  });

  it('applies declared arithmetic unit rules instead of inspecting function IDs', () => {
    const arithmetic: FunctionSignature = {
      ref: { id: 'domain.scale', revision: '1' },
      parameters: [{ constraint: { kind: 'numeric' } }, { constraint: { kind: 'numeric' } }],
      output: { kind: 'numeric' },
      contexts: ['row'],
      nullPolicy: 'propagate',
      unitRule: 'scalar-multiply',
      aggregation: { kind: 'none', dimensions: [] },
      operation: 'arithmetic',
      deterministic: true,
      cost: { maxNodes: 8 },
      realization: 'local',
    };
    const registryOutcome = createFunctionRegistry({ digest: 'arithmetic-registry', signatures: [arithmetic] });
    expect(registryOutcome.ok).toBe(true);
    if (!registryOutcome.ok) return;
    const catalog = makeCatalog({ functionRegistryDigest: registryOutcome.value.digest });
    const scalar: Expression = { kind: 'literal', value: 2, type: { value: 'integer', nullable: false } };
    const result = checkExpression(
      { kind: 'call', function: arithmetic.ref, arguments: [field('usd'), scalar] },
      { catalog, registry: registryOutcome.value, entityId: 'employees' },
    );
    expect(result.ok).toBe(true);
  });

  it('honours requested window context and preserves a window-only default', () => {
    const window: FunctionSignature = {
      ref: { id: 'test.window', revision: '1' },
      parameters: [{ constraint: { kind: 'numeric' } }],
      output: { kind: 'same-as', argument: 0 },
      contexts: ['window'],
      nullPolicy: 'propagate',
      aggregation: { kind: 'non-additive', dimensions: [] },
      operation: 'temporal',
      deterministic: true,
      cost: { maxNodes: 8 },
      realization: 'local',
    };
    const registryOutcome = createFunctionRegistry({ digest: 'window-registry', signatures: [window] });
    expect(registryOutcome.ok).toBe(true);
    if (!registryOutcome.ok) return;
    const catalog = makeCatalog({ functionRegistryDigest: registryOutcome.value.digest });
    const result = checkExpression(
      { kind: 'call', function: window.ref, arguments: [field('numerator')] },
      { catalog, registry: registryOutcome.value, evaluationContext: 'window' },
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.context).toBe('window');
    const wrong = checkExpression(
      { kind: 'call', function: window.ref, arguments: [field('numerator')] },
      { catalog, registry: registryOutcome.value, evaluationContext: 'row' },
    );
    expect(wrong.ok).toBe(false);
  });

  it('rejects invalid temporal literals and incompatible instant zones', () => {
    const catalog = makeCatalog();
    const registry = standard();
    const invalidDate: Expression = { kind: 'literal', value: '2025-02-29', type: { value: 'date', nullable: false } };
    const invalidInstant: Expression = { kind: 'literal', value: 'nope', type: { value: 'instant', nullable: false } };
    expect(checkExpression(invalidDate, { catalog, registry }).ok).toBe(false);
    expect(checkExpression(invalidInstant, { catalog, registry }).ok).toBe(false);
    const utc: Expression = {
      kind: 'literal',
      value: '2025-01-01T00:00:00Z',
      type: { value: 'instant', nullable: false, temporal: { calendar: 'gregorian', timezone: 'UTC', grain: 'day' } },
    };
    const jakarta: Expression = {
      kind: 'literal',
      value: '2025-01-01T07:00:00+07:00',
      type: {
        value: 'instant',
        nullable: false,
        temporal: { calendar: 'gregorian', timezone: 'Asia/Jakarta', grain: 'day' },
      },
    };
    const comparison: FunctionSignature = {
      ref: { id: 'test.compare.instant', revision: '1' },
      parameters: [{ constraint: { kind: 'any' } }, { constraint: { kind: 'any' } }],
      output: { value: 'boolean', nullable: false },
      contexts: ['row'],
      nullPolicy: 'propagate',
      aggregation: { kind: 'none', dimensions: [] },
      operation: 'comparison',
      deterministic: true,
      cost: { maxNodes: 8 },
      realization: 'local',
    };
    const custom = createFunctionRegistry({ digest: 'instant-registry', signatures: [comparison] });
    expect(custom.ok).toBe(true);
    if (!custom.ok) return;
    const instantCatalog = makeCatalog({ functionRegistryDigest: custom.value.digest });
    const compared = checkExpression(
      { kind: 'call', function: comparison.ref, arguments: [utc, jakarta] },
      { catalog: instantCatalog, registry: custom.value },
    );
    expect(compared.ok).toBe(false);
    expect(compared.ok ? '' : compared.diagnostics[0]?.code).toBe('semantic.temporal-mismatch');
  });

  it('builds ratio-of-sums and mean-of-rates through registered operations', () => {
    const catalog = makeCatalog();
    const registry = standard();
    const authoring = createTypedAuthoring({ catalog, registry });
    expect(authoring.ok).toBe(true);
    if (!authoring.ok) return;
    const numerator = authoring.value.field('employees', 'numerator');
    const denominator = authoring.value.field('employees', 'denominator');
    expect(numerator.ok && denominator.ok).toBe(true);
    if (!numerator.ok || !denominator.ok) return;
    const ratio = authoring.value.ratioOfSums({ numerator, denominator, zeroDenominator: 'null' });
    expect(ratio.ok).toBe(true);
    expect(ratio.ok && ratio.value.operation).toBe('ratio-of-sums');
    expect(ratio.ok && ratio.value.aggregation).toBe('ratio-of-sums');
    const mean = authoring.value.meanOfRates({ rates: [numerator, denominator] });
    expect(mean.ok).toBe(true);
    expect(mean.ok && mean.value.operation).toBe('mean-of-rates');
    expect(mean.ok && mean.value.aggregation).toBe('non-additive');
  });

  it('retains entity binding in typed authoring and rejects rebinding by first field', () => {
    const catalog = makeCatalog({
      entities: [
        {
          id: 'e1',
          label: 'E1',
          identity: ['e1.id'],
          rowGrain: ['e1.id'],
          fields: [number('e1.id', undefined), number('shared', { dimension: 'count', symbol: 'n' })],
        },
        {
          id: 'e2',
          label: 'E2',
          identity: ['e2.id'],
          rowGrain: ['e2.id'],
          fields: [number('e2.id', undefined), text('shared')],
        },
      ],
    });
    const registry = standard();
    const authoring = createTypedAuthoring({ catalog, registry });
    expect(authoring.ok).toBe(true);
    if (!authoring.ok) return;
    const left = authoring.value.field('e1', 'shared');
    const right = authoring.value.field('e2', 'shared');
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    const combined = authoring.value.call({ id: 'core.add', revision: '1' }, [left, right]);
    expect(combined.ok).toBe(false);
    expect(combined.ok ? '' : combined.diagnostics[0]?.code).toBe('semantic.entity-grain');
  });

  it('rejects stale authoring inputs and pins catalog and definition snapshots', () => {
    const registry = standard();
    const stale = createTypedAuthoring({
      catalog: makeCatalog({ functionRegistryDigest: 'different-registry' }),
      registry,
    });
    expect(stale.ok).toBe(false);
    expect(stale.ok ? '' : stale.diagnostics[0]?.code).toBe('semantic.stale-registry');

    const catalog = makeCatalog();
    const definition: MeaningDefinition = {
      id: 'pinned',
      revision: '1',
      label: 'Original',
      explanation: 'Original',
      output: { value: 'integer', nullable: false },
      implementation: {
        kind: 'expression',
        expression: { kind: 'literal', value: 1, type: { value: 'integer', nullable: false } },
      },
      dependencies: [],
      functionRegistryDigest: registry.digest,
      origin: 'manual',
      lifecycle: 'draft',
      scope: 'session',
      authority: 'hypothesis',
      aggregation: 'none',
      aggregationDimensions: [],
      missingPolicy: 'propagate',
    };
    const sourceDefinitions = [definition];
    const authoring = createTypedAuthoring({ catalog, registry, definitions: sourceDefinitions });
    expect(authoring.ok).toBe(true);
    if (!authoring.ok) return;

    (catalog as unknown as { revision: string }).revision = 'catalog-mutated';
    (definition as unknown as { label: string }).label = 'Mutated';
    expect(authoring.value.catalog.revision).toBe('catalog-1');
    expect(authoring.value.field('employees', 'numerator').ok).toBe(true);
    const conflicting = authoring.value.bundle([definition]);
    expect(conflicting.ok).toBe(false);
    expect(conflicting.ok ? '' : conflicting.diagnostics[0]?.code).toBe('semantic.definition-conflict');
  });

  it('does not let an approved label grant activation without trusted host policy', () => {
    const catalog = makeCatalog();
    const registry = standard();
    const meaning: MeaningDefinition = {
      id: 'hr.rate',
      revision: '1',
      label: 'Rate',
      explanation: 'A reviewed rate',
      output: { value: 'float', nullable: false },
      implementation: {
        kind: 'expression',
        expression: { kind: 'literal', value: 1, type: { value: 'float', nullable: false } },
      },
      dependencies: [],
      functionRegistryDigest: registry.digest,
      origin: 'ai-assisted',
      lifecycle: 'active',
      scope: 'workspace',
      authority: 'approved',
      aggregation: 'none',
      aggregationDimensions: [],
      missingPolicy: 'propagate',
    };
    const validated = validateMeaning(meaning, { catalog, registry });
    expect(validated.ok).toBe(true);
    const denied = authorizeMeaningActivation(meaning, { policyRevision: 'policy-1', allowlistedDefinitions: [] });
    expect(denied.ok).toBe(false);
    expect(denied.ok ? '' : denied.diagnostics[0]?.code).toBe('semantic.activation-denied');
    const forged = { ...meaning, label: 'forged' };
    const forgedDenied = authorizeMeaningActivation(forged, {
      policyRevision: 'policy-1',
      allowlistedDefinitions: [meaning],
    });
    expect(forgedDenied.ok).toBe(false);
    const authorized = authorizeMeaningActivation(meaning, {
      policyRevision: 'policy-1',
      allowlistedDefinitions: [meaning],
    });
    expect(authorized.ok).toBe(true);
  });

  it('rejects conflicting same-version definitions and stale supplied indexes', () => {
    const catalog = makeCatalog();
    const registry = standard();
    const index = createCatalogIndex(catalog);
    expect(index.ok).toBe(true);
    if (!index.ok) return;
    const base: MeaningDefinition = {
      id: 'm',
      revision: '1',
      label: 'M',
      explanation: 'M',
      output: { value: 'integer', nullable: false },
      implementation: {
        kind: 'expression',
        expression: { kind: 'literal', value: 1, type: { value: 'integer', nullable: false } },
      },
      dependencies: [],
      functionRegistryDigest: registry.digest,
      origin: 'manual',
      lifecycle: 'draft',
      scope: 'session',
      authority: 'hypothesis',
      aggregation: 'none',
      aggregationDimensions: [],
      missingPolicy: 'propagate',
    };
    const conflicting = { ...base, label: 'different' };
    const conflict = checkExpression(
      { kind: 'definition', ref: { id: 'm', revision: '1' } },
      { catalog, registry, index: index.value, definitions: [base, conflicting] },
    );
    expect(conflict.ok).toBe(false);
    expect(conflict.ok ? '' : conflict.diagnostics[0]?.code).toBe('semantic.definition-conflict');
    const staleCatalog = makeCatalog({ revision: 'catalog-2' });
    const stale = checkExpression(field('employee.id'), { catalog: staleCatalog, registry, index: index.value });
    expect(stale.ok).toBe(false);
    expect(stale.ok ? '' : stale.diagnostics[0]?.code).toBe('semantic.stale-catalog-index');
  });

  it('rejects bundle definitions that shadow catalog contents at the same identity', () => {
    const registry = standard();
    const base: MeaningDefinition = {
      id: 'same',
      revision: '1',
      label: 'Catalog meaning',
      explanation: 'M',
      output: { value: 'integer', nullable: false },
      implementation: {
        kind: 'expression',
        expression: { kind: 'literal', value: 1, type: { value: 'integer', nullable: false } },
      },
      dependencies: [],
      functionRegistryDigest: registry.digest,
      origin: 'manual',
      lifecycle: 'draft',
      scope: 'session',
      authority: 'hypothesis',
      aggregation: 'none',
      aggregationDimensions: [],
      missingPolicy: 'propagate',
    };
    const catalog = makeCatalog({ meanings: [base] });
    const conflicting = { ...base, label: 'Bundle shadow' };
    const result = validateMeaningBundle(
      { catalogRevision: catalog.revision, functionRegistryDigest: registry.digest, meanings: [conflicting] },
      { catalog, registry },
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.diagnostics[0]?.code).toBe('semantic.definition-conflict');
  });

  it('indexes bundle meanings before validating dependency order and reports cycles', () => {
    const registry = standard();
    const makeMeaning = (id: string, dependencies: readonly { id: string; revision: string }[]): MeaningDefinition => ({
      id,
      revision: '1',
      label: id,
      explanation: id,
      output: { value: 'integer', nullable: false },
      implementation: {
        kind: 'expression',
        expression: { kind: 'literal', value: 1, type: { value: 'integer', nullable: false } },
      },
      dependencies,
      functionRegistryDigest: registry.digest,
      origin: 'manual',
      lifecycle: 'draft',
      scope: 'session',
      authority: 'hypothesis',
      aggregation: 'none',
      aggregationDimensions: [],
      missingPolicy: 'propagate',
    });
    const catalog = makeCatalog();
    const b = makeMeaning('b', []);
    const a = makeMeaning('a', [{ id: 'b', revision: '1' }]);
    const ordered = validateMeaningBundle(
      { catalogRevision: catalog.revision, functionRegistryDigest: registry.digest, meanings: [a, b] },
      { catalog, registry },
    );
    expect(ordered.ok).toBe(true);
    const cycleA = makeMeaning('cycle-a', [{ id: 'cycle-b', revision: '1' }]);
    const cycleB = makeMeaning('cycle-b', [{ id: 'cycle-a', revision: '1' }]);
    const cycle = validateMeaningBundle(
      { catalogRevision: catalog.revision, functionRegistryDigest: registry.digest, meanings: [cycleA, cycleB] },
      { catalog, registry },
    );
    expect(cycle.ok).toBe(false);
    expect(cycle.ok ? '' : cycle.diagnostics[0]?.code).toBe('semantic.cycle');
    const stale = { ...b, functionRegistryDigest: 'old-registry' };
    const staleResult = validateMeaningBundle(
      { catalogRevision: catalog.revision, functionRegistryDigest: registry.digest, meanings: [stale] },
      { catalog, registry },
    );
    expect(staleResult.ok).toBe(false);
    expect(staleResult.ok ? '' : staleResult.diagnostics[0]?.code).toBe('semantic.stale-registry');
  });

  it('validates standalone and inherited dependency closure with bounded bundle ingress', () => {
    const registry = standard();
    const makeMeaning = (
      id: string,
      dependencies: readonly { id: string; revision: string }[],
      digest = registry.digest,
    ): MeaningDefinition => ({
      id,
      revision: '1',
      label: id,
      explanation: id,
      output: { value: 'integer', nullable: false },
      implementation: {
        kind: 'expression',
        expression: { kind: 'literal', value: 1, type: { value: 'integer', nullable: false } },
      },
      dependencies,
      functionRegistryDigest: digest,
      origin: 'manual',
      lifecycle: 'draft',
      scope: 'session',
      authority: 'hypothesis',
      aggregation: 'none',
      aggregationDimensions: [],
      missingPolicy: 'propagate',
    });
    const catalog = makeCatalog();
    const cycleA = makeMeaning('standalone-a', [{ id: 'standalone-b', revision: '1' }]);
    const cycleB = makeMeaning('standalone-b', [{ id: 'standalone-a', revision: '1' }]);
    const standalone = validateMeaning(cycleA, { catalog, registry, definitions: [cycleA, cycleB] });
    expect(standalone.ok).toBe(false);
    expect(standalone.ok ? '' : standalone.diagnostics[0]?.code).toBe('semantic.cycle');

    const staleLeaf = makeMeaning('inherited-c', [], 'old-registry');
    const inheritedMiddle = makeMeaning('inherited-b', [{ id: 'inherited-c', revision: '1' }]);
    const suppliedRoot = makeMeaning('supplied-a', [{ id: 'inherited-b', revision: '1' }]);
    const transitive = validateMeaningBundle(
      { catalogRevision: catalog.revision, functionRegistryDigest: registry.digest, meanings: [suppliedRoot] },
      { catalog: makeCatalog({ meanings: [inheritedMiddle, staleLeaf] }), registry },
    );
    expect(transitive.ok).toBe(false);
    expect(transitive.ok ? '' : transitive.diagnostics[0]?.code).toBe('semantic.stale-registry');

    const oversized = validateMeaningBundle(
      {
        catalogRevision: catalog.revision,
        functionRegistryDigest: registry.digest,
        meanings: [],
        unknownPayload: 'x'.repeat(WIRE_LIMITS.bytes + 1),
      } as unknown,
      { catalog, registry },
    );
    expect(oversized.ok).toBe(false);
    expect(oversized.ok ? '' : oversized.diagnostics[0]?.code.startsWith('wire.')).toBe(true);
  });

  it('uses collision-safe identity for versioned functions', () => {
    const first = { ...standardFunctionSignatures[0]!, ref: { id: 'a@b', revision: 'c' } };
    const second = { ...standardFunctionSignatures[0]!, ref: { id: 'a', revision: 'b@c' } };
    const result = createFunctionRegistry({
      digest: 'collision-test',
      signatures: [first, second] as readonly FunctionSignature[],
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.resolve(first.ref)).toBeDefined();
    expect(result.ok && result.value.resolve(second.ref)).toBeDefined();
  });

  it('snapshots function signatures so caller mutation cannot change a pinned registry', () => {
    const source = { ...standardFunctionSignatures[0]!, ref: { id: 'mutable.fn', revision: '1' } };
    const result = createFunctionRegistry({ digest: 'immutable-test', signatures: [source] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    source.ref.id = 'changed';
    (source.contexts as string[]).push('window');
    expect(result.value.resolve({ id: 'mutable.fn', revision: '1' })?.ref.id).toBe('mutable.fn');
    expect(result.value.resolve({ id: 'changed', revision: '1' })).toBeUndefined();
    expect(result.value.signatures[0]?.contexts).toEqual(['row', 'group']);
  });

  it('fails malformed registry input with a diagnostic rather than throwing', () => {
    const result = createFunctionRegistry({ digest: 'bad', signatures: [{} as FunctionSignature] });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.diagnostics[0]?.code).toBe('semantic.registry-ref');
    const malformedCatalog = createCatalogIndex({ entities: [null] } as unknown as Catalog);
    expect(malformedCatalog.ok).toBe(false);
    const optionalMiddle: FunctionSignature = {
      ref: { id: 'bad.optional', revision: '1' },
      parameters: [{ constraint: { kind: 'numeric' }, optional: true }, { constraint: { kind: 'text' } }],
      output: { kind: 'numeric' },
      contexts: ['row'],
      nullPolicy: 'propagate',
      aggregation: { kind: 'none', dimensions: [] },
      operation: 'other',
      deterministic: true,
      cost: { maxNodes: 4 },
      realization: 'local',
    };
    expect(createFunctionRegistry({ digest: 'bad-optional', signatures: [optionalMiddle] }).ok).toBe(false);
    const invalidOutput = {
      ...optionalMiddle,
      parameters: [{ constraint: { kind: 'numeric' } }, { constraint: { kind: 'numeric' } }],
      output: { value: 'bogus', nullable: false } as never,
    };
    expect(createFunctionRegistry({ digest: 'bad-output', signatures: [invalidOutput] }).ok).toBe(false);
    const invalidOutputRef = {
      ...optionalMiddle,
      parameters: [{ constraint: { kind: 'numeric' } }, { constraint: { kind: 'numeric' } }],
      output: { kind: 'same-as', argument: 99 } as const,
    };
    expect(createFunctionRegistry({ digest: 'bad-output-ref', signatures: [invalidOutputRef] }).ok).toBe(false);
    const invalidAllowNull = {
      ...optionalMiddle,
      parameters: [{ constraint: { kind: 'any', allowNull: 'yes' } }, { constraint: { kind: 'numeric' } }] as never,
    };
    expect(createFunctionRegistry({ digest: 'bad-allow-null', signatures: [invalidAllowNull] }).ok).toBe(false);
    const explicitWithoutUnit = {
      ...optionalMiddle,
      parameters: [{ constraint: { kind: 'numeric' } }, { constraint: { kind: 'numeric' } }],
      unitRule: 'explicit-output' as const,
      output: { kind: 'numeric' } as const,
    };
    expect(createFunctionRegistry({ digest: 'bad-explicit-unit', signatures: [explicitWithoutUnit] }).ok).toBe(false);
    const emptyOutputUnit = {
      ...optionalMiddle,
      parameters: [{ constraint: { kind: 'numeric' } }, { constraint: { kind: 'numeric' } }],
      output: { kind: 'numeric', unit: { dimension: '', symbol: '' } } as const,
    };
    expect(createFunctionRegistry({ digest: 'bad-output-unit', signatures: [emptyOutputUnit] }).ok).toBe(false);
  });
});
