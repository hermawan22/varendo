import type { Intent, Outcome, VersionRef } from '@varendo/core';
import type { DataFeatureDefinition, FeatureDefinition } from '@varendo/core/features';
import type { ActionPort } from '../actions/types.js';
import type { DataService, ResultEvent } from '../data/types.js';
import type { SurfacePresentationEvidence } from './presentation-evidence.js';

export type SurfaceRevision = string;
export type SurfacePhase =
  'idle' | 'loading' | 'ready' | 'needs-input' | 'unsupported' | 'denied' | 'failed' | 'disposed';

export interface SurfaceAddress {
  readonly runtimeId: string;
  readonly scopeInstanceId: string;
  readonly activationEpoch: number;
  readonly surfaceId: string;
  readonly surfaceGeneration: number;
}

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

export type DataSurfaceRequest =
  | {
      readonly kind: 'browse';
      readonly version?: Extract<Intent, { readonly kind: 'browse' }>['version'];
      readonly id?: string;
      readonly resource?: string;
      readonly fields?: Extract<Intent, { readonly kind: 'browse' }>['fields'];
      readonly filter?: Extract<Intent, { readonly kind: 'browse' }>['filter'];
      readonly search?: Extract<Intent, { readonly kind: 'browse' }>['search'];
      readonly sort?: Extract<Intent, { readonly kind: 'browse' }>['sort'];
      readonly page?: Extract<Intent, { readonly kind: 'browse' }>['page'];
    }
  | Intent;

export type SurfaceRequest<I> = I extends Intent ? I | DataSurfaceRequest : I;

export interface SurfaceController<I, S> {
  readonly id: string;
  readonly address: SurfaceAddress;
  getSnapshot(): SurfaceSnapshot<I, S>;
  /** Present only for committed data evaluations that have live authorized metadata. */
  presentationEvidence?(): SurfacePresentationEvidence | undefined;
  subscribe(listener: () => void): () => void;
  request(intent: SurfaceRequest<I>, options?: RequestOptions): Promise<RequestResult>;
  dispose(): void;
}

export interface SurfaceScopeSnapshot {
  readonly runtimeId: string;
  readonly scopeInstanceId: string;
  readonly activationEpoch: number;
  readonly active: boolean;
  readonly permissionRevision: number;
}

export interface SurfaceScope {
  getSnapshot(): SurfaceScopeSnapshot;
  authorize(featureId: string): Outcome<void>;
  subscribeFence?(listener: () => void): () => void;
  registerTarget?(address: SurfaceAddress, fence: () => void): () => void;
}

export interface LocalSurfaceScope extends SurfaceScope {
  setFeaturePermission(featureId: string, allowed: boolean): void;
  dispose(): void;
}

export interface CreateLocalSurfaceScopeInput {
  readonly id?: string;
  readonly allowedFeatures?: readonly string[];
}

export interface SurfaceReadContext {
  readonly scope: SurfaceScopeSnapshot;
  readonly signal?: AbortSignal;
}

export interface DataServiceCoverage {
  readonly fields: readonly string[];
  /** Relations and registered meanings declared by the bound source, when explicit. */
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
}

export interface CapabilitySurfaceBindings<I, S> {
  /** Typed intent exposed before the first request, independent of host address initialization. */
  readonly initialIntent: I;
  /** Inert state exposed before the first explicit request. */
  readonly initialState: S;
  readonly source: CapabilitySourceBinding<I, S>;
  readonly actions?: ActionPort;
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
  /** Explicit host correlation seam. A changed snapshot alone is not proposal acceptance. */
  readonly proposalDecision?: SurfaceProposalDecision;
}

export interface ExternalOwnership<I, S> {
  readonly mode: 'external';
  readonly store: ExternalSurfaceStore<I, S>;
  readonly onProposal: (proposal: SurfaceProposal<I>) => void;
}

export type SurfaceOwnership<I, S> = InternalOwnership<I> | ExternalOwnership<I, S>;

export interface CreateDataSurfaceInput<S> {
  readonly scope: SurfaceScope;
  readonly id: string;
  readonly feature: DataFeatureDefinition;
  readonly bindings: DataSurfaceBindings<S>;
  readonly ownership?: SurfaceOwnership<Intent, S>;
}

export interface CreateCapabilitySurfaceInput<I, S> {
  readonly scope: SurfaceScope;
  readonly id: string;
  readonly feature: FeatureDefinition<I> & { readonly kind: 'feature' };
  readonly bindings: CapabilitySurfaceBindings<I, S>;
  readonly ownership?: SurfaceOwnership<I, S>;
}
