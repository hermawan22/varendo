import type { Catalog, MeaningDefinition, Outcome, VersionRef } from '@varendo/core';
import type { MeaningScope } from '@varendo/core/semantics';
import type {
  MeaningAuthoring,
  MeaningAuthoringOptions,
  MeaningDefinitionInput,
  MeaningDiff,
  MeaningDraft,
  MeaningEvaluator,
  MeaningEvaluatorOptions,
  MeaningRegistry,
} from '@varendo/runtime/meaning';

/** Host policy for AI drafts. It controls proposal scope, never activation. */
export interface MeaningProposalPolicy {
  /** Defaults to private/session scopes, which are suitable for hypotheses. */
  readonly allowedScopes?: readonly MeaningScope[];
  /** Defaults to true: AI cannot label a proposal reviewed or approved. */
  readonly requireHypothesis?: boolean;
  /** Defaults to true: AI proposals remain drafts until host activation. */
  readonly requireDraft?: boolean;
}

export interface AgentMeaningAuthoringOptions<C extends Catalog = Catalog> extends MeaningAuthoringOptions<C> {
  readonly proposalPolicy?: MeaningProposalPolicy;
  readonly evaluator?: MeaningEvaluatorOptions;
}

export interface MeaningProposalInput {
  readonly meaning: MeaningDefinition;
  readonly assumptions?: readonly string[];
  readonly base?: VersionRef;
}

export interface AgentMeaningAuthoring<C extends Catalog = Catalog> {
  /** Manual/developer authoring remains the canonical typed builder. */
  readonly manual: MeaningAuthoring<C>;
  /** Ergonomic typed AI route; it emits the same canonical draft shape. */
  readonly defineMeaning: (input: MeaningDefinitionInput) => Outcome<MeaningDraft>;
  /** AI proposals are checked by the same builder and preserve AI origin. */
  readonly propose: (input: MeaningProposalInput) => Outcome<MeaningDraft>;
  /** Code-owned meanings can only yield a proposed diff/new revision. */
  readonly proposeDiff: (
    base: MeaningDraft | MeaningDefinition,
    meaning: MeaningDefinition,
    options?: { readonly assumptions?: readonly string[] },
  ) => Outcome<MeaningDiff>;
  /** Optional pure local evaluator shared with manual previews. */
  readonly evaluator?: MeaningEvaluator;
}

export interface MeaningProposalCapabilityOptions<C extends Catalog = Catalog> {
  readonly authoring: AgentMeaningAuthoring<C>;
  readonly ref?: VersionRef;
}

export interface MeaningActivationCapabilityOptions {
  readonly registry: MeaningRegistry;
  readonly ref?: VersionRef;
}
