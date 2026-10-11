import {
  cloneSignature,
  queryFunctionSignatures,
  queryFunctionSignaturesV2,
  standardFunctionSignatures,
} from './standard-signatures.js';
export { queryFunctionSignatures, queryFunctionSignaturesV2, standardFunctionSignatures };
import type { Outcome, SemanticType, VersionRef } from '../contracts/types.js';
import { semanticFailure } from '../semantics/errors.js';
import { validateSemanticType } from '../semantics/type-utils.js';
import { versionRefKey as versionKey } from '../contracts/stable.js';
import type {
  FunctionParameter,
  FunctionRegistry,
  FunctionRegistryInput,
  FunctionSignature,
  TypeConstraint,
} from './types.js';

interface SignatureIdentity {
  readonly signature: Record<string, unknown>;
  readonly key: string;
  readonly path: readonly (string | number)[];
}

type ValidationFailure = Outcome<never> | undefined;

function validateRegistryInput(input: FunctionRegistryInput): ValidationFailure {
  if (typeof input.digest !== 'string' || input.digest.trim() === '')
    return semanticFailure('semantic.registry-digest', 'A function registry needs a nonempty immutable digest.', [
      'digest',
    ]);
  if (!Array.isArray(input.signatures) || input.signatures.length === 0)
    return semanticFailure('semantic.registry-empty', 'A function registry needs at least one versioned signature.', [
      'signatures',
    ]);
  return undefined;
}

function identifySignature(value: unknown, index: number, seen: Set<string>): Outcome<SignatureIdentity> {
  const path = ['signatures', index] as const;
  if (!isRecord(value))
    return semanticFailure('semantic.registry-signature', 'Function signature must be an object.', path);
  const reference = value.ref;
  if (!validVersionRef(reference))
    return semanticFailure('semantic.registry-ref', 'Function signature must pin a nonempty ID and revision.', [
      ...path,
      'ref',
    ]);
  const key = versionKey(reference);
  if (seen.has(key))
    return semanticFailure('semantic.registry-duplicate', 'Function ' + key + ' is declared more than once.', [
      ...path,
      'ref',
    ]);
  seen.add(key);
  return { ok: true, value: { signature: value, key, path } };
}

function validateContexts(
  signature: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
): ValidationFailure {
  const contexts = signature.contexts;
  if (Array.isArray(contexts) && contexts.length > 0 && contexts.every(isEvaluationContext)) return undefined;
  return semanticFailure('semantic.registry-context', 'Function ' + key + ' must declare an evaluation context.', [
    ...path,
    'contexts',
  ]);
}

function validateCost(
  signature: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
): ValidationFailure {
  const cost = isRecord(signature.cost) ? signature.cost : undefined;
  const validMaxNodes =
    cost !== undefined && typeof cost.maxNodes === 'number' && Number.isSafeInteger(cost.maxNodes) && cost.maxNodes > 0;
  const validMilliseconds =
    cost?.maxMilliseconds === undefined ||
    (typeof cost.maxMilliseconds === 'number' && Number.isFinite(cost.maxMilliseconds) && cost.maxMilliseconds > 0);
  if (validMaxNodes && validMilliseconds) return undefined;
  return semanticFailure('semantic.registry-cost', 'Function ' + key + ' must declare a positive node budget.', [
    ...path,
    'cost',
    'maxNodes',
  ]);
}

function validateParameterShape(
  signature: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
): Outcome<readonly FunctionParameter[]> {
  const parameters = signature.parameters;
  if (
    Array.isArray(parameters) &&
    parameters.every(validParameter) &&
    (signature.variadic === undefined || validParameter(signature.variadic))
  )
    return { ok: true, value: parameters };
  return semanticFailure('semantic.registry-parameter', 'Function ' + key + ' has invalid parameter declarations.', [
    ...path,
    'parameters',
  ]);
}

