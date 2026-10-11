import type {
  Contract,
  Diagnostic,
  InteractionDraft as CoreInteractionDraft,
  InteractionLink,
  InteractionPayload as CoreInteractionPayload,
  InteractionState as CoreInteractionState,
  ResultRef,
  VersionRef,
} from '@varendo/core';
import type {
  InteractionGraph as CoreInteractionGraph,
  InteractionMappingManifest,
  InteractionPort,
  InteractionPortShape,
} from '@varendo/core/interaction';
import type { RegionContent, RegionHandle, RegionSnapshot } from '../regions/types.js';
import type { ResultHandle } from '../results/types.js';

export type { InteractionLink, InteractionMappingManifest, InteractionPort, InteractionPortShape };

/** The canonical wire event is deliberately untrusted and carries no actor or grant. */
export type InteractionEvent = Contract<'interaction'>;
export type InteractionPayload = CoreInteractionPayload;
export type InteractionKind = InteractionPayload['kind'];
export type InteractionSelection = Extract<InteractionPayload, { readonly kind: 'selection' }>['selection'];
export type InteractionQueryPayload = Extract<
  InteractionPayload,
  { readonly kind: 'filter' | 'range' | 'group' | 'page' }
>;
export type InteractionRoute = { readonly nodeId: string; readonly portId: string };

/** A trusted graph registration; wire presentation plans cannot create this registry. */
export type InteractionGraphDefinition = CoreInteractionGraph;

type InteractionFailureCode =
  | 'runtime.interaction-invalid'
  | 'runtime.interaction-stale'
  | 'runtime.interaction-denied'
  | 'runtime.interaction-revoked'
  | 'runtime.interaction-disposed'
  | 'runtime.interaction-budget'
  | 'runtime.interaction-cancelled'
  | 'runtime.interaction-unsupported'
  | string;

export interface InteractionFailure extends Diagnostic {
  readonly code: InteractionFailureCode;
}
export type InteractionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly [InteractionFailure, ...InteractionFailure[]] };

type InteractionGrant =
  'result.inspect' | 'experience.commit' | 'navigation.propose' | 'draft.edit' | 'action.propose' | (string & {});

export interface InteractionActor {
  readonly id: string;
  readonly kind: 'user' | 'service' | 'system';
}

/** Values returned by the trusted host on each event; never supplied by the wire event. */
export interface InteractionHostContext {
  /** Host cache partition; this is trusted context and is never read from the wire event. */
  readonly principalKey: string;
  /** Trusted draft namespace/domain; wire draft events carry no domain authority. */
  readonly draftDomain: string;
  readonly actor: InteractionActor;
  readonly grants: readonly InteractionGrant[];
  readonly scopeDigest: string;
  readonly policyRevision: string;
  readonly catalogRevision: string;
  readonly experienceRevision: string;
  readonly functionRegistryDigest: string;
  readonly results: readonly ResultRef[];
}

export interface InteractionResolutionContext {
  readonly event: InteractionEvent;
  readonly host: InteractionHostContext;
  readonly region: RegionSnapshot;
  readonly signal: AbortSignal;
}

export interface InteractionMappingContext {
  readonly event: InteractionEvent;
  readonly source: InteractionRoute;
  readonly target: InteractionRoute;
  readonly signal: AbortSignal;
}

export type InteractionMappingCallback = (
  payload: InteractionPayload,
  context: InteractionMappingContext,
) => InteractionOutcome<InteractionPayload>;

export interface InteractionMappingRegistration {
  readonly manifest: InteractionMappingManifest;
  /** Required for registered directed mappings; identity links use built-in propagation. */
  readonly map?: InteractionMappingCallback;
}

export interface InteractionGraphOptions {
  readonly maxHops?: number;
  readonly maxRoutes?: number;
}

export interface InteractionGraph {
  readonly definition: InteractionGraphDefinition;
  registerMapping(mapping: InteractionMappingRegistration): InteractionOutcome<void>;
  route(
    event: InteractionEvent,
    source: InteractionRoute,
    signal: AbortSignal,
    maxHops?: number,
  ): InteractionOutcome<readonly InteractionRoutedPayload[]>;
  dispose(): void;
}

