import type {
  Catalog,
  Diagnostic,
  Expression,
  FieldDefinition,
  MeaningDefinition,
  Outcome,
  QuerySpec,
  SemanticType,
  VersionRef,
} from '../contracts/types.js';
import type { FunctionRegistry } from '../expressions/types.js';

/** Values which may cross the bounded in-memory query evaluator boundary. */
export type QueryValue = null | boolean | number | string | { readonly decimal: string };
export type QueryRow = Readonly<Record<string, QueryValue>>;

export interface QueryLimits {
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxRows: number;
  readonly maxBytes: number;
  readonly maxJoinRows: number;
  readonly maxOperations: number;
}

export interface QueryPins {
  readonly catalogRevision: string;
  readonly functionRegistryDigest: string;
  readonly sourceRevision?: string;
  readonly scopeDigest?: string;
  readonly policyRevision?: string;
}

export interface QuerySourceRelation {
  readonly entity: string;
  readonly rows: readonly QueryRow[];
  /** Exact aggregate/order claims require a complete source population. */
  readonly complete: boolean;
}

export interface QuerySource {
  readonly revision: string;
  readonly catalogRevision?: string;
  readonly scopeDigest?: string;
  readonly policyRevision?: string;
  readonly relations: Readonly<Record<string, QuerySourceRelation>>;
}

export interface QueryExecutionContext {
  /** Host-owned cancellation view; core does not depend on DOM AbortSignal. */
  readonly cancellation?: { readonly aborted: boolean };
  /** An injected monotonic clock. The evaluator never reads a global clock. */
  readonly clock?: () => number;
  readonly maxMilliseconds?: number;
  readonly maxRows?: number;
  readonly maxBytes?: number;
  readonly maxOperations?: number;
  readonly catalogRevision?: string;
  readonly scopeDigest?: string;
  readonly policyRevision?: string;
}

export interface QueryField {
  readonly id: string;
  readonly label: string;
  readonly type: SemanticType;
  readonly role: FieldDefinition['role'];
  readonly source?: { readonly entity: string; readonly field: string };
}

export interface QuerySchema {
  readonly fields: readonly QueryField[];
  readonly identity: readonly string[];
  readonly grain: readonly string[];
}

export interface ProjectionSpec {
  readonly id: string;
  readonly expression: Expression;
  readonly label?: string;
  readonly role?: FieldDefinition['role'];
}

export interface DeriveSpec extends ProjectionSpec {}

export interface GroupKeySpec {
  readonly id: string;
  readonly expression: Expression;
  readonly label?: string;
}

/**
 * Validated semantic binding emitted for a QuerySpec meaning.
 *
 * This is part of the canonical logical-plan data, rather than hidden
 * evaluator metadata. Plan validation re-resolves the meaning and checks
 * every binding member before execution.
 */
export interface AggregateSemanticBinding {
  readonly meaning: VersionRef;
  readonly aggregation: MeaningDefinition['aggregation'];
  /** Declared dimensions that must be represented by the trusted group keys. */
  readonly aggregationDimensions: readonly string[];
  readonly missingPolicy: MeaningDefinition['missingPolicy'];
  readonly output: SemanticType;
  readonly timeExpression?: Expression;
}

export interface AggregateSpec {
  readonly id: string;
  readonly function: VersionRef;
  readonly arguments: readonly Expression[];
  readonly label?: string;
  readonly semantics?: AggregateSemanticBinding;
}

export type PredicateSpec =
  | {
      readonly op: 'compare';
      readonly left: Expression;
      readonly comparison: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
      readonly right: Expression;
    }
  | { readonly op: 'is-null'; readonly expression: Expression; readonly negate: boolean }
  | { readonly op: 'in'; readonly expression: Expression; readonly values: readonly Expression[] }
  | { readonly op: 'and' | 'or'; readonly predicates: readonly PredicateSpec[] }
  | { readonly op: 'not'; readonly predicate: PredicateSpec };

export interface JoinSpec {
  readonly id: string;
  readonly rightEntity: string;
  readonly relationship: VersionRef;
  readonly kind: 'inner' | 'left';
  readonly where?: PredicateSpec;
}

export interface SemiJoinSpec {
  readonly id: string;
  readonly rightEntity: string;
  readonly relationship: VersionRef;
  readonly where?: PredicateSpec;
}

export type TimeGrain = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface TimeBucketSpec {
  readonly id: string;
  readonly expression: Expression;
  readonly grain: TimeGrain;
  readonly calendar: 'gregorian' | 'iso8601';
  /** Civil dates retain their declared timezone without instant conversion. Instant buckets currently require UTC. */
  readonly timezone: string;
  readonly weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  readonly label?: string;
}

export interface WindowSpec {
  readonly id: string;
  readonly function: VersionRef;
  readonly arguments: readonly Expression[];
  readonly partitionBy: readonly Expression[];
  readonly orderBy: readonly SortSpec[];
  readonly frame: { readonly preceding: number; readonly following: number };
  readonly label?: string;
}

