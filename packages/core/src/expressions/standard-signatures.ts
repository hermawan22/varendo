import type { SemanticType, VersionRef } from '../contracts/types.js';
import type { FunctionParameter, FunctionSignature, TypeConstraint } from './types.js';

export function cloneSignature(input: FunctionSignature): FunctionSignature {
  const parameters = Object.freeze(
    input.parameters.map((parameter) =>
      Object.freeze({
        ...parameter,
        constraint: cloneConstraint(parameter.constraint),
      }),
    ),
  );
  const output = cloneOutput(input.output);
  const variadic =
    input.variadic === undefined
      ? undefined
      : Object.freeze({
          ...input.variadic,
          constraint: cloneConstraint(input.variadic.constraint),
        });
  const aggregation = Object.freeze({
    kind: input.aggregation.kind,
    dimensions: Object.freeze([...input.aggregation.dimensions]),
  });
  const cost = Object.freeze({ ...input.cost });
  const contexts = Object.freeze([...input.contexts]);
  return Object.freeze({
    ...input,
    ref: Object.freeze({ ...input.ref }),
    parameters,
    ...(variadic === undefined ? {} : { variadic }),
    output,
    ...(input.nullResult === undefined ? {} : { nullResult: input.nullResult }),
    ...(input.unitRule === undefined ? {} : { unitRule: input.unitRule }),
    contexts,
    aggregation,
    cost,
  });
}

function cloneOutput(output: FunctionSignature['output']): FunctionSignature['output'] {
  if ('value' in output) return cloneSemanticType(output);
  if (output.kind === 'numeric') {
    return Object.freeze({
      ...output,
      ...(output.unit === undefined ? {} : { unit: Object.freeze({ ...output.unit }) }),
    });
  }
  return Object.freeze({ ...output });
}

function cloneConstraint(constraint: TypeConstraint): TypeConstraint {
  if (constraint.kind === 'exact') return Object.freeze({ ...constraint, type: cloneSemanticType(constraint.type) });
  return Object.freeze({ ...constraint });
}

function cloneSemanticType(type: SemanticType): SemanticType {
  return Object.freeze({
    ...type,
    ...(type.unit === undefined ? {} : { unit: Object.freeze({ ...type.unit }) }),
    ...(type.grain === undefined ? {} : { grain: Object.freeze([...type.grain]) }),
    ...(type.temporal === undefined ? {} : { temporal: Object.freeze({ ...type.temporal }) }),
  });
}

const countType = (nullable = false): SemanticType => ({ value: 'integer', nullable });
const booleanType = (nullable = false): SemanticType => ({ value: 'boolean', nullable });

const numeric: TypeConstraint = { kind: 'numeric' };
const any: TypeConstraint = { kind: 'any' };
const text: TypeConstraint = { kind: 'text' };

const AGGREGATE_OPERATIONS: ReadonlySet<unknown> = new Set(['aggregate', 'ratio-of-sums', 'mean-of-rates']);
const FRACTIONAL_OPERATIONS: ReadonlySet<unknown> = new Set(['divide', 'ratio-of-sums', 'mean-of-rates']);

export function isAggregateOperation(operation: unknown): boolean {
  return AGGREGATE_OPERATIONS.has(operation);
}

export function isFractionalOperation(operation: unknown): boolean {
  return FRACTIONAL_OPERATIONS.has(operation);
}

function signature(
  ref: VersionRef,
  parameters: readonly FunctionParameter[],
  output: FunctionSignature['output'],
  operation: FunctionSignature['operation'],
  aggregation: FunctionSignature['aggregation']['kind'] = 'none',
  options: Partial<
    Pick<FunctionSignature, 'nullPolicy' | 'contexts' | 'realization' | 'zeroDenominator' | 'nullResult' | 'unitRule'>
  > = {},
): FunctionSignature {
  return {
    ref,
    parameters,
    output,
    contexts: options.contexts ?? ['row', 'group'],
    nullPolicy: options.nullPolicy ?? 'propagate',
    ...(options.nullResult === undefined ? {} : { nullResult: options.nullResult }),
    ...(options.unitRule === undefined ? {} : { unitRule: options.unitRule }),
    aggregation: { kind: aggregation, dimensions: [] },
    operation,
    deterministic: true,
    cost: { maxNodes: 64 },
    realization: options.realization ?? 'both',
    ...(options.zeroDenominator === undefined ? {} : { zeroDenominator: options.zeroDenominator }),
  };
}

