import type { AeliqoFilterPredicate } from './types.js';
import type { AeliqoFilterClause } from './filter-builder-types.js';

export type AeliqoFilterLogical = 'and' | 'or';

export interface PredicateTraversal {
  nodes: number;
}

export interface PredicateProjection {
  readonly clauses: readonly AeliqoFilterClause[];
  readonly logical: AeliqoFilterLogical;
  readonly unsupported?: AeliqoFilterPredicate;
}