export interface SortSpec {
  readonly expression: Expression;
  readonly direction: 'asc' | 'desc';
  readonly nulls: 'first' | 'last';
}

/** Internal typed query input. It is intentionally separate from the ADC wire envelope. */
export interface RelationalQuery {
  readonly root: string;
  readonly select: readonly ProjectionSpec[];
  readonly filter?: PredicateSpec;
  readonly semiJoins?: readonly SemiJoinSpec[];
  readonly joins?: readonly JoinSpec[];
  readonly derives?: readonly DeriveSpec[];
  readonly timeBuckets?: readonly TimeBucketSpec[];
  readonly windows?: readonly WindowSpec[];
  readonly groupBy?: readonly GroupKeySpec[];
  readonly aggregates?: readonly AggregateSpec[];
  readonly orderBy?: readonly SortSpec[];
  readonly topK?: number;
  readonly pins: QueryPins;
}

export type QueryInput = RelationalQuery | QuerySpec;

export interface QueryCost {
  readonly estimatedRows: number;
  readonly estimatedBytes: number;
  readonly nodes: number;
  readonly joinRows: number;
  readonly requiresComplete: boolean;
  readonly operations: number;
}

export interface PlanExplanation {
  readonly nodeId: string;
  readonly operation: PlanOperation;
  readonly inputIds: readonly string[];
  readonly detail: string;
  readonly estimatedRows: number;
  readonly estimatedBytes: number;
}

export type PlanOperation =
  | 'scan'
  | 'filter'
  | 'project'
  | 'derive'
  | 'time-bucket'
  | 'window'
  | 'join'
  | 'semijoin'
  | 'group'
  | 'aggregate'
  | 'sort'
  | 'top-k';

interface PlanNodeBase {
  readonly id: string;
  readonly op: PlanOperation;
  readonly inputs: readonly string[];
  readonly output: QuerySchema;
  readonly cost: QueryCost;
}

export type PlanNode =
  | (PlanNodeBase & { readonly op: 'scan'; readonly entity: string })
  | (PlanNodeBase & { readonly op: 'filter'; readonly predicate: PredicateSpec })
  | (PlanNodeBase & { readonly op: 'project'; readonly items: readonly ProjectionSpec[] })
  | (PlanNodeBase & { readonly op: 'derive'; readonly items: readonly DeriveSpec[] })
  | (PlanNodeBase & { readonly op: 'time-bucket'; readonly items: readonly TimeBucketSpec[] })
  | (PlanNodeBase & { readonly op: 'window'; readonly items: readonly WindowSpec[] })
  | (PlanNodeBase & {
      readonly op: 'join';
      readonly spec: JoinSpec;
      readonly keys: readonly { readonly left: string; readonly right: string }[];
    })
  | (PlanNodeBase & {
      readonly op: 'semijoin';
      readonly spec: SemiJoinSpec;
      readonly keys: readonly { readonly left: string; readonly right: string }[];
    })
  | (PlanNodeBase & { readonly op: 'group'; readonly keys: readonly GroupKeySpec[] })
  | (PlanNodeBase & { readonly op: 'aggregate'; readonly items: readonly AggregateSpec[] })
  | (PlanNodeBase & { readonly op: 'sort'; readonly items: readonly SortSpec[] })
  | (PlanNodeBase & { readonly op: 'top-k'; readonly limit: number });

export interface LogicalPlan {
  readonly version: '1';
  readonly pins: QueryPins;
  readonly root: string;
  readonly nodes: readonly PlanNode[];
  readonly output: QuerySchema;
  readonly cost: QueryCost;
  readonly canonical: string;
  /** Stable process-independent key; it is a canonical identity, not a bearer token. */
  readonly planKey: string;
  readonly explain: readonly PlanExplanation[];
}

export interface QueryResult {
  readonly schema: QuerySchema;
  readonly rows: readonly QueryRow[];
  readonly sourceRevision: string;
  readonly complete: boolean;
  readonly precision: { readonly kind: 'exact' } | { readonly kind: 'approximate'; readonly method: string };
  readonly unknown: readonly { readonly field: string; readonly reason: string }[];
  readonly estimatedBytes: number;
}

export interface QueryPlannerOptions {
  readonly catalog: Catalog;
  readonly registry: FunctionRegistry;
  readonly definitions?: readonly MeaningDefinition[];
  readonly limits?: Partial<QueryLimits>;
}

export interface QueryPlanner {
  readonly catalog: Catalog;
  readonly registry: FunctionRegistry;
  readonly limits: QueryLimits;
  plan(input: QueryInput): Outcome<LogicalPlan>;
  evaluate(plan: LogicalPlan, source: QuerySource, context?: QueryExecutionContext): Outcome<QueryResult>;
}

export interface QueryFailure extends Diagnostic {
  readonly code: `query.${string}`;
}

export type QueryOutcome<T> = Outcome<T>;

export type { Catalog, Diagnostic, Expression, MeaningDefinition, Outcome, QuerySpec, SemanticType, VersionRef };