/** Trusted, reviewed signatures for the small expression vocabulary used by builders. */
export const standardFunctionSignatures: readonly FunctionSignature[] = [
  signature(
    { id: 'core.add', revision: '1' },
    [{ constraint: numeric }, { constraint: numeric }],
    { kind: 'numeric' },
    'arithmetic',
    'none',
    { unitRule: 'same' },
  ),
  signature(
    { id: 'core.subtract', revision: '1' },
    [{ constraint: numeric }, { constraint: numeric }],
    { kind: 'numeric' },
    'arithmetic',
    'none',
    { unitRule: 'same' },
  ),
  signature(
    { id: 'core.multiply', revision: '1' },
    [{ constraint: numeric }, { constraint: numeric }],
    { kind: 'numeric' },
    'arithmetic',
    'none',
    { unitRule: 'scalar-multiply' },
  ),
  signature(
    { id: 'core.divide.null', revision: '1' },
    [{ constraint: numeric }, { constraint: numeric }],
    { kind: 'numeric' },
    'divide',
    'none',
    { zeroDenominator: 'null' },
  ),
  signature(
    { id: 'core.divide.unknown', revision: '1' },
    [{ constraint: numeric }, { constraint: numeric }],
    { kind: 'numeric' },
    'divide',
    'none',
    { zeroDenominator: 'unknown' },
  ),
  signature(
    { id: 'core.divide.error', revision: '1' },
    [{ constraint: numeric }, { constraint: numeric }],
    { kind: 'numeric' },
    'divide',
    'none',
    { nullPolicy: 'reject', zeroDenominator: 'error' },
  ),
  signature(
    { id: 'core.ratio-of-sums', revision: '1' },
    [{ constraint: numeric }, { constraint: numeric }],
    { kind: 'numeric' },
    'ratio-of-sums',
    'ratio-of-sums',
    { zeroDenominator: 'null' },
  ),
  signature(
    { id: 'core.ratio-of-sums.null', revision: '1' },
    [{ constraint: numeric }, { constraint: numeric }],
    { kind: 'numeric' },
    'ratio-of-sums',
    'ratio-of-sums',
    { zeroDenominator: 'null' },
  ),
  signature(
    { id: 'core.ratio-of-sums.unknown', revision: '1' },
    [{ constraint: numeric }, { constraint: numeric }],
    { kind: 'numeric' },
    'ratio-of-sums',
    'ratio-of-sums',
    { zeroDenominator: 'unknown' },
  ),
  signature(
    { id: 'core.ratio-of-sums.error', revision: '1' },
    [{ constraint: numeric }, { constraint: numeric }],
    { kind: 'numeric' },
    'ratio-of-sums',
    'ratio-of-sums',
    { nullPolicy: 'reject', zeroDenominator: 'error' },
  ),
  {
    ...signature(
      { id: 'core.mean-of-rates', revision: '1' },
      [],
      { kind: 'numeric', forceFloat: true },
      'mean-of-rates',
      'non-additive',
      { contexts: ['group'] },
    ),
    variadic: { constraint: numeric },
  },
  signature(
    { id: 'core.is-null', revision: '1' },
    [{ constraint: any, optional: false }],
    booleanType(false),
    'comparison',
    'none',
    { nullResult: 'non-null' },
  ),
  signature(
    { id: 'core.coalesce', revision: '1' },
    [{ constraint: any }, { constraint: { kind: 'same-as', argument: 0 } }],
    { kind: 'nullable-same-as', argument: 0 },
    'coalesce',
  ),
  signature(
    { id: 'core.aggregate.sum', revision: '1' },
    [{ constraint: numeric }],
    { kind: 'same-as', argument: 0 },
    'aggregate',
    'additive',
    { contexts: ['row', 'group'] },
  ),
  signature(
    { id: 'core.aggregate.count', revision: '1' },
    [{ constraint: any }],
    countType(false),
    'aggregate',
    'additive',
    { contexts: ['row', 'group'], nullResult: 'non-null' },
  ),
  signature(
    { id: 'core.aggregate.count-distinct', revision: '1' },
    [{ constraint: any }],
    countType(false),
    'aggregate',
    'non-additive',
    { contexts: ['row', 'group'], nullResult: 'non-null' },
  ),
];

/** Query registry revision adds bounded window functions without changing core-standard-1. */
export const queryFunctionSignatures: readonly FunctionSignature[] = Object.freeze(
  [
    ...standardFunctionSignatures,
    signature(
      { id: 'core.window.sum', revision: '1' },
      [{ constraint: numeric }],
      { kind: 'same-as', argument: 0 },
      'aggregate',
      'additive',
      { contexts: ['window'] },
    ),
    signature(
      { id: 'core.window.lag', revision: '1' },
      [{ constraint: any }],
      { kind: 'nullable-same-as', argument: 0 },
      'other',
      'none',
      { contexts: ['window'] },
    ),
    signature({ id: 'core.window.rank', revision: '1' }, [], countType(false), 'other', 'none', {
      contexts: ['window'],
      nullResult: 'non-null',
    }),
  ].map(cloneSignature),
);

export const queryFunctionSignaturesV2: readonly FunctionSignature[] = Object.freeze(
  [
    ...queryFunctionSignatures,
    signature(
      { id: 'core.equal', revision: '1' },
      [{ constraint: any }, { constraint: any }],
      booleanType(false),
      'comparison',
    ),
    signature(
      { id: 'core.text.includes-casefold', revision: '1' },
      [{ constraint: text }, { constraint: text }],
      booleanType(false),
      'comparison',
    ),
    signature(
      { id: 'core.if', revision: '1' },
      [{ constraint: { kind: 'boolean' } }, { constraint: any }, { constraint: any }],
      { kind: 'same-as', argument: 1 },
      'conditional',
    ),
  ].map(cloneSignature),
);
