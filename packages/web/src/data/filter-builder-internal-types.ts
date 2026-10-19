import type { VarendoFilterPredicate } from './types.js';
import type { VarendoFilterClause } from './filter-builder-types.js';

export type VarendoFilterLogical = 'and' | 'or';

export interface PredicateTraversal {
  nodes: number;
}

export interface PredicateProjection {
  readonly clauses: readonly VarendoFilterClause[];
  readonly logical: VarendoFilterLogical;
  readonly unsupported?: VarendoFilterPredicate;
}
