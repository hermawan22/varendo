import type {
  CommitPreconditions,
  Contract,
  Experience,
  Outcome,
  PresentationPlan,
  Result,
  Task,
  VersionRef,
  ReadonlyJsonValue,
} from '../contracts/types.js';
import type { ExperienceRestriction } from '../contracts/experience/index.js';
import type { InteractionGraph, InteractionMappingManifest, InteractionPort } from '../interaction/graph.js';

export type PresentationNode = PresentationPlan['nodes'][number];
export type PresentationValue = ReadonlyJsonValue;
export type PresentationValues = Readonly<Record<string, PresentationValue>>;
/** Unknown server measurements remain unknown; this pass never reads browser globals. */
export type PresentationEnvironment = Contract<'environment'>;

export interface ResolvedPresentationConfig {
  /** Canonical bounded values used by the registered renderer. */
  readonly values: PresentationValues;
  /** Fields actually made available by this configuration, including accessible alternatives. */
  readonly fields: readonly string[];
  /** Trusted registry code derives ports from the bound result, never the proposed wire graph. */
  readonly ports: readonly InteractionPort[];
  /** Actual operations enabled by this configuration; if omitted, every manifest operation is enabled. */
  readonly operations?: readonly VersionRef[];
}

/** Trusted ordinal assessments, never model confidence or proof of business truth.
 * Ordinal fields are integers in 0..100. Cost requires a recorded measurement ref.
 */
export interface PresentationQuality {
  readonly taskFit: number;
  readonly informationDensity: number;
  readonly interactionEffort: number;
  readonly legibilityPenalty: number;
  readonly cost?: { readonly microseconds: number; readonly measurement: VersionRef };
}

/** Parsed, owned inputs supplied to trusted local pattern callbacks. */
export interface PresentationPatternContext {
  readonly task: Task;
  readonly experience: Experience;
  readonly results: readonly Result[];
  readonly current: CommitPreconditions;
  readonly environment: PresentationEnvironment;
  /** Parsed current presentation, for explicit registered state transfers. */
  readonly incumbent?: PresentationPlan;
}
export interface PresentationPatternRequest {
  readonly id: string;
  readonly revision: string;
  readonly preconditions: CommitPreconditions;
  readonly context: PresentationPatternContext;
}
/** A tested local macro. Registry installation rejects duplicate pattern IDs,
 * including multiple revisions: Experience allowlists currently contain IDs.
 * Matching never grants permission or bypasses normal plan feasibility.
 */
export interface PresentationPatternManifest {
  readonly ref: VersionRef;
  readonly expand: (request: PresentationPatternRequest) => Outcome<PresentationPlan>;
  readonly matches: (plan: PresentationPlan, context: PresentationPatternContext) => boolean;
}

/** Trusted local registry entry. Callbacks must be pure, synchronous and bounded. */
export interface PresentationManifest {
  readonly ref: VersionRef;
  readonly configSchema: VersionRef;
  readonly roles: readonly string[];
  readonly operations: readonly VersionRef[];
  readonly result: 'required' | 'optional' | 'none';
  readonly children: { readonly min: number; readonly max: number };
  /** Exclusive containers cannot satisfy a simultaneous comparison across their children. */
  readonly visibility: 'simultaneous' | 'exclusive' | 'leaf';
  readonly extension: boolean;
  /** The validator supplies the parsed node so config-dependent child layouts can reject omitted content. */
  readonly resolveConfig: (
    values: PresentationValues,
    result: Result | undefined,
    node?: PresentationNode,
  ) => Outcome<ResolvedPresentationConfig>;
  /** Optional tested environment envelope and ordinal assessment. A failure is
   * infeasible; an absent assessment conveys no measured quality claim. */
  readonly assess?: (
    config: ResolvedPresentationConfig,
    result: Result | undefined,
    environment: PresentationEnvironment,
  ) => Outcome<PresentationQuality>;
  /** Optional deterministic candidate authoring. Explicit candidates use the same validator. */
  readonly suggestConfig?: (
    needs: readonly Task['needs'][number][],
    result: Result | undefined,
  ) => Outcome<PresentationValues>;
}

/** Trusted declaration of a renderer-implemented transition. `archive` moves a
 * removed view's state into a retained owner; it does not authorize state loss.
 * Runtime must advertise the exact mapping and apply it transactionally. */
export interface PresentationStateMappingManifest {
  readonly ref: VersionRef;
  readonly from: VersionRef;
  readonly to: VersionRef;
  readonly fromRole: string;
  readonly toRole: string;
  readonly kind: 'transfer' | 'archive';
}

export interface PresentationRegistry {
  readonly manifests: readonly PresentationManifest[];
  readonly mappings: readonly InteractionMappingManifest[];
  readonly patterns?: readonly PresentationPatternManifest[];
  readonly stateMappings?: readonly PresentationStateMappingManifest[];
}

