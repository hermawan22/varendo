import type { Outcome, Result, VersionRef } from '@varendo/core';
import type { InteractionPort } from '@varendo/core/interaction';
import type {
  AeliqoDataColumn,
  AeliqoDataRecord,
  AeliqoDataScope,
  AeliqoDeltaMode,
  AeliqoSelectionMode,
} from '../data/index.js';

/** The nine data views share one trusted semantic registry. */
export const AELIQO_DATA_REFS = Object.freeze({
  metric: { id: 'data.metric', revision: '1' },
  delta: { id: 'data.delta', revision: '1' },
  keyValue: { id: 'data.key-value', revision: '1' },
  detail: { id: 'data.detail', revision: '1' },
  recordList: { id: 'data.record-list', revision: '1' },
  cardCollection: { id: 'data.card-collection', revision: '1' },
  table: { id: 'data.table', revision: '1' },
  filterBuilder: { id: 'control.filter-builder', revision: '1' },
  selectionSummary: { id: 'data.selection-summary', revision: '1' },
} satisfies Record<string, VersionRef>);

export type AeliqoDataComponentId = keyof typeof AELIQO_DATA_REFS;

export const AELIQO_DATA_CONFIG_SCHEMAS = Object.freeze({
  metric: { id: 'data.metric.config', revision: '1' },
  delta: { id: 'data.delta.config', revision: '1' },
  keyValue: { id: 'data.key-value.config', revision: '1' },
  detail: { id: 'data.detail.config', revision: '1' },
  recordList: { id: 'data.record-list.config', revision: '1' },
  cardCollection: { id: 'data.card-collection.config', revision: '1' },
  table: { id: 'data.table.config', revision: '1' },
  filterBuilder: { id: 'control.filter-builder.config', revision: '1' },
  selectionSummary: { id: 'data.selection-summary.config', revision: '1' },
} satisfies Record<AeliqoDataComponentId, VersionRef>);

/**
 * A region host supplies this object after it has authorized a Result and
 * materialized exactly `result.counts.loaded` rows for that ResultRef. The
 * registry never fetches, aggregates, or discovers another source.
 */
export interface AeliqoDataBinding {
  readonly result: Result;
  readonly rows: readonly AeliqoDataRecord[];
  readonly columns?: readonly AeliqoDataColumn[];
  /** Optional host-owned display scope. Numeric members are checked against the descriptor. */
  readonly scope?: AeliqoDataScope;
}

export interface AeliqoDataRegistryOptions {
  /** Trusted application binding for the entity represented by this Result. */
  readonly resolveEntity?: (result: Result) => string | undefined;
  readonly maxRows?: number;
}

export interface AeliqoDataNodeInput {
  readonly id: string;
  /** Either the public data component ID (`metric`) or its versioned representation ref. */
  readonly component: AeliqoDataComponentId | VersionRef;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface AeliqoDataResolvedConfig {
  readonly values: Readonly<Record<string, unknown>>;
  readonly fields: readonly string[];
  /** Ports are derived by reviewed code. They are never accepted from config. */
  readonly ports: readonly InteractionPort[];
  readonly identity: readonly string[];
  readonly columns: readonly AeliqoDataColumn[];
  readonly selection: AeliqoSelectionMode;
  readonly selectedRow?: AeliqoDataRecord;
  readonly selectedIndex?: number;
  readonly metricField?: string;
  readonly delta?: {
    readonly currentField: string;
    readonly baselineField: string;
    readonly mode: AeliqoDeltaMode;
    readonly currentRow: AeliqoDataRecord;
    readonly baselineRow: AeliqoDataRecord;
  };
  readonly detailRow?: AeliqoDataRecord;
}

export interface AeliqoDataResolvedNode {
  readonly id: string;
  readonly component: AeliqoDataComponentId;
  readonly ref: VersionRef;
  readonly result: Result;
  readonly rows: readonly AeliqoDataRecord[];
  readonly columns: readonly AeliqoDataColumn[];
  readonly scope: AeliqoDataScope;
  readonly config: AeliqoDataResolvedConfig;
}

export interface AeliqoDataManifest {
  readonly ref: VersionRef;
  readonly configSchema: VersionRef;
  readonly result: 'required';
  readonly resolveConfig: (
    values: Readonly<Record<string, unknown>>,
    binding: AeliqoValidatedBinding,
    options: AeliqoDataRegistryOptions,
  ) => Outcome<AeliqoDataResolvedConfig>;
}

export interface AeliqoDataRegistry {
  readonly manifests: readonly AeliqoDataManifest[];
  readonly resolve: (input: AeliqoDataNodeInput, binding: AeliqoDataBinding) => Outcome<AeliqoDataResolvedNode>;
}

export interface AeliqoValidatedBinding extends AeliqoDataBinding {
  readonly result: Result;
  readonly rows: readonly AeliqoDataRecord[];
  readonly columns: readonly AeliqoDataColumn[];
  readonly scope: AeliqoDataScope;
}
