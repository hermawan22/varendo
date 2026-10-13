export type VarendoFilterOperator = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'is-null' | 'not-null' | 'in';

export interface VarendoFilterClause {
  readonly field: string;
  readonly operator: VarendoFilterOperator;
  readonly value?: string;
}
