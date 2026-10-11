import type { Task } from '@varendo/core';
import type { RegionHistoryEntry, RegionReadSet, RegionSnapshot } from '../regions/types.js';

/** Versioned metadata document. Presentation plans and result rows are intentionally omitted. */
export interface RegionDocument {
  readonly version: '1';
  readonly id: string;
  readonly task: Task;
  readonly taskRevision: string;
  readonly regionRevision: string;
  readonly dataRevision: number;
  readonly readSet: RegionReadSet;
  readonly stateDigest: string;
  readonly history: readonly RegionHistoryEntry[];
}

export type RegionDocumentInput = RegionDocument | string;

export interface RegionPersistence {
  export(snapshot: RegionSnapshot, history?: readonly RegionHistoryEntry[]): RegionDocument;
  serialize(snapshot: RegionSnapshot, history?: readonly RegionHistoryEntry[]): string;
  parse(input: RegionDocumentInput): import('../regions/types.js').RegionOutcome<RegionDocument>;
}
