/**
 * DECLARATION-ONLY DESIGN CONTRACT, NOT AELIQO IMPLEMENTATION.
 *
 * T01 uses these declarations to typecheck complete consumers before product
 * exports are changed. There are no runtime values, effects, network calls, or
 * React implementations in this file.
 */
import type { ComponentType, ReactElement, ReactNode } from 'react';
import type { Intent, Outcome, VersionRef } from '../../packages/core/src/index.js';
import type { ActionPort } from '../../packages/runtime/src/actions/index.js';
import type { DataService, ResultEvent } from '../../packages/runtime/src/data/index.js';
import type { AeliqoApp } from '../../packages/web/src/app/index.js';

export type { AeliqoApp, Intent };

export type SurfaceRevision = string;
export type SurfaceContractVersion = 'aeliqo.surface/1';

export interface SurfaceAddress {
  readonly runtimeId: string;
  readonly scopeInstanceId: string;
  readonly activationEpoch: number;
  readonly surfaceId: string;
  readonly surfaceGeneration: number;
}

export interface ScopeSelector {
  readonly kind: string;
  readonly id: string;
  readonly lineage?: readonly ScopeSelector[];
}

export interface PendingScopeTransition {
  readonly selector: ScopeSelector;
  readonly phase: 'guarding' | 'resolving';
  readonly requestId: string;
}

export interface ScopeSnapshot {
  readonly status: 'idle' | 'resolving' | 'active' | 'denied' | 'disposed';
  /** The active authorized selector; it never changes to the pending target. */
  readonly selector: ScopeSelector | null;
  readonly pending?: PendingScopeTransition;
  readonly activationEpoch: number;
  readonly revision: SurfaceRevision;
}

export type ScopeChangeResult =
  | { readonly status: 'active'; readonly selector: ScopeSelector; readonly activationEpoch: number }
  | {
      readonly status: 'needs-input';
      readonly diagnosticCode: string;
      readonly choices: readonly ('save' | 'discard' | 'stay')[];
    }
  | { readonly status: 'denied' | 'failed' | 'cancelled' | 'stale' | 'disposed'; readonly diagnosticCode: string };

export interface ScopeResolution {
  readonly status: 'authorized' | 'denied';
  readonly selector: ScopeSelector;
  readonly scopeInstanceId: string;
}

export type LeaveGuardResult =
  | { readonly status: 'clean' }
  | { readonly status: 'needs-input'; readonly choices: readonly ('save' | 'discard' | 'stay')[] }
  | { readonly status: 'failed'; readonly diagnosticCode: string };

