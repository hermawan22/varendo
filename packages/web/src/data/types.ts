import type { ResultRef, Scalar, SemanticType } from '@varendo/core';
export type { ResultRef } from '@varendo/core';

/** Values accepted by the shared data views. Decimal values remain strings so
 * a browser render never rounds an authoritative value through IEEE-754. */
export type AeliqoDataValue = Scalar;

export type AeliqoDataStatus = 'ready' | 'loading' | 'empty' | 'partial' | 'stale' | 'error' | 'unavailable';

export interface AeliqoDataScope {
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

export interface AeliqoDataState<T> {
  readonly status: AeliqoDataStatus;
  readonly value?: T;
  readonly message?: string;
  readonly scope?: AeliqoDataScope;
  readonly result?: ResultRef;
}

export interface AeliqoIdentityRef {
  readonly entity?: string;
  readonly key: string;
  readonly fields?: readonly string[];
}

export interface AeliqoFieldOption {
  readonly id: string;
  readonly label: string;
  readonly type?: 'text' | 'boolean' | 'integer' | 'float' | 'decimal' | 'date' | 'instant';
  readonly nullable?: boolean;
  /** Full core metadata when the host has it; `type`/`nullable` remain a small convenience form. */
  readonly semanticType?: SemanticType;
}

export interface AeliqoDataColumn {
  readonly key: string;
  readonly label: string;
  readonly type?: AeliqoFieldOption['type'];
  readonly sortable?: boolean;
  readonly align?: 'start' | 'center' | 'end';
}

export type AeliqoDataRecord = Readonly<Record<string, AeliqoDataValue | undefined>>;

export type AeliqoSelectionMode = 'none' | 'single' | 'multiple';

export interface AeliqoSelectionDetail {
  readonly mode: 'clear' | 'ids';
  readonly entity?: string;
  readonly keys: readonly string[];
  readonly result?: ResultRef;
  readonly scope?: AeliqoDataScope;
}

export type AeliqoFilterValue = AeliqoDataValue;

export type AeliqoFilterPredicate =
  | {
      readonly op: 'compare';
      readonly field: string;
      readonly entity?: string;
      readonly comparison: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
      readonly value: AeliqoFilterValue;
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
      readonly values: readonly AeliqoFilterValue[];
    }
  | { readonly op: 'and' | 'or'; readonly predicates: readonly AeliqoFilterPredicate[] }
  | { readonly op: 'not'; readonly predicate: AeliqoFilterPredicate };

export interface AeliqoFilterChangeDetail {
  readonly predicate?: AeliqoFilterPredicate;
  readonly inherited?: AeliqoFilterPredicate;
  readonly scopeLabel?: string;
  readonly applied: true;
}

export interface AeliqoSortState {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
}

export interface AeliqoPageRequest {
  readonly page: number;
  readonly pageSize: number;
  readonly result?: ResultRef;
}

export interface AeliqoTableSortDetail {
  readonly sort?: AeliqoSortState | undefined;
}

export interface AeliqoTablePageDetail extends AeliqoPageRequest {}

/** A host-controlled request to make a virtualized row window available. */
export interface AeliqoTableWindowDetail {
  readonly start: number;
  readonly count: number;
  readonly overscan: number;
  readonly row: number;
  readonly column: number;
  readonly reason: 'keyboard';
  readonly result?: ResultRef;
}

export interface AeliqoDeltaResult {
  readonly status: 'ready' | 'unavailable';
  readonly value?: number | string;
  readonly display?: string;
  readonly reason?: 'missing-current' | 'missing-baseline' | 'incompatible' | 'zero-denominator' | 'invalid';
}
