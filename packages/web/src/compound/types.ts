import type {
  CommitPreconditions,
  InteractionLink,
  PresentationPlan,
  ResultRef,
  Scalar,
  VersionRef,
} from '@varendo/core';
import type { PresentationContext, PresentationRegistry } from '@varendo/core/presentation';
import type {
  AeliqoDataColumn,
  AeliqoDataRecord,
  AeliqoDataScope,
  AeliqoDataStatus,
  AeliqoFieldOption,
  AeliqoFilterPredicate,
} from '../data/types.js';

export type AeliqoCompoundStatus = AeliqoDataStatus;

/** A result identity is always paired with its trusted semantic entity and scope. */
export interface AeliqoCompoundResult {
  readonly result: ResultRef;
  readonly entity: string;
  readonly scope?: AeliqoDataScope;
}

export interface AeliqoCompoundIdentity extends AeliqoCompoundResult {
  readonly key: string;
}

export interface AeliqoCompoundAction {
  readonly id: string;
  readonly action: VersionRef;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface AeliqoCompoundRecipeOptions {
  readonly id: string;
  readonly revision: string;
  readonly preconditions: CommitPreconditions;
}

export interface AeliqoCompoundRecipeInput extends AeliqoCompoundRecipeOptions {
  /** Host-configured shared primitive nodes. The macro never invents bindings. */
  readonly parts: PresentationPlan['nodes'];
  readonly links?: PresentationPlan['links'];
  /** Exact task need IDs and operation refs; omission cannot satisfy a required need. */
  readonly coverage?: PresentationPlan['coverage'];
  readonly stateTransfer?: PresentationPlan['stateTransfer'];
  readonly validation: { readonly context: PresentationContext; readonly registry: PresentationRegistry };
}

export type AeliqoExplorerRecipeInput = AeliqoCompoundRecipeInput;
export interface AeliqoComparisonMetric {
  readonly id: string;
  readonly label: string;
  readonly unit?: string;
  readonly values: Readonly<Record<string, Scalar | undefined>>;
}
export type AeliqoComparisonRecipeInput = AeliqoCompoundRecipeInput;
export interface AeliqoBreakdownGroup {
  readonly key: string;
  readonly label: string;
  /** A value evaluated by the host's canonical meaning/query layer. */
  readonly value?: Scalar;
  /** Optional host-formatted value. The compound never derives this text. */
  readonly displayValue?: string;
  readonly unit?: string;
  readonly recordCount?: number;
}
export type AeliqoBreakdownRecipeInput = AeliqoCompoundRecipeInput;
export type AeliqoInvestigationRecipeInput = AeliqoCompoundRecipeInput;
export type AeliqoSearchResultsRecipeInput = AeliqoCompoundRecipeInput;
export type AeliqoRecordEditorRecipeInput = AeliqoCompoundRecipeInput;
export type AeliqoFormFlowRecipeInput = AeliqoCompoundRecipeInput;
export type AeliqoQualityPanelRecipeInput = AeliqoCompoundRecipeInput;

export interface AeliqoCompoundRecipe {
  readonly plan: PresentationPlan;
  readonly childIds: readonly string[];
}

export interface AeliqoExplorerProps {
  readonly fields: readonly AeliqoFieldOption[];
  readonly predicate?: AeliqoFilterPredicate;
  readonly rows: readonly AeliqoDataRecord[];
  readonly columns: readonly AeliqoDataColumn[];
  readonly identity: readonly string[];
  readonly entity: string;
  readonly selectedKey?: string;
  readonly detailRecord?: AeliqoDataRecord;
  readonly detailFields?: readonly AeliqoDataColumn[];
  readonly result?: ResultRef;
  readonly scope?: AeliqoDataScope;
  readonly status: AeliqoCompoundStatus;
}

export interface AeliqoSearchResultState {
  readonly query: string;
  readonly queryRevision: string;
  readonly resultRevision?: string;
  readonly result?: ResultRef;
  readonly scope?: AeliqoDataScope;
}

export interface AeliqoQualityState {
  readonly source?: string;
  readonly freshness?: string;
  readonly completeness?: string;
  readonly provenance?: readonly string[];
  readonly unsupportedClaims?: readonly string[];
}

export interface AeliqoComparisonSetDetail {
  readonly source: 'user';
  readonly entity: string;
  readonly keys: readonly string[];
  readonly result?: ResultRef;
  readonly scope?: AeliqoDataScope;
}
export interface AeliqoBreakdownGroupDetail {
  readonly source: 'user';
  readonly entity: string;
  readonly key: string;
  readonly result?: ResultRef;
  readonly scope?: AeliqoDataScope;
}

export interface AeliqoRecordEditorSaveDetail {
  readonly source: 'user';
  readonly entity: string;
  readonly key: string;
  readonly entityRevision: string;
  /** Draft values captured at the explicit save boundary. */
  readonly values: Readonly<Record<string, string | readonly string[]>>;
  readonly action?: VersionRef;
}
export interface AeliqoRecordEditorCancelDetail {
  readonly source: 'user';
  readonly entity: string;
  readonly key: string;
  readonly entityRevision: string;
  readonly values: Readonly<Record<string, string | readonly string[]>>;
}

/** Values captured from a form boundary, retaining repeated wire values. */
export type AeliqoFormDraftValue = Scalar | readonly Scalar[];

export interface AeliqoFormFlowStep {
  readonly id: string;
  readonly label: string;
  /** Optional field names used to describe the step's draft boundary. */
  readonly fieldNames?: readonly string[];
}
export interface AeliqoFormFlowStepDetail {
  readonly source: 'user';
  readonly from: string;
  readonly to: string;
  readonly direction: 'next' | 'back';
  readonly draft: Readonly<Record<string, AeliqoFormDraftValue>>;
}
export interface AeliqoFormFlowCommitDetail {
  readonly source: 'user';
  readonly step: string;
  readonly draft: Readonly<Record<string, AeliqoFormDraftValue>>;
}

export type AeliqoCompoundInteractionLink = InteractionLink;
export type {
  AeliqoDataColumn,
  AeliqoDataRecord,
  AeliqoDataScope,
  AeliqoDataStatus,
  AeliqoFieldOption,
  AeliqoFilterPredicate,
};
