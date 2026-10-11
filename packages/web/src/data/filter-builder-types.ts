export type AeliqoFilterOperator = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'is-null' | 'not-null' | 'in';

export interface AeliqoFilterClause {
  readonly field: string;
  readonly operator: AeliqoFilterOperator;
  readonly value?: string;
}
