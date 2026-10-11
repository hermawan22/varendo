export { canonicalizeExpression, expressionsEqual } from './canonicalize.js';
export { checkExpression } from './check.js';
export type { ExpressionCheckContext } from './check.js';
export { createTypedAuthoring } from './builder.js';
export type {
  AuthoringOptions,
  DefineMetricInput,
  MeanOfRatesInput,
  RatioOfSumsInput,
  TypedAuthoring,
} from './builder.js';
export {
  createFunctionRegistry,
  createStandardFunctionRegistry,
  standardFunctionSignatures,
  createQueryFunctionRegistry,
  queryFunctionSignatures,
} from './registry.js';
export type {
  ExpressionInput,
  FunctionOperation,
  FunctionOutput,
  FunctionParameter,
  FunctionRegistry,
  FunctionRegistryInput,
  FunctionSignature,
  TypedExpression,
  TypeConstraint,
} from './types.js';
