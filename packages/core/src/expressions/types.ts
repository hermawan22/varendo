import type { Expression, Outcome, SemanticType, VersionRef } from '../contracts/types.js';
import type { AggregationKind, EvaluationContext, ZeroDenominatorPolicy } from '../semantics/types.js';

export type TypeConstraint =
  | { readonly kind: 'any'; readonly allowNull?: boolean }
  | { readonly kind: 'numeric'; readonly allowNull?: boolean }
  | { readonly kind: 'boolean'; readonly allowNull?: boolean }
  | { readonly kind: 'text'; readonly allowNull?: boolean }
  | { readonly kind: 'exact'; readonly type: SemanticType }
  | { readonly kind: 'same-as'; readonly argument: number };

export interface FunctionParameter {
  readonly constraint: TypeConstraint;
  readonly optional?: boolean;
}

export type FunctionOutput =
  | SemanticType
  | { readonly kind: 'same-as'; readonly argument: number }
  | { readonly kind: 'nullable-same-as'; readonly argument: number }
  | {
      readonly kind: 'numeric';
      /** A registered output unit.  Omitted means unitless/inferred only where safe. */
      readonly unit?: SemanticType['unit'];
      /** Force a fractional representation for operations such as a mean. */
      readonly forceFloat?: boolean;
    };

export type FunctionOperation =
  | 'arithmetic'
  | 'comparison'
  | 'boolean'
  | 'coalesce'
  | 'conditional'
  | 'cast'
  | 'aggregate'
  | 'divide'
  | 'ratio-of-sums'
  | 'mean-of-rates'
  | 'temporal'
  | 'other';

export interface FunctionSignature {
  readonly ref: VersionRef;
  readonly parameters: readonly FunctionParameter[];
  readonly variadic?: FunctionParameter;
  readonly output: FunctionOutput;
  readonly contexts: readonly EvaluationContext[];
  readonly nullPolicy: 'propagate' | 'reject' | 'exclude-pair';
  /** Result nullability semantics for explicit outputs. */
  readonly nullResult?: 'propagate' | 'preserve' | 'non-null';
  /** Declared unit rule for arithmetic operations; IDs are never inspected. */
  readonly unitRule?: 'same' | 'scalar-multiply' | 'explicit-output';
  readonly aggregation: {
    readonly kind: AggregationKind;
    readonly dimensions: readonly string[];
  };
  readonly operation: FunctionOperation;
  readonly deterministic: boolean;
  /** Executor negotiation metadata; the pure checker enforces its own AST budget. */
  readonly cost: { readonly maxNodes: number; readonly maxMilliseconds?: number };
  readonly realization: 'local' | 'host' | 'both';
  readonly zeroDenominator?: ZeroDenominatorPolicy;
}

export interface FunctionRegistry {
  readonly digest: string;
  readonly signatures: readonly FunctionSignature[];
  resolve(ref: VersionRef): FunctionSignature | undefined;
}

export interface FunctionRegistryInput {
  readonly digest: string;
  readonly signatures: readonly FunctionSignature[];
}

export interface TypedExpression {
  readonly expression: Expression;
  readonly type: SemanticType;
  readonly context: EvaluationContext;
  /** Internal binding identity retained by typed authoring; never serialized. */
  readonly entityId?: string;
  readonly aggregation?: AggregationKind;
  readonly operation?: FunctionOperation;
}

export type ExpressionInput = TypedExpression | Outcome<TypedExpression>;
