import type {
  Diagnostic,
  Intent,
  InteractionPayload,
  Outcome,
  ReadonlyJsonValue,
  ResourceDefinition,
  Task,
} from '@varendo/core';
import type {
  PresentationEnvironment,
  PresentationPatternManifest,
  PresentationStateMappingManifest,
  ValidatedPresentation,
} from '@varendo/core/presentation';
import type {
  VarendoRuntime,
  VarendoRuntimeOptions,
  RuntimeRegionState,
  RuntimeRenderReceipt,
  RuntimeUnsubscribe,
} from '@varendo/runtime/app';
import type { ScopeLeaveDecision } from '@varendo/runtime/scopes';
import type { ActionExecution, ActionOutcome, ActionPreview } from '@varendo/runtime/actions';
import type { VarendoRegionElement } from '../region/varendo-region.js';
import type { VarendoViewDefinition } from '../region/types.js';
import type { RecipeDefinition } from '../recipes/types.js';

export interface VarendoAppOptions extends VarendoRuntimeOptions {
  readonly recipes?: readonly RecipeDefinition[];
  readonly views?: readonly VarendoViewDefinition[];
  /** Trusted, bounded layout patterns resolved against the registered resource policy. */
  readonly patterns?: readonly PresentationPatternManifest[];
  /** Transitions implemented by the host renderers; registration never grants data access. */
  readonly stateMappings?: readonly PresentationStateMappingManifest[];
  /** Observes successful DOM publication, including container/media adaptation; never controls authority. */
  readonly onPresentation?: (receipt: RendererReadyReceipt) => void | Promise<void>;
  /** Host-owned Save/Discard/Stay decision before replacing a dirty form. */
  readonly onDraftExit?: (request: VarendoAppDraftExitRequest) => ScopeLeaveDecision | Promise<ScopeLeaveDecision>;
  /** Trusted host adapter for initial create/edit values. Edit forms require it so stale data is never invented. */
  readonly formState?: VarendoFormStateAdapter;
  /** Receives user-originated, boundary-validated action lifecycle events. */
  readonly onActionEvent?: (event: VarendoAppActionEvent) => void | Promise<void>;
}

export interface VarendoAppDraftExitRequest {
  readonly regionId: string;
  readonly intent: unknown;
  readonly drafts: readonly Extract<InteractionPayload, { readonly kind: 'draft' }>[];
  readonly revision: string;
  readonly signal: AbortSignal;
}

export type VarendoAppActionEvent =
  | {
      readonly state: 'preview';
      readonly regionId: string;
      readonly preview: ActionPreview;
      confirm(): Promise<ActionOutcome<ActionExecution>>;
      cancel(): boolean;
    }
  | { readonly state: 'executed'; readonly regionId: string; readonly execution: ActionExecution }
  | {
      readonly state: 'failed';
      readonly regionId: string;
      readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];
    };

export interface VarendoFormState {
  readonly values: Readonly<Record<string, ReadonlyJsonValue>>;
  readonly entityRevision: string;
}

export interface VarendoFormStateRequest {
  readonly regionId: string;
  readonly resource: ResourceDefinition;
  readonly intent: Extract<Intent, { readonly kind: 'create' | 'edit' }>;
  readonly task: Extract<Task, { readonly kind: 'form' }>;
  readonly signal: AbortSignal;
}

export interface VarendoFormStateAdapter {
  read(request: VarendoFormStateRequest): Outcome<VarendoFormState> | Promise<Outcome<VarendoFormState>>;
}

export interface WebMountInput {
  readonly target: HTMLElement;
  readonly regionId: string;
  readonly resourceId: string;
}

export interface WebRenderInput {
  readonly regionId: string;
  readonly intent: unknown;
  readonly signal?: AbortSignal;
}

export interface RendererReadyReceipt {
  readonly status: 'renderer-ready';
  readonly requestId: string;
  readonly regionId: string;
  readonly runtime: Extract<RuntimeRenderReceipt, { readonly status: 'committed' }>;
  readonly presentation: ValidatedPresentation;
  readonly environment: PresentationEnvironment;
  readonly diagnostics: readonly [];
}

export interface RendererFailureReceipt {
  readonly status: 'unsupported' | 'failed' | 'cancelled' | 'needs-input';
  readonly requestId: string;
  readonly regionId: string;
  /** The trusted runtime evidence remains inspectable even when presentation cannot commit. */
  readonly runtime: Extract<RuntimeRenderReceipt, { readonly status: 'committed' }>;
  readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];
}

export type WebRenderReceipt =
  RendererReadyReceipt | Exclude<RuntimeRenderReceipt, { readonly status: 'committed' }> | RendererFailureReceipt;

export interface VarendoApp {
  readonly runtime: VarendoRuntime;
  mount(
    input: WebMountInput,
  ):
    | { readonly ok: true; readonly value: VarendoRegionElement }
    | { readonly ok: false; readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]] };
  render(input: WebRenderInput): Promise<WebRenderReceipt>;
  snapshot(regionId: string): RuntimeRegionState | undefined;
  subscribe(regionId: string, listener: (state: RuntimeRegionState) => void): RuntimeUnsubscribe;
  unmount(regionId: string): boolean;
  dispose(): void;
}
