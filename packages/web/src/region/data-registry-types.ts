import type { Outcome, Result, VersionRef } from '@varendo/core';
import type { InteractionPort } from '@varendo/core/interaction';
import type {
  VarendoDataColumn,
  VarendoDataRecord,
  VarendoDataScope,
  VarendoDeltaMode,
  VarendoSelectionMode,
} from '../data/index.js';

/** The nine data views share one trusted semantic registry. */
export const VARENDO_DATA_REFS = Object.freeze({
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

export type VarendoDataComponentId = keyof typeof VARENDO_DATA_REFS;

export const VARENDO_DATA_CONFIG_SCHEMAS = Object.freeze({
  metric: { id: 'data.metric.config', revision: '1' },
  delta: { id: 'data.delta.config', revision: '1' },
  keyValue: { id: 'data.key-value.config', revision: '1' },
  detail: { id: 'data.detail.config', revision: '1' },
  recordList: { id: 'data.record-list.config', revision: '1' },
  cardCollection: { id: 'data.card-collection.config', revision: '1' },
  table: { id: 'data.table.config', revision: '1' },
  filterBuilder: { id: 'control.filter-builder.config', revision: '1' },
  selectionSummary: { id: 'data.selection-summary.config', revision: '1' },
} satisfies Record<VarendoDataComponentId, VersionRef>);

/**
 * A region host supplies this object after it has authorized a Result and
 * materialized exactly `result.counts.loaded` rows for that ResultRef. The
 * registry never fetches, aggregates, or discovers another source.
 */
export interface VarendoDataBinding {
  readonly result: Result;
  readonly rows: readonly VarendoDataRecord[];
  readonly columns?: readonly VarendoDataColumn[];
  /** Optional host-owned display scope. Numeric members are checked against the descriptor. */
  readonly scope?: VarendoDataScope;
}

export interface VarendoDataRegistryOptions {
  /** Trusted application binding for the entity represented by this Result. */
  readonly resolveEntity?: (result: Result) => string | undefined;
  readonly maxRows?: number;
}

export interface VarendoDataNodeInput {
  readonly id: string;
  /** Either the public data component ID (`metric`) or its versioned representation ref. */
  readonly component: VarendoDataComponentId | VersionRef;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface VarendoDataResolvedConfig {
  readonly values: Readonly<Record<string, unknown>>;
  readonly fields: readonly string[];
  /** Ports are derived by reviewed code. They are never accepted from config. */
  readonly ports: readonly InteractionPort[];
  readonly identity: readonly string[];
  readonly columns: readonly VarendoDataColumn[];
  readonly selection: VarendoSelectionMode;
  readonly selectedRow?: VarendoDataRecord;
  readonly selectedIndex?: number;
  readonly metricField?: string;
  readonly delta?: {
    readonly currentField: string;
    readonly baselineField: string;
    readonly mode: VarendoDeltaMode;
    readonly currentRow: VarendoDataRecord;
    readonly baselineRow: VarendoDataRecord;
  };
  readonly detailRow?: VarendoDataRecord;
}

export interface VarendoDataResolvedNode {
  readonly id: string;
  readonly component: VarendoDataComponentId;
  readonly ref: VersionRef;
  readonly result: Result;
  readonly rows: readonly VarendoDataRecord[];
  readonly columns: readonly VarendoDataColumn[];
  readonly scope: VarendoDataScope;
  readonly config: VarendoDataResolvedConfig;
}

export interface VarendoDataManifest {
  readonly ref: VersionRef;
  readonly configSchema: VersionRef;
  readonly result: 'required';
  readonly resolveConfig: (
    values: Readonly<Record<string, unknown>>,
    binding: VarendoValidatedBinding,
    options: VarendoDataRegistryOptions,
  ) => Outcome<VarendoDataResolvedConfig>;
}

export interface VarendoDataRegistry {
  readonly manifests: readonly VarendoDataManifest[];
  readonly resolve: (input: VarendoDataNodeInput, binding: VarendoDataBinding) => Outcome<VarendoDataResolvedNode>;
}

export interface VarendoValidatedBinding extends VarendoDataBinding {
  readonly result: Result;
  readonly rows: readonly VarendoDataRecord[];
  readonly columns: readonly VarendoDataColumn[];
  readonly scope: VarendoDataScope;
}
