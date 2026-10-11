import type { Outcome } from '@varendo/core';

export type AuditPlanPhase = 'validate' | 'query' | 'present';
export type AuditOperation = 'read' | 'evaluate' | 'present' | 'meaning' | 'action' | 'model-egress';
export type AuditSourceTransport = 'local' | 'http';
export type AuditCache = 'catalog' | 'result' | 'presentation' | 'meaning';
export type AuditRenderer = 'component' | 'plot' | 'compound';
export type AuditResource = 'rows' | 'bytes' | 'nodes' | 'regions' | 'results';
export type CapabilityAuditCode =
  | 'policy.denied'
  | 'renderer.unsupported'
  | 'runtime.invalid'
  | 'runtime.stale'
  | 'runtime.failed'
  | 'action.ambiguous';
export type SourceAuditCode = 'source.denied' | 'source.timeout' | 'source.unavailable' | 'source.invalid';
export type AuditCode = CapabilityAuditCode | SourceAuditCode | 'host.cancelled';

export type LocalAuditEvent =
  | {
      readonly kind: 'plan';
      readonly phase: AuditPlanPhase;
      readonly status: 'completed' | 'rejected' | 'cancelled' | 'failed';
      readonly durationMs: number;
    }
  | ({
      readonly kind: 'capability';
      readonly operation: AuditOperation;
    } & (
      | { readonly status: 'accepted' }
      | { readonly status: 'rejected'; readonly code: CapabilityAuditCode }
      | { readonly status: 'cancelled'; readonly code?: 'host.cancelled' }
    ))
  | {
      readonly kind: 'cancellation';
      readonly operation: AuditOperation;
      readonly code?: 'host.cancelled';
    }
  | {
      readonly kind: 'source';
      readonly transport: AuditSourceTransport;
      readonly status: 'error';
      readonly code: SourceAuditCode;
    }
  | {
      readonly kind: 'cache';
      readonly cache: AuditCache;
      readonly status: 'hit' | 'miss';
    }
  | {
      readonly kind: 'renderer';
      readonly renderer: AuditRenderer;
      readonly status: 'ready' | 'partial' | 'empty' | 'error';
      readonly resourceCount?: number;
    }
  | ({
      readonly kind: 'resource';
      readonly resource: AuditResource;
      readonly count: number;
    } & (
      | { readonly status: 'within-budget'; readonly limit?: number }
      | { readonly status: 'exhausted'; readonly limit: number }
    ));

export type LocalAuditRecord = Readonly<
  LocalAuditEvent & {
    readonly version: '1';
    readonly sequence: number;
    readonly at: number;
  }
>;

export interface LocalAuditExport {
  readonly version: '1';
  readonly records: readonly LocalAuditRecord[];
  /** Events evicted by the configured count or byte budget since the last clear. */
  readonly dropped: number;
  readonly complete: boolean;
  readonly retainedBytes: number;
}

export interface LocalAuditOptions {
  /** Maximum retained records. Oldest records are evicted first. Default 256; maximum 4096. */
  readonly maxEvents?: number;
  /** Maximum UTF-8 bytes retained for canonical record JSON. Default 256 KiB; maximum 4 MiB. */
  readonly maxBytes?: number;
  /** Trusted local clock. The returned value must be a non-negative safe integer. */
  readonly now?: () => number;
}

export type LocalAuditOutcome<T> = Outcome<T>;

export interface LocalAuditExporter {
  record(event: LocalAuditEvent): LocalAuditOutcome<LocalAuditRecord>;
  /** Returns an immutable, JSON-serializable local snapshot. It performs no I/O. */
  exportSnapshot(): LocalAuditOutcome<LocalAuditExport>;
  clear(): boolean;
  dispose(): void;
}