export interface PresentationContext {
  readonly task: Task;
  readonly experience: Experience;
  readonly restrictions?: readonly ExperienceRestriction[];
  /** Application-authorized descriptors only. Reference presence grants no access. */
  readonly results: readonly Result[];
  readonly current: CommitPreconditions;
  readonly environment: PresentationEnvironment;
  readonly rendererCapabilities: readonly VersionRef[];
  /** Exact registered state mappings implemented by the committing renderer. */
  readonly stateMappingCapabilities?: readonly VersionRef[];
  /** Current presentation for fixed/adaptive mode and state transfer checks. */
  readonly incumbent?: PresentationPlan;
  /** Host blocks structural replacement while focus/draft/IME owns the active view. */
  readonly transitionBlocked?: boolean;
  readonly explicitTransition?: boolean;
}

export interface ResolvedPresentationNode {
  /** Replayable wire configuration; renderer values are in the sibling config. */
  readonly node: PresentationNode;
  readonly manifest: VersionRef;
  readonly config: ResolvedPresentationConfig;
  readonly result: Result | undefined;
  readonly quality?: PresentationQuality;
}

export interface ValidatedPresentation {
  readonly plan: PresentationPlan;
  readonly nodes: readonly ResolvedPresentationNode[];
  readonly graph: InteractionGraph;
  readonly environment: PresentationEnvironment;
}

export interface PresentationCompositionRequest {
  readonly id: string;
  readonly revision: string;
  readonly preconditions: CommitPreconditions;
  readonly context: PresentationContext;
  readonly candidates?: readonly {
    /** Optional stable provenance label used in composition receipts and rejections. */
    readonly id?: string;
    readonly source: 'explicit' | 'pattern';
    readonly pattern?: VersionRef;
    readonly plan: PresentationPlan;
  }[];
  /** Resolver callers with authored candidates can disable registry suggestion search. */
  readonly searchRegistered?: boolean;
}

export interface PresentationComposition {
  readonly status: 'composed' | 'search-exhausted' | 'conflict';
  readonly presentation?: ValidatedPresentation;
  /** Internal deterministic provenance label for the selected composition candidate. */
  readonly selectedCandidate?: string;
  readonly expansions: number;
  readonly rejected: readonly {
    readonly candidate: string;
    readonly diagnostics: readonly import('../contracts/types.js').Diagnostic[];
  }[];
}

/** A structural runtime address used only to fence a presentation decision. */
export interface PresentationTargetRef {
  readonly runtimeId: string;
  readonly scopeInstanceId: string;
  readonly activationEpoch: number;
  readonly surfaceId: string;
  readonly surfaceGeneration: number;
}

/** Core never resolves a target or upgrades stale runtime evidence. */
export interface PresentationTargetEvidence {
  readonly address: PresentationTargetRef;
  readonly state: 'active' | 'stale' | 'revoked';
}

/** Candidate identities are diagnostic labels, never authority or array indexes. */
export interface PresentationResolverCandidate {
  readonly id: string;
  readonly source: 'explicit' | 'pattern';
  readonly pattern?: VersionRef;
  readonly plan: PresentationPlan;
}

export interface PresentationChoice {
  readonly id: string;
  readonly label: string;
}

/** Explicit missing semantics; resolver never infers a choice from descriptor order. */
export interface PresentationClarification {
  readonly kind: string;
  /** Registered representation that is otherwise eligible but needs this semantic choice. */
  readonly representation: VersionRef;
  readonly diagnostic: import('../contracts/types.js').Diagnostic;
  readonly choices: readonly PresentationChoice[];
}

export interface PresentationResolverInput {
  readonly id: string;
  readonly revision: string;
  readonly preconditions: CommitPreconditions;
  readonly context: PresentationContext;
  readonly registry: PresentationRegistry;
  readonly target: PresentationTargetEvidence;
  readonly candidates: readonly PresentationResolverCandidate[];
  readonly clarification?: PresentationClarification;
}

export interface PresentationReason {
  readonly code: string;
  readonly candidate?: string;
  readonly ref?: VersionRef;
  readonly rule?: string;
}

export interface PresentationRejection {
  readonly candidate: string;
  readonly codes: readonly string[];
  readonly refs: readonly VersionRef[];
}

export interface PresentationDecisionReceipt {
  readonly resolver: VersionRef;
  readonly request: { readonly id: string; readonly revision: string };
  readonly selectedCandidate: string;
  readonly examinedCandidates: number;
  readonly pins: {
    readonly taskRevision: string;
    readonly catalogRevision: string;
    readonly experienceRevision: string;
    readonly functionRegistryDigest: string;
    readonly policyRevision: string;
  };
  readonly rules: readonly string[];
}

export type PresentationDecision =
  | {
      readonly status: 'ready';
      readonly plan: ValidatedPresentation;
      readonly reasons: readonly PresentationReason[];
      readonly receipt: PresentationDecisionReceipt;
    }
  | {
      readonly status: 'needs-input';
      readonly diagnostic: import('../contracts/types.js').Diagnostic;
      readonly choices: readonly PresentationChoice[];
      readonly reasons: readonly PresentationReason[];
    }
  | {
      readonly status: 'unsupported';
      readonly diagnostic: import('../contracts/types.js').Diagnostic;
      readonly rejections: readonly PresentationRejection[];
      readonly reasons: readonly PresentationReason[];
    };
