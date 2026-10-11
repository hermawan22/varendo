import type { Outcome, ResultRef } from '@varendo/core';
import type { NarrativeClaim, OperationGrant } from '@varendo/core/agent';
import type { ResultHandle } from '@varendo/runtime/results';

/** Fresh host authority. A model may never supply this context or its resolver. */
export interface NarrativeAuthority {
  readonly principalKey: string;
  readonly scopeDigest: string;
  readonly policyRevision?: string;
  readonly catalogRevision: string;
  readonly functionRegistryDigest: string;
  readonly grants: readonly OperationGrant[];
  /** Only explicitly authorized live handles are exposed by the host. */
  readonly resolveResult: (ref: ResultRef) => ResultHandle | undefined;
}

export interface NarrativeVerifierOptions {
  readonly readContext: () => Outcome<NarrativeAuthority>;
  readonly maxRows?: number;
}

export type NarrativeStructuredClaim = Extract<NarrativeClaim, { kind: 'value' | 'comparison' }>;

export type NarrativeReceipt =
  | {
      readonly state: 'verified';
      readonly claim: NarrativeStructuredClaim;
      readonly evidence: readonly { readonly result: ResultRef; readonly generation: number }[];
    }
  | { readonly state: 'unverified'; readonly reason: 'interpretation' | 'false' | 'null-comparison' };

export interface NarrativeUsedEvidence {
  readonly handle: ResultHandle;
  readonly snapshot: ReturnType<ResultHandle['snapshot']>;
  readonly ref: ResultRef;
}

export interface NarrativeEvidenceTrace {
  readonly maxRows: number;
  readonly used: NarrativeUsedEvidence[];
  scanned: number;
}

export interface NarrativeClaimCheck {
  readonly truth: boolean;
  readonly nullComparison: boolean;
}
