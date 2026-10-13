import type {
  Diagnostic,
  Intent,
  InteractionState,
  Outcome,
  PresentationPlan,
  ResourceDefinition,
  ResultRef,
  SemanticType,
  Task,
  VersionRef,
} from '@varendo/core';
import type { IntentCompilerRegistry } from '@varendo/core/app';
import type { ActionPort } from '../actions/types.js';
import type { DataService, QueryBudget, ReadContext } from '../data/types.js';
import type { MaterializedTaskOutput } from '../evaluation/types.js';
import type { RegionReadSet, RegionSnapshot } from '../regions/types.js';
import type { ResultStore, ResultStoreOptions } from '../results/types.js';
import type {
  CreateCapabilitySurfaceInput,
  CreateDataSurfaceInput,
  CreateLocalSurfaceScopeInput,
  LocalSurfaceScope,
  SurfaceController,
} from '../surfaces/types.js';
import type { CreateScopeInput, ScopeController } from '../scopes/types.js';

export type RuntimeEffect = 'render' | 'commit' | 'action' | 'context';

/** Trusted host state. None of these fields are accepted from an intent or agent proposal. */
export interface AppAuthorityContext {
  readonly principalKey: string;
  readonly scopeDigest: string;
  readonly policyRevision: string;
  readonly experienceRevision: string;
  readonly grants: readonly string[];
  readonly readContext: ReadContext;
  readonly now?: () => number;
  readonly budget?: QueryBudget;
}

export interface AppAuthorityRequest {
  readonly resourceId: string;
  readonly regionId: string;
  readonly effect: RuntimeEffect;
  readonly signal?: AbortSignal;
}

export interface VarendoAuthority {
  read(
    request: AppAuthorityRequest,
  ):
    | { readonly ok: true; readonly value: AppAuthorityContext }
    | { readonly ok: false; readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]] };
}

export interface RuntimeResourceBinding {
  readonly resource: ResourceDefinition;
  readonly data: DataService;
}

export interface VarendoRuntimeOptions {
  readonly runtimeId?: string;
  readonly resources: readonly RuntimeResourceBinding[];
  readonly authority: VarendoAuthority;
  readonly intents?: IntentCompilerRegistry;
  readonly actionPort?: ActionPort;
  readonly resultStore?: ResultStore;
  readonly resultStoreOptions?: ResultStoreOptions;
  readonly maxRegions?: number;
  readonly maxRenderMilliseconds?: number;
}

export interface RuntimeResourceContext {
  readonly resource: { readonly id: string; readonly label: string; readonly description?: string };
  readonly intents: readonly string[];
  readonly fields: readonly {
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    readonly role: string;
    readonly type: SemanticType;
    readonly values?: readonly (string | number | boolean)[];
  }[];
  readonly meanings: readonly {
    readonly id: string;
    readonly revision: string;
    readonly label: string;
    readonly explanation: string;
    readonly output: SemanticType;
    readonly aggregation: string;
  }[];
  readonly views: readonly string[];
  readonly actions: readonly { readonly intent: 'create' | 'edit'; readonly action: VersionRef }[];
  readonly authority: {
    readonly principalKey: string;
    readonly scopeDigest: string;
    readonly policyRevision: string;
    readonly experienceRevision: string;
    readonly grants: readonly string[];
  };
}

export interface RuntimeMountInput {
  readonly regionId: string;
  readonly resourceId: string;
}

export interface RuntimeRenderInput {
  readonly regionId: string;
  readonly intent: unknown;
  readonly signal?: AbortSignal;
}

/** Host projection callbacks run synchronously inside the Region publication fence. */
export interface RuntimePresentationProjection {
  apply(next: RegionSnapshot): Outcome<void>;
  rollback(): void;
}

export interface RuntimePreparedRender extends RuntimePresentationProjection {
  readonly presentation: PresentationPlan;
  readonly interaction?: InteractionState;
}

export interface RuntimeRenderPreparation {
  readonly requestId: string;
  readonly regionId: string;
  readonly intent: Intent;
  readonly task: Task;
  readonly region: RegionSnapshot;
  readonly outputs: readonly MaterializedTaskOutput[];
  readonly signal: AbortSignal;
  readonly current: RegionReadSet;
}

export interface RuntimeRenderOptions {
  readonly prepare?: (
    input: RuntimeRenderPreparation,
  ) => Outcome<void | RuntimePreparedRender> | Promise<Outcome<void | RuntimePreparedRender>>;
}

export interface RuntimePresentationInput {
  readonly regionId: string;
  readonly requestId: string;
  readonly task: Task;
  readonly presentation: PresentationPlan;
  readonly interaction?: InteractionState;
  readonly projection?: RuntimePresentationProjection;
  readonly signal?: AbortSignal;
}

export type RuntimeRenderStatus = 'committed' | 'needs-input' | 'denied' | 'cancelled' | 'unsupported' | 'failed';

interface RuntimeReceiptBase {
  readonly status: RuntimeRenderStatus;
  readonly requestId: string;
  readonly regionId: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface RuntimeCommittedReceipt extends RuntimeReceiptBase {
  readonly status: 'committed';
  readonly intent: Intent;
  readonly task: Task;
  readonly outputs: readonly MaterializedTaskOutput[];
  readonly region: RegionSnapshot;
}

export interface RuntimeUncommittedReceipt extends RuntimeReceiptBase {
  readonly status: Exclude<RuntimeRenderStatus, 'committed'>;
  readonly intent?: Intent;
  readonly task?: Task;
}

export type RuntimeRenderReceipt = RuntimeCommittedReceipt | RuntimeUncommittedReceipt;

export type RuntimePhase = 'idle' | 'rendering' | RuntimeRenderStatus | 'disposed';
export interface RuntimeRegionState {
  readonly regionId: string;
  readonly resourceId: string;
  readonly phase: RuntimePhase;
  readonly requestId?: string;
  readonly task?: Task;
  readonly results: readonly ResultRef[];
  readonly diagnostics: readonly Diagnostic[];
  readonly region?: RegionSnapshot;
}

export type RuntimeUnsubscribe = () => void;

export interface VarendoRuntime {
  readonly actionPort?: ActionPort;
  createScope(input: CreateScopeInput): ScopeController;
  createLocalSurfaceScope(input?: CreateLocalSurfaceScopeInput): LocalSurfaceScope;
  createSurface<S>(input: CreateDataSurfaceInput<S>): SurfaceController<Intent, S>;
  createSurface<I, S>(input: CreateCapabilitySurfaceInput<I, S>): SurfaceController<I, S>;
  mount(
    input: RuntimeMountInput,
  ):
    | { readonly ok: true; readonly value: RuntimeRegionState }
    | { readonly ok: false; readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]] };
  render(input: RuntimeRenderInput, options?: RuntimeRenderOptions): Promise<RuntimeRenderReceipt>;
  context(regionId: string): Outcome<RuntimeResourceContext>;
  /** Lists resources authorized for the paired principal and scope. Denied resources are omitted. */
  contexts(regionId: string): Outcome<readonly RuntimeResourceContext[]>;
  commitPresentation(
    input: RuntimePresentationInput,
  ): Promise<
    | { readonly ok: true; readonly value: RegionSnapshot }
    | { readonly ok: false; readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]] }
  >;
  snapshot(regionId: string): RuntimeRegionState | undefined;
  subscribe(regionId: string, listener: (state: RuntimeRegionState) => void): RuntimeUnsubscribe;
  unmount(regionId: string): boolean;
  dispose(): void;
}