function validateParameterConstraints(
  signature: Record<string, unknown>,
  parameters: readonly FunctionParameter[],
  key: string,
  path: readonly (string | number)[],
): ValidationFailure {
  for (let index = 0; index < parameters.length; index += 1) {
    if (validConstraint(parameters[index]!.constraint, index)) continue;
    return semanticFailure('semantic.registry-parameter', 'Function ' + key + ' has an invalid parameter constraint.', [
      ...path,
      'parameters',
      index,
      'constraint',
    ]);
  }
  const variadic = signature.variadic as FunctionParameter | undefined;
  if (variadic === undefined || validConstraint(variadic.constraint, parameters.length)) return undefined;
  return semanticFailure('semantic.registry-parameter', 'Function ' + key + ' has an invalid variadic constraint.', [
    ...path,
    'variadic',
    'constraint',
  ]);
}

function validateParameterOrder(
  parameters: readonly FunctionParameter[],
  key: string,
  path: readonly (string | number)[],
): ValidationFailure {
  let optionalSeen = false;
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index]!;
    if (parameter.optional === true) optionalSeen = true;
    else if (optionalSeen)
      return semanticFailure(
        'semantic.registry-parameter',
        'Function ' + key + ' cannot place a required parameter after an optional parameter.',
        [...path, 'parameters', index],
      );
  }
  return undefined;
}

function validateParameters(
  signature: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
): Outcome<readonly FunctionParameter[]> {
  const shape = validateParameterShape(signature, key, path);
  if (!shape.ok) return shape;
  const constraints = validateParameterConstraints(signature, shape.value, key, path);
  if (constraints !== undefined) return constraints;
  const order = validateParameterOrder(shape.value, key, path);
  if (order !== undefined) return order;
  return shape;
}

function validateOutput(
  signature: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
): ValidationFailure {
  const parameters = signature.parameters as readonly FunctionParameter[];
  if (validOutput(signature.output, parameters.length)) return undefined;
  return semanticFailure('semantic.registry-output', 'Function ' + key + ' has an invalid output declaration.', [
    ...path,
    'output',
  ]);
}

function validateAggregation(
  signature: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
): ValidationFailure {
  const aggregation = isRecord(signature.aggregation) ? signature.aggregation : undefined;
  const validDimensions =
    aggregation !== undefined &&
    Array.isArray(aggregation.dimensions) &&
    aggregation.dimensions.every((dimension: unknown) => typeof dimension === 'string' && dimension.length > 0);
  if (aggregation !== undefined && isAggregationKind(aggregation.kind) && validDimensions) return undefined;
  return semanticFailure(
    'semantic.registry-aggregation',
    'Function ' + key + ' has an invalid aggregation declaration.',
    [...path, 'aggregation'],
  );
}

function validateZeroPolicy(
  signature: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
): ValidationFailure {
  const operation = signature.operation;
  if ((operation === 'divide' || operation === 'ratio-of-sums') && signature.zeroDenominator === undefined)
    return semanticFailure(
      'semantic.registry-zero-denominator',
      'Division-like function ' + key + ' must declare a zero-denominator policy.',
      [...path, 'zeroDenominator'],
    );
  if (signature.zeroDenominator !== undefined && !isZeroPolicy(signature.zeroDenominator))
    return semanticFailure(
      'semantic.registry-zero-denominator',
      'Function ' + key + ' has an invalid zero-denominator policy.',
      [...path, 'zeroDenominator'],
    );
  if (operation !== 'divide' && operation !== 'ratio-of-sums' && signature.zeroDenominator !== undefined)
    return semanticFailure(
      'semantic.registry-zero-denominator',
      'Only division-like functions may declare zero-denominator policy.',
      [...path, 'zeroDenominator'],
    );
  return undefined;
}

