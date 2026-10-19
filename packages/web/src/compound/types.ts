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
  VarendoDataColumn,
  VarendoDataRecord,
  VarendoDataScope,
  VarendoDataStatus,
  VarendoFieldOption,
  VarendoFilterPredicate,
} from '../data/types.js';

export type VarendoCompoundStatus = VarendoDataStatus;

/** A result identity is always paired with its trusted semantic entity and scope. */
export interface VarendoCompoundResult {
  readonly result: ResultRef;
  readonly entity: string;
  readonly scope?: VarendoDataScope;
}

export interface VarendoCompoundIdentity extends VarendoCompoundResult {
  readonly key: string;
}

export interface VarendoCompoundAction {
  readonly id: string;
  readonly action: VersionRef;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface VarendoCompoundRecipeOptions {
  readonly id: string;
  readonly revision: string;
  readonly preconditions: CommitPreconditions;
}

export interface VarendoCompoundRecipeInput extends VarendoCompoundRecipeOptions {
  /** Host-configured shared primitive nodes. The macro never invents bindings. */
  readonly parts: PresentationPlan['nodes'];
  readonly links?: PresentationPlan['links'];
  /** Exact task need IDs and operation refs; omission cannot satisfy a required need. */
  readonly coverage?: PresentationPlan['coverage'];
  readonly stateTransfer?: PresentationPlan['stateTransfer'];
  readonly validation: { readonly context: PresentationContext; readonly registry: PresentationRegistry };
}

export type VarendoExplorerRecipeInput = VarendoCompoundRecipeInput;
export interface VarendoComparisonMetric {
  readonly id: string;
  readonly label: string;
  readonly unit?: string;
  readonly values: Readonly<Record<string, Scalar | undefined>>;
}
export type VarendoComparisonRecipeInput = VarendoCompoundRecipeInput;
export interface VarendoBreakdownGroup {
  readonly key: string;
  readonly label: string;
  /** A value evaluated by the host's canonical meaning/query layer. */
  readonly value?: Scalar;
  /** Optional host-formatted value. The compound never derives this text. */
  readonly displayValue?: string;
  readonly unit?: string;
  readonly recordCount?: number;
}
export type VarendoBreakdownRecipeInput = VarendoCompoundRecipeInput;
export type VarendoInvestigationRecipeInput = VarendoCompoundRecipeInput;
export type VarendoSearchResultsRecipeInput = VarendoCompoundRecipeInput;
export type VarendoRecordEditorRecipeInput = VarendoCompoundRecipeInput;
export type VarendoFormFlowRecipeInput = VarendoCompoundRecipeInput;
export type VarendoQualityPanelRecipeInput = VarendoCompoundRecipeInput;

export interface VarendoCompoundRecipe {
  readonly plan: PresentationPlan;
  readonly childIds: readonly string[];
}

export interface VarendoExplorerProps {
  readonly fields: readonly VarendoFieldOption[];
  readonly predicate?: VarendoFilterPredicate;
  readonly rows: readonly VarendoDataRecord[];
  readonly columns: readonly VarendoDataColumn[];
  readonly identity: readonly string[];
  readonly entity: string;
  readonly selectedKey?: string;
  readonly detailRecord?: VarendoDataRecord;
  readonly detailFields?: readonly VarendoDataColumn[];
  readonly result?: ResultRef;
  readonly scope?: VarendoDataScope;
  readonly status: VarendoCompoundStatus;
}

export interface VarendoSearchResultState {
  readonly query: string;
  readonly queryRevision: string;
  readonly resultRevision?: string;
  readonly result?: ResultRef;
  readonly scope?: VarendoDataScope;
}

export interface VarendoQualityState {
  readonly source?: string;
  readonly freshness?: string;
  readonly completeness?: string;
  readonly provenance?: readonly string[];
  readonly unsupportedClaims?: readonly string[];
}

export interface VarendoComparisonSetDetail {
  readonly source: 'user';
  readonly entity: string;
  readonly keys: readonly string[];
  readonly result?: ResultRef;
  readonly scope?: VarendoDataScope;
}
export interface VarendoBreakdownGroupDetail {
  readonly source: 'user';
  readonly entity: string;
  readonly key: string;
  readonly result?: ResultRef;
  readonly scope?: VarendoDataScope;
}

export interface VarendoRecordEditorSaveDetail {
  readonly source: 'user';
  readonly entity: string;
  readonly key: string;
  readonly entityRevision: string;
  /** Draft values captured at the explicit save boundary. */
  readonly values: Readonly<Record<string, string | readonly string[]>>;
  readonly action?: VersionRef;
}
export interface VarendoRecordEditorCancelDetail {
  readonly source: 'user';
  readonly entity: string;
  readonly key: string;
  readonly entityRevision: string;
  readonly values: Readonly<Record<string, string | readonly string[]>>;
}

/** Values captured from a form boundary, retaining repeated wire values. */
export type VarendoFormDraftValue = Scalar | readonly Scalar[];

export interface VarendoFormFlowStep {
  readonly id: string;
  readonly label: string;
  /** Optional field names used to describe the step's draft boundary. */
  readonly fieldNames?: readonly string[];
}
export interface VarendoFormFlowStepDetail {
  readonly source: 'user';
  readonly from: string;
  readonly to: string;
  readonly direction: 'next' | 'back';
  readonly draft: Readonly<Record<string, VarendoFormDraftValue>>;
}
export interface VarendoFormFlowCommitDetail {
  readonly source: 'user';
  readonly step: string;
  readonly draft: Readonly<Record<string, VarendoFormDraftValue>>;
}

export type VarendoCompoundInteractionLink = InteractionLink;
export type {
  VarendoDataColumn,
  VarendoDataRecord,
  VarendoDataScope,
  VarendoDataStatus,
  VarendoFieldOption,
  VarendoFilterPredicate,
};
