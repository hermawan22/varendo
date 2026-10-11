import type { Catalog, Diagnostic, Outcome, Result, ResultRef, SemanticType, Task } from '@varendo/core';
import type { AcceptedQuery, DataService, DataValue, QueryBudget, ReadContext } from '../data/types.js';
import type { ResultHandle, ResultStore } from '../results/types.js';

/** A bounded, trusted request to derive membership from an immutable result. */
export interface CohortRequest {
  readonly source: ResultRef;
  readonly identityKeys: readonly string[];
  /** Optional expected target grain. Membership keys may be a subset of a finer source grain. */
  readonly targetGrain?: readonly string[];
  readonly scopeDigest: string;
  readonly policyRevision?: string;
  readonly catalogRevision: string;
  /** A historical source pin is checked against the source handle when present. */
  readonly sourceRevision?: string;
  readonly deadlineAt: number;
  readonly signal?: AbortSignal;
}

/** The result of resolving a cohort from a real, complete ResultHandle. */
export interface CohortMembership {
  readonly source: ResultRef;
  readonly identityKeys: readonly string[];
  readonly types: readonly SemanticType[];
  readonly tuples: readonly (readonly DataValue[])[];
  readonly tupleDigest: string;
  readonly scopeDigest: string;
  readonly policyRevision?: string;
  readonly catalogRevision: string;
  /** Source consistency pin. This may be older than the current source revision for a fixed cohort. */
  readonly sourceRevision: string;
  readonly lineage: readonly ResultRef[];
  readonly complete: true;
}

export interface CohortResolverContext {
  /** Fresh application context used for host authorization; it is never read from the wire query. */
  readonly readContext: ReadContext;
  readonly principalKey: string;
  readonly scopeDigest: string;
  readonly policyRevision?: string;
  readonly catalogRevision: string;
  readonly functionRegistryDigest: string;
  readonly catalog: Catalog;
  readonly grants: readonly string[];
  readonly resultStore: ResultStore;
  /** Resolves only host-owned live capability objects, never arbitrary wire references. */
  readonly resolveResult: (ref: ResultRef) => ResultHandle | undefined;
  readonly now: () => number;
}

export interface CohortResolver {
  resolve(request: CohortRequest, context: CohortResolverContext): Promise<Outcome<CohortMembership>>;
}

export interface EvaluationContextRequest {
  readonly signal: AbortSignal;
  readonly task: Task;
}

/**
 * Host-owned authority and data-service wiring returned by readContext. The evaluator
 * does not accept principal, scope or policy values from Task input.
 */
export interface TrustedEvaluationContext {
  readonly principalKey: string;
  readonly scopeDigest: string;
  readonly policyRevision?: string;
  readonly catalogRevision: string;
  readonly functionRegistryDigest: string;
  readonly grants: readonly string[];
  readonly catalog: Catalog;
  readonly data: DataService;
  readonly resultStore: ResultStore;
  readonly readContext: ReadContext;
  readonly cohortResolver?: CohortResolver;
  readonly resolveResult: (ref: ResultRef) => ResultHandle | undefined;
  readonly now: () => number;
  readonly budget?: QueryBudget;
}

export interface EvaluationHost {
  readonly readContext: (
    input: EvaluationContextRequest,
  ) => Outcome<TrustedEvaluationContext> | Promise<Outcome<TrustedEvaluationContext>>;
}

export interface TaskEvaluatorOptions {
  readonly host: EvaluationHost;
  readonly cohortResolver?: CohortResolver;
  readonly maxMilliseconds?: number;
  readonly budget?: QueryBudget;
}

export interface TaskEvaluationInput {
  readonly task: Task;
  readonly requestedOutputs?: readonly string[];
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}

export interface MaterializedTaskOutput {
  readonly outputId: string;
  readonly kind: 'query' | 'reuse';
  readonly ref: ResultRef;
  readonly descriptor?: Result;
  readonly handle: ResultHandle;
  readonly accepted?: AcceptedQuery;
  readonly lineage: readonly ResultRef[];
}

export interface TaskEvaluation {
  readonly task: Task;
  readonly outputs: readonly MaterializedTaskOutput[];
  readonly get: (outputId: string) => MaterializedTaskOutput | undefined;
  /** Releases temporary evaluation leases. ResultHandle ownership remains host controlled. */
  readonly release: () => void;
}

export type EvaluationFailure = Diagnostic & { readonly code: string };
export type EvaluationOutcome<T> = Outcome<T>;