export interface ScopeBinding {
  /** Membership and authority are resolved by the host/server boundary. */
  readonly resolve: (selector: ScopeSelector, options?: { readonly signal?: AbortSignal }) => Promise<ScopeResolution>;
  readonly guard?: (
    from: ScopeSelector,
    to: ScopeSelector,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<LeaveGuardResult>;
}

export interface ScopeController {
  getSnapshot(): ScopeSnapshot;
  subscribe(listener: () => void): () => void;
  /** Construction is inert; attach starts owned effects and returns an idempotent detach. */
  attach(): () => void;
  requestChange(selector: ScopeSelector, options?: { readonly signal?: AbortSignal }): Promise<ScopeChangeResult>;
  invalidate(reason: 'logout' | 'revoked' | 'expired' | 'external-switch'): void;
  dispose(): void;
}

export type SurfacePhase =
  'idle' | 'loading' | 'ready' | 'needs-input' | 'unsupported' | 'denied' | 'failed' | 'disposed';

export interface SurfaceSnapshot<I, S> {
  readonly id: string;
  readonly address: SurfaceAddress;
  readonly revision: SurfaceRevision;
  readonly phase: SurfacePhase;
  readonly intent: I;
  readonly state: S;
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
  readonly expectedRevision?: SurfaceRevision;
  readonly expectedAddress?: SurfaceAddress;
}

export type RequestResult =
  | { readonly status: 'committed'; readonly revision: SurfaceRevision }
  | { readonly status: 'proposed'; readonly proposalId: string }
  | { readonly status: 'needs-input'; readonly diagnosticCode: string }
  | {
      readonly status: 'unsupported' | 'denied' | 'stale' | 'cancelled' | 'disposed' | 'failed';
      readonly diagnosticCode: string;
    };

export interface SurfaceController<I, S> {
  readonly id: string;
  readonly address: SurfaceAddress;
  getSnapshot(): SurfaceSnapshot<I, S>;
  subscribe(listener: () => void): () => void;
  request(intent: I, options?: RequestOptions): Promise<RequestResult>;
  dispose(): void;
}

export type ParseResult<T> = Outcome<T>;
export type Parser<T> = (value: unknown) => ParseResult<T>;

export interface RuntimeSchema<T> {
  readonly parse: (value: unknown) => T;
  readonly safeParse: (
    value: unknown,
  ) => { readonly success: true; readonly data: T } | { readonly success: false; readonly error: unknown };
}

export interface RuntimeObjectSchema<T extends object> extends RuntimeSchema<T> {
  readonly shape: Readonly<Record<Extract<keyof T, string>, RuntimeSchema<unknown>>>;
}

type SchemaOutput<Schema extends RuntimeObjectSchema<object>> = ReturnType<Schema['parse']>;
type IdentityKey<Schema extends RuntimeObjectSchema<object>> = Extract<keyof SchemaOutput<Schema>, string>;

/** Immutable metadata only; no rows, credentials, principal, or live subscriptions. */
export interface FeatureDefinition<I = unknown> {
  readonly kind: 'data' | 'feature';
  readonly id: string;
  readonly label: string;
  readonly definitionRevision: string;
  parseIntent(value: unknown): ParseResult<I>;
}

export interface DataFeatureInput<Schema extends RuntimeObjectSchema<object> = RuntimeObjectSchema<object>> {
  readonly id: string;
  readonly schema: Schema;
  readonly identity: readonly [IdentityKey<Schema>, ...IdentityKey<Schema>[]];
  readonly label?: string;
  readonly revision?: string;
}

export interface DataFeatureDefinition<
  Schema extends RuntimeObjectSchema<object> = RuntimeObjectSchema<object>,
> extends FeatureDefinition<Intent> {
  readonly kind: 'data';
  readonly schema: Schema;
  readonly identity: readonly [string, ...string[]];
}

export interface FeatureCapabilityDefinition<Schema extends RuntimeSchema<unknown> = RuntimeSchema<unknown>> {
  readonly ref: VersionRef;
  readonly kind: 'read' | 'status' | 'command' | 'cancel' | 'output';
  readonly schema: Schema;
}

export interface FeatureViewDefinition {
  readonly ref: VersionRef;
  readonly capabilities: readonly VersionRef[];
}

export interface FeatureIntentDefinition<Schema extends RuntimeSchema<unknown> = RuntimeSchema<unknown>> {
  readonly ref: VersionRef;
  readonly schema: Schema;
  readonly capabilities: readonly VersionRef[];
  readonly views?: readonly VersionRef[];
}

export type FeatureIntentValue<Definitions extends readonly FeatureIntentDefinition[]> = {
  readonly [Key in keyof Definitions]: Definitions[Key] extends FeatureIntentDefinition<infer Schema>
    ? { readonly intent: Definitions[Key]['ref']; readonly input: ReturnType<Schema['parse']> }
    : never;
}[number];

export interface FeatureInput<
  Definitions extends readonly FeatureIntentDefinition[] = readonly FeatureIntentDefinition[],
> {
  readonly id: string;
  readonly label?: string;
  readonly revision?: string;
  readonly capabilities: readonly [FeatureCapabilityDefinition, ...FeatureCapabilityDefinition[]];
  readonly intents: Definitions;
  readonly views?: readonly FeatureViewDefinition[];
}

export interface NonDataFeatureDefinition<
  Definitions extends readonly FeatureIntentDefinition[],
> extends FeatureDefinition<FeatureIntentValue<Definitions>> {
  readonly kind: 'feature';
  readonly capabilities: readonly FeatureCapabilityDefinition[];
  readonly intents: Definitions;
  readonly views: readonly FeatureViewDefinition[];
}

export declare function defineFeature<const Definitions extends readonly FeatureIntentDefinition[]>(
  input: FeatureInput<Definitions>,
): NonDataFeatureDefinition<Definitions>;
export declare function defineDataFeature<Schema extends RuntimeObjectSchema<object>>(
  input: DataFeatureInput<Schema>,
): DataFeatureDefinition<Schema>;

export interface SurfaceReadContext {
  readonly scope: ScopeSelector;
  readonly signal?: AbortSignal;
}

export interface DataServiceCoverage {
  readonly fields: readonly string[];
  readonly relations?: readonly VersionRef[];
  readonly metrics?: readonly VersionRef[];
  readonly operators: readonly ('eq' | 'contains')[];
  readonly pagination: 'snapshot' | 'keyset';
  readonly stableOrder: readonly (string | StableOrderField)[];
  readonly stableOrderIdentity?: readonly string[];
  readonly sorting: 'stable-fields-only' | 'unsupported';
  readonly aggregation: 'registered-only' | 'unsupported';
  readonly streaming: 'finite' | 'incremental';
  readonly updates: 'snapshot-replace' | 'live';
  readonly unsupported: readonly ('sorting' | 'aggregation' | 'streaming' | 'live-updates')[];
}

export interface StableOrderField {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
  readonly nulls: 'first' | 'last';
}

export interface DataServiceSourceBinding<S> {
  readonly kind: 'data-service';
  /** Reuses the existing describe/plan/execute boundary; it is not a second query engine. */
  readonly service: DataService;
  readonly coverage: DataServiceCoverage;
  readonly normalize: (events: AsyncIterable<ResultEvent>, context: SurfaceReadContext) => Promise<S>;
}

export interface CapabilitySourceBinding<I, S> {
  readonly kind: 'capability';
  readonly read: (intent: I, context: SurfaceReadContext) => Promise<S>;
}

export interface DataSurfaceBindings<S> {
  /** Inert state exposed before the first explicit request. */
  readonly initialState: S;
  readonly source: DataServiceSourceBinding<S>;
  readonly actions?: ActionPort;
  readonly views?: ReactViewBinding<Intent, S>;
}

export interface CapabilitySurfaceBindings<I, S> {
  readonly initialIntent: I;
  /** Inert state exposed before the first explicit request. */
  readonly initialState: S;
  readonly source: CapabilitySourceBinding<I, S>;
  readonly actions?: ActionPort;
  readonly views?: ReactViewBinding<I, S>;
}

export interface InternalOwnership<I> {
  readonly mode: 'internal';
  readonly defaultIntent?: I;
}

export interface SurfaceProposal<I> {
  readonly proposalId: string;
  readonly address: SurfaceAddress;
  readonly expectedRevision: SurfaceRevision;
  readonly intent: I;
}

export interface ExternalSurfaceStore<I, S> {
  getSnapshot(): ExternalSurfaceSnapshot<I, S>;
  subscribe(listener: () => void): () => void;
}

export interface SurfaceProposalDecision {
  readonly proposalId: string;
  readonly address: SurfaceAddress;
  readonly expectedRevision: SurfaceRevision;
  readonly status: 'accepted' | 'rejected';
}

export interface ExternalSurfaceSnapshot<I, S> extends SurfaceSnapshot<I, S> {
  readonly proposalDecision?: SurfaceProposalDecision;
}

export interface ExternalOwnership<I, S> {
  readonly mode: 'external';
  readonly store: ExternalSurfaceStore<I, S>;
  readonly onProposal: (proposal: SurfaceProposal<I>) => void;
}

export type SurfaceOwnership<I, S> = InternalOwnership<I> | ExternalOwnership<I, S>;

export interface CreateScopeInput {
  readonly binding: ScopeBinding;
  readonly initial: ScopeSelector;
}

export interface CreateDataSurfaceInput<Schema extends RuntimeObjectSchema<object>, S> {
  readonly scope: ScopeController;
  readonly id: string;
  readonly feature: DataFeatureDefinition<Schema>;
  readonly bindings: DataSurfaceBindings<S>;
  readonly ownership?: SurfaceOwnership<Intent, S>;
}

export interface CreateCapabilitySurfaceInput<I, S> {
  readonly scope: ScopeController;
  readonly id: string;
  readonly feature: FeatureDefinition<I> & { readonly kind: 'feature' };
  readonly bindings: CapabilitySurfaceBindings<I, S>;
  readonly ownership?: SurfaceOwnership<I, S>;
}

export interface AeliqoRuntime {
  createScope(input: CreateScopeInput): ScopeController;
  createSurface<Schema extends RuntimeObjectSchema<object>, S>(
    input: CreateDataSurfaceInput<Schema, S>,
  ): SurfaceController<Intent, S>;
  createSurface<I, S>(input: CreateCapabilitySurfaceInput<I, S>): SurfaceController<I, S>;
  dispose(): void;
}

export interface RuntimeOptions {
  readonly runtimeId?: string;
}

export declare function createAeliqoRuntime(options?: RuntimeOptions): AeliqoRuntime;

export interface DataBrowseIntent {
  readonly kind: 'browse';
  readonly filter?: {
    readonly field: string;
    readonly comparison: 'eq' | 'contains';
    readonly value: string | number | boolean;
  };
}

export interface DataSurfaceState<Row> {
  readonly rows: readonly Row[];
  readonly selection: readonly string[];
}

export interface UseDataSurfaceOptions<Row> {
  readonly id?: string;
  readonly data: readonly Row[];
  readonly getRowId: (row: Row) => string;
  readonly schema?: RuntimeSchema<Row>;
  readonly ownership?: SurfaceOwnership<DataBrowseIntent, DataSurfaceState<Row>>;
}

export declare function useDataSurface<Row>(
  options: UseDataSurfaceOptions<Row>,
): SurfaceController<DataBrowseIntent, DataSurfaceState<Row>>;

export interface UseDataFeatureSurfaceOptions<S> {
  readonly id: string;
  readonly bindings: DataSurfaceBindings<S>;
  readonly ownership?: SurfaceOwnership<Intent, S>;
}

export interface UseCapabilitySurfaceOptions<I, S> {
  readonly id: string;
  readonly bindings: CapabilitySurfaceBindings<I, S>;
  readonly ownership?: SurfaceOwnership<I, S>;
}

export declare function useSurface<Schema extends RuntimeObjectSchema<object>, S>(
  feature: DataFeatureDefinition<Schema>,
  options: UseDataFeatureSurfaceOptions<S>,
): SurfaceController<Intent, S>;
export declare function useSurface<I, S>(
  feature: FeatureDefinition<I> & { readonly kind: 'feature' },
  options: UseCapabilitySurfaceOptions<I, S>,
): SurfaceController<I, S>;

export declare function useSurfaceState<I, S, Selected>(
  surface: SurfaceController<I, S>,
  selector: (snapshot: SurfaceSnapshot<I, S>) => Selected,
): Selected;

export interface AdaptiveSurfaceProps<I, S> {
  readonly surface: SurfaceController<I, S>;
  readonly controls?: ReactNode;
}

export interface ViewSurfaceProps<I, S> extends AdaptiveSurfaceProps<I, S> {
  readonly view: string;
}

export declare function AdaptiveSurface<I, S>(props: AdaptiveSurfaceProps<I, S>): ReactElement;
export declare function ViewSurface<I, S>(props: ViewSurfaceProps<I, S>): ReactElement;

export interface ReactViewProps<I, S> {
  readonly surface: SurfaceController<I, S>;
  readonly state: S;
  readonly children?: ReactNode;
}

export interface ReactViewImplementation<I, S> {
  readonly id: string;
  readonly revision: string;
  readonly render: ComponentType<ReactViewProps<I, S>>;
}

export interface ReactViewBinding<I, S> {
  readonly feature: FeatureDefinition<I>;
  readonly implementations: readonly ReactViewImplementation<I, S>[];
}

export declare function defineReactViews<I, S>(
  feature: FeatureDefinition<I>,
  implementations: readonly ReactViewImplementation<I, S>[],
): ReactViewBinding<I, S>;

export interface RuntimeProviderProps {
  readonly runtime: AeliqoRuntime;
  readonly children: ReactNode;
  readonly mode?: 'runtime';
}

export interface LegacyProviderProps {
  readonly mode: 'legacy-app';
  /** The compatibility branch consumes the actual existing 0.4 application contract. */
  readonly app: AeliqoApp;
  readonly children: ReactNode;
}

export type AeliqoProviderProps = RuntimeProviderProps | LegacyProviderProps;

export declare function AeliqoProvider(props: AeliqoProviderProps): ReactElement;

export interface AeliqoScopeProps {
  readonly scope: ScopeController;
  readonly children: ReactNode;
}

export declare function AeliqoScope(props: AeliqoScopeProps): ReactElement;
export declare function useAeliqoScope(): ScopeController;

export interface AgentClient {
  readonly kind: 'host-agent-client';
}

export interface AgentConnection {
  disconnect(): void;
}

export declare function connectAgent(input: {
  readonly scope: ScopeController;
  readonly client: AgentClient;
  readonly targets: readonly string[];
  /** Host-delegated grant ceiling; effective authority is intersected, never unioned. */
  readonly grants?: readonly string[];
}): AgentConnection;