function validateExecutionMetadata(
  signature: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
): ValidationFailure {
  const metadataValid =
    isFunctionOperation(signature.operation) &&
    typeof signature.deterministic === 'boolean' &&
    isNullPolicy(signature.nullPolicy) &&
    isNullResult(signature.nullResult) &&
    isUnitRule(signature.unitRule) &&
    isRealization(signature.realization);
  if (!metadataValid)
    return semanticFailure('semantic.registry-signature', 'Function ' + key + ' has invalid execution metadata.', path);
  if (
    signature.unitRule === 'explicit-output' &&
    !outputHasExplicitUnit(signature.output as FunctionSignature['output'])
  )
    return semanticFailure(
      'semantic.registry-unit-rule',
      'Function ' + key + ' must declare an explicit output unit when using the explicit-output unit rule.',
      [...path, 'unitRule'],
    );
  return validateZeroPolicy(signature, key, path);
}

function validateFunctionSignature(value: unknown, index: number, seen: Set<string>): ValidationFailure {
  const identity = identifySignature(value, index, seen);
  if (!identity.ok) return identity;
  const { signature, key, path } = identity.value;
  const contexts = validateContexts(signature, key, path);
  if (contexts !== undefined) return contexts;
  const cost = validateCost(signature, key, path);
  if (cost !== undefined) return cost;
  const parameters = validateParameters(signature, key, path);
  if (!parameters.ok) return parameters;
  const output = validateOutput(signature, key, path);
  if (output !== undefined) return output;
  const aggregation = validateAggregation(signature, key, path);
  if (aggregation !== undefined) return aggregation;
  return validateExecutionMetadata(signature, key, path);
}

function validateSignatures(signatures: readonly FunctionSignature[]): Outcome<void> {
  const seen = new Set<string>();
  for (let index = 0; index < signatures.length; index += 1) {
    const validation = validateFunctionSignature(signatures[index], index, seen);
    if (validation !== undefined) return validation;
  }
  return { ok: true, value: undefined };
}

export function createFunctionRegistry(input: FunctionRegistryInput): Outcome<FunctionRegistry> {
  const inputStatus = validateRegistryInput(input);
  if (inputStatus !== undefined) return inputStatus;
  const signatureStatus = validateSignatures(input.signatures);
  if (!signatureStatus.ok) return signatureStatus;

  // Keep a private immutable snapshot. A digest is a host-supplied version
  // pin; it is not a cryptographic hash of mutable caller objects.
  const signatures = Object.freeze(input.signatures.map(cloneSignature));
  const registry: FunctionRegistry = {
    digest: input.digest,
    signatures,
    resolve(ref) {
      const wanted = versionKey(ref);
      return signatures.find((signature) => versionKey(signature.ref) === wanted);
    },
  };
  return { ok: true, value: Object.freeze(registry) };
}

const EVALUATION_CONTEXTS: ReadonlySet<unknown> = new Set(['row', 'group', 'window', 'aggregate-of-aggregates']);
const AGGREGATION_KINDS: ReadonlySet<unknown> = new Set([
  'additive',
  'semi-additive',
  'non-additive',
  'ratio-of-sums',
  'none',
]);
const FUNCTION_OPERATIONS: ReadonlySet<unknown> = new Set([
  'arithmetic',
  'comparison',
  'boolean',
  'coalesce',
  'conditional',
  'cast',
  'aggregate',
  'divide',
  'ratio-of-sums',
  'mean-of-rates',
  'temporal',
  'other',
]);
const NULL_POLICIES: ReadonlySet<unknown> = new Set(['propagate', 'reject', 'exclude-pair']);
const NULL_RESULTS: ReadonlySet<unknown> = new Set([undefined, 'propagate', 'preserve', 'non-null']);
const UNIT_RULES: ReadonlySet<unknown> = new Set([undefined, 'same', 'scalar-multiply', 'explicit-output']);
const REALIZATIONS: ReadonlySet<unknown> = new Set(['local', 'host', 'both']);
const ZERO_POLICIES: ReadonlySet<unknown> = new Set(['null', 'unknown', 'error']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validVersionRef(value: unknown): value is VersionRef {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.revision === 'string' &&
    value.revision.length > 0
  );
}

function isEvaluationContext(value: unknown): value is FunctionSignature['contexts'][number] {
  return EVALUATION_CONTEXTS.has(value);
}

function isAggregationKind(value: unknown): value is FunctionSignature['aggregation']['kind'] {
  return AGGREGATION_KINDS.has(value);
}