export interface InteractionRoutedPayload {
  readonly route: InteractionRoute;
  readonly payload: InteractionPayload;
  readonly mapping?: VersionRef;
  readonly causationId: string;
}

/** Durable semantic state held by a region. */
export type InteractionPersistedState = CoreInteractionState;
export type InteractionValue = CoreInteractionState['values'][number];
export type InteractionDraftState = CoreInteractionDraft;

/** Controller state adds live region vectors to the canonical persisted state. */
export interface InteractionState extends CoreInteractionState {
  readonly regionRevision: string;
  readonly taskRevision: string;
}

export interface InteractionNavigationProposal {
  readonly event: InteractionEvent;
  readonly route: Extract<InteractionPayload, { readonly kind: 'navigate' }>['route'];
  readonly params: Extract<InteractionPayload, { readonly kind: 'navigate' }>['params'];
  readonly actor: InteractionActor;
}

export interface InteractionActionProposal {
  readonly event: InteractionEvent;
  readonly action: Extract<InteractionPayload, { readonly kind: 'action-request' }>['action'];
  readonly input: Extract<InteractionPayload, { readonly kind: 'action-request' }>['input'];
  readonly actor: InteractionActor;
}

export type InteractionHostCallback<T> = (
  value: T,
  context: InteractionResolutionContext,
) => InteractionOutcome<void> | Promise<InteractionOutcome<void>>;

export interface InteractionMaterialization {
  readonly state: RegionContent;
  readonly resultHandles?: readonly ResultHandle[];
}

export type InteractionMaterializeCallback = (
  value: readonly InteractionQueryPayload[],
  context: InteractionResolutionContext,
  next: InteractionPersistedState,
) => InteractionOutcome<InteractionMaterialization> | Promise<InteractionOutcome<InteractionMaterialization>>;

export interface InteractionControllerOptions {
  readonly region: RegionHandle;
  readonly graph: InteractionGraph;
  readonly readContext: () => InteractionHostContext;
  readonly resolveResult?: (ref: ResultRef, context: InteractionResolutionContext) => ResultHandle | undefined;
  /** Must attest that a selection belongs to the current permitted population. */
  readonly validateSelection?: InteractionHostCallback<InteractionSelection>;
  /** Validates query/result/snapshot binding for filter, range, group and page payloads. */
  readonly validateScope?: InteractionHostCallback<InteractionQueryPayload>;
  /** Validates that the field is editable and entityRevision is current. */
  readonly validateDraft?: InteractionHostCallback<Extract<InteractionPayload, { readonly kind: 'draft' }>>;
  /** Query-affecting interactions must obtain a fresh full region candidate here. */
  readonly materialize?: InteractionMaterializeCallback;
  /** Validates that the destination is application-declared before navigation. */
  readonly validateNavigation?: InteractionHostCallback<Extract<InteractionPayload, { readonly kind: 'navigate' }>>;
  readonly onNavigate?: InteractionHostCallback<Extract<InteractionPayload, { readonly kind: 'navigate' }>>;
  /** Proposal-only: this callback cannot execute a business write. */
  readonly onActionProposal?: InteractionHostCallback<Extract<InteractionPayload, { readonly kind: 'action-request' }>>;
  readonly maxQueuedEvents?: number;
  /** Per-event deadline, starting when the event begins processing after queue admission. */
  readonly maxEventMilliseconds?: number;
  readonly maxHops?: number;
  readonly now?: () => number;
}

export interface InteractionDispatchOptions {
  readonly sourcePortId?: string;
  readonly signal?: AbortSignal;
}

export interface InteractionEffectReceipt {
  readonly kind: 'navigate' | 'action-proposal';
  readonly eventId: string;
  readonly actorId: string;
}

export interface InteractionReceipt {
  readonly eventId: string;
  readonly state: InteractionState;
  readonly region: RegionSnapshot;
  readonly routed: readonly InteractionRoutedPayload[];
  readonly effects: readonly InteractionEffectReceipt[];
  readonly noop: boolean;
}

export interface InteractionController {
  readonly state: () => InteractionState;
  dispatch(input: unknown, options?: InteractionDispatchOptions): Promise<InteractionOutcome<InteractionReceipt>>;
  cancel(eventId: string): boolean;
  revoke(reason?: string): boolean;
  dispose(): void;
}
