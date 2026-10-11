import type { AggregateSpec, GroupKeySpec, JoinSpec, ProjectionSpec, SemiJoinSpec, TimeBucketSpec } from '../types.js';

export interface LoweredRelations {
  readonly joins: readonly JoinSpec[];
  readonly semiJoins: readonly SemiJoinSpec[];
}

export interface LoweredTimeBuckets {
  readonly bucketId?: string;
  readonly items: readonly TimeBucketSpec[];
}

export interface LoweredSelection {
  readonly select: readonly ProjectionSpec[];
  readonly groupBy: readonly GroupKeySpec[];
  readonly aggregates: readonly AggregateSpec[];
}