function isFunctionOperation(value: unknown): value is FunctionSignature['operation'] {
  return FUNCTION_OPERATIONS.has(value);
}

function isNullPolicy(value: unknown): value is FunctionSignature['nullPolicy'] {
  return NULL_POLICIES.has(value);
}

function isNullResult(value: unknown): value is NonNullable<FunctionSignature['nullResult']> {
  return NULL_RESULTS.has(value);
}

function isUnitRule(value: unknown): value is NonNullable<FunctionSignature['unitRule']> {
  return UNIT_RULES.has(value);
}

function isRealization(value: unknown): value is FunctionSignature['realization'] {
  return REALIZATIONS.has(value);
}

function isZeroPolicy(value: unknown): value is NonNullable<FunctionSignature['zeroDenominator']> {
  return ZERO_POLICIES.has(value);
}

function validParameter(value: unknown): value is FunctionParameter {
  return (
    isRecord(value) &&
    validConstraint(value.constraint) &&
    (value.optional === undefined || typeof value.optional === 'boolean')
  );
}

function validOutput(value: unknown, parameterCount: number): value is FunctionSignature['output'] {
  if (!isRecord(value)) return false;
  if ('value' in value) return validateSemanticType(value as SemanticType).ok;
  if (value.kind === 'same-as' || value.kind === 'nullable-same-as') {
    const argument = value.argument;
    return typeof argument === 'number' && Number.isSafeInteger(argument) && argument >= 0 && argument < parameterCount;
  }
  if (value.kind === 'numeric')
    return (
      (value.forceFloat === undefined || typeof value.forceFloat === 'boolean') &&
      (value.unit === undefined || validUnit(value.unit))
    );
  return false;
}

function validAllowNull(constraint: Record<string, unknown>): boolean {
  return constraint.allowNull === undefined || typeof constraint.allowNull === 'boolean';
}

function validPriorParameter(constraint: Record<string, unknown>, parameterIndex: number | undefined): boolean {
  const argument = constraint.argument;
  if (typeof argument !== 'number' || !Number.isSafeInteger(argument) || argument < 0) return false;
  return parameterIndex === undefined || argument < parameterIndex;
}

function validConstraint(constraint: unknown, parameterIndex?: number): constraint is TypeConstraint {
  if (!isRecord(constraint)) return false;
  switch (constraint.kind) {
    case 'any':
    case 'numeric':
    case 'boolean':
    case 'text':
      return validAllowNull(constraint);
    case 'same-as':
      return validPriorParameter(constraint, parameterIndex);
    case 'exact':
      return validateSemanticType(constraint.type as SemanticType).ok;
    default:
      return false;
  }
}

function validUnit(value: unknown): value is NonNullable<SemanticType['unit']> {
  return (
    isRecord(value) &&
    typeof value.dimension === 'string' &&
    value.dimension.length > 0 &&
    typeof value.symbol === 'string' &&
    value.symbol.length > 0 &&
    (value.currency === undefined || (typeof value.currency === 'string' && value.currency.length > 0))
  );
}

function outputHasExplicitUnit(output: FunctionSignature['output']): boolean {
  return 'value' in output ? output.unit !== undefined : output.kind === 'numeric' && output.unit !== undefined;
}

export function createStandardFunctionRegistry(digest = 'core-standard-1'): Outcome<FunctionRegistry> {
  return createFunctionRegistry({ digest, signatures: standardFunctionSignatures });
}

export function createQueryFunctionRegistry(
  input: string | { readonly version: '2'; readonly digest?: string } = 'core-query-1',
): Outcome<FunctionRegistry> {
  if (typeof input === 'string') return createFunctionRegistry({ digest: input, signatures: queryFunctionSignatures });
  if (input === null || typeof input !== 'object' || input.version !== '2')
    return semanticFailure('semantic.registry-version', 'Unsupported query function registry version.', ['version']);
  return createFunctionRegistry({ digest: input.digest ?? 'core-query-2', signatures: queryFunctionSignaturesV2 });
}
