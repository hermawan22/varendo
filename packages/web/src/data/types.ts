import type { ResultRef, Scalar, SemanticType } from '@varendo/core';
export type { ResultRef } from '@varendo/core';

/** Values accepted by the shared data views. Decimal values remain strings so
 * a browser render never rounds an authoritative value through IEEE-754. */
export type VarendoDataValue = Scalar;

export type VarendoDataStatus = 'ready' | 'loading' | 'empty' | 'partial' | 'stale' | 'error' | 'unavailable';

export interface VarendoDataScope {
  /** Number of rows currently materialised in the view. */
  readonly loaded?: number;
  /** Authoritative total for the active filtered population, when known. */
  readonly filteredTotal?: number;
  /** Authoritative total for the complete population, when known. */
  readonly populationTotal?: number;
  /** The result/population identity that makes a count meaningful. */
  readonly populationDigest?: string;
  /** Explicitly says that the view only contains a bounded sample/window. */
  readonly kind?: 'loaded' | 'filtered' | 'population' | 'sample' | 'unknown';
  readonly label?: string;
}

export interface VarendoDataState<T> {
  readonly status: VarendoDataStatus;
  readonly value?: T;
  readonly message?: string;
  readonly scope?: VarendoDataScope;
  readonly result?: ResultRef;
}

export interface VarendoIdentityRef {
  readonly entity?: string;
  readonly key: string;
  readonly fields?: readonly string[];
}

export interface VarendoFieldOption {
  readonly id: string;
  readonly label: string;
  readonly type?: 'text' | 'boolean' | 'integer' | 'float' | 'decimal' | 'date' | 'instant';
  readonly nullable?: boolean;
  /** Full core metadata when the host has it; `type`/`nullable` remain a small convenience form. */
  readonly semanticType?: SemanticType;
}

export interface VarendoDataColumn {
  readonly key: string;
  readonly label: string;
  readonly type?: VarendoFieldOption['type'];
  readonly sortable?: boolean;
  readonly align?: 'start' | 'center' | 'end';
}

export type VarendoDataRecord = Readonly<Record<string, VarendoDataValue | undefined>>;

export type VarendoSelectionMode = 'none' | 'single' | 'multiple';

export interface VarendoSelectionDetail {
  readonly mode: 'clear' | 'ids';
  readonly entity?: string;
  readonly keys: readonly string[];
  readonly result?: ResultRef;
  readonly scope?: VarendoDataScope;
}

export type VarendoFilterValue = VarendoDataValue;

export type VarendoFilterPredicate =
  | {
      readonly op: 'compare';
      readonly field: string;
      readonly entity?: string;
      readonly comparison: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
      readonly value: VarendoFilterValue;
    }
  | {
      readonly op: 'is-null';
      readonly field: string;
      readonly entity?: string;
      readonly negate: boolean;
    }
  | {
      readonly op: 'in';
      readonly field: string;
      readonly entity?: string;
      readonly values: readonly VarendoFilterValue[];
    }
  | { readonly op: 'and' | 'or'; readonly predicates: readonly VarendoFilterPredicate[] }
  | { readonly op: 'not'; readonly predicate: VarendoFilterPredicate };

export interface VarendoFilterChangeDetail {
  readonly predicate?: VarendoFilterPredicate;
  readonly inherited?: VarendoFilterPredicate;
  readonly scopeLabel?: string;
  readonly applied: true;
}

export interface VarendoSortState {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
}

export interface VarendoPageRequest {
  readonly page: number;
  readonly pageSize: number;
  readonly result?: ResultRef;
}

export interface VarendoTableSortDetail {
  readonly sort?: VarendoSortState | undefined;
}

export interface VarendoTablePageDetail extends VarendoPageRequest {}

/** A host-controlled request to make a virtualized row window available. */
export interface VarendoTableWindowDetail {
  readonly start: number;
  readonly count: number;
  readonly overscan: number;
  readonly row: number;
  readonly column: number;
  readonly reason: 'keyboard';
  readonly result?: ResultRef;
}

export interface VarendoDeltaResult {
  readonly status: 'ready' | 'unavailable';
  readonly value?: number | string;
  readonly display?: string;
  readonly reason?: 'missing-current' | 'missing-baseline' | 'incompatible' | 'zero-denominator' | 'invalid';
}
