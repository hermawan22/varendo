import type { Diagnostic, Outcome } from '@varendo/core';
import type { SurfaceScope, SurfaceScopeSnapshot } from '../surfaces/types.js';

export interface ScopeSelectorPart {
  readonly kind: string;
  readonly id: string;
}

export interface ScopeSelector extends ScopeSelectorPart {
  readonly lineage?: readonly ScopeSelectorPart[];
}

export interface ScopeResolution {
  readonly selector: ScopeSelector;
  readonly permissionRevision: number;
  readonly policyRevision: string;
  readonly allowedFeatures?: readonly string[];
}

interface ScopeResolveOptions {
  readonly signal: AbortSignal;
}

export interface ScopeLeaveState {
  readonly dirty: boolean;
  readonly revision: string;
}

export interface ScopeLeaveGuardInput {
  readonly active: ScopeSelector;
  readonly requested: ScopeSelector;
  readonly activationEpoch: number;
  readonly revision: string;
  readonly signal: AbortSignal;
}

export type ScopeLeaveDecision =
  | { readonly status: 'clean' | 'discard' | 'stay' }
  | { readonly status: 'needs-input'; readonly diagnostic?: Diagnostic }
  | {
      readonly status: 'save';
      readonly save: (options: ScopeResolveOptions) => Promise<Outcome<void>> | Outcome<void>;
    };

export type ScopeInvalidationReason = 'logout' | 'revoked' | 'expired' | 'external-switch';

export interface ScopeRecoveryInput {
  readonly selector: ScopeSelector;
  readonly policyRevision: string;
  readonly activationEpoch: number;
  readonly reason: ScopeInvalidationReason;
}

export type ScopeActivationContext =
  | { readonly kind: 'initial' }
  | {
      readonly kind: 'transition';
      readonly previous: ScopeResolution;
      readonly activationEpoch: number;
      readonly leaveRevision: string;
    };

export interface ScopeBinding {
  resolve(
    selector: ScopeSelector,
    options: ScopeResolveOptions,
  ): Promise<Outcome<ScopeResolution>> | Outcome<ScopeResolution>;
  authorize(resolution: ScopeResolution, options?: ScopeResolveOptions): Promise<Outcome<void>> | Outcome<void>;
  prepareActivation(resolution: ScopeResolution, context: ScopeActivationContext): Outcome<void>;
  activate(resolution: ScopeResolution, context: ScopeActivationContext): Outcome<void> | void;
  deactivate(resolution: ScopeResolution, reason: 'transition' | ScopeInvalidationReason | 'dispose'): void;
  readLeaveState?(selector: ScopeSelector): ScopeLeaveState;
  beforeLeave?(input: ScopeLeaveGuardInput): Promise<ScopeLeaveDecision> | ScopeLeaveDecision;
  recover?(input: ScopeRecoveryInput): void;
}

export type ScopeStatus = 'idle' | 'resolving' | 'active' | 'denied' | 'disposed';

export interface ScopePendingTransition {
  readonly selector: ScopeSelector;
  readonly phase: 'guarding' | 'resolving';
  readonly requestId: string;
}

export interface ScopeSnapshot extends SurfaceScopeSnapshot {
  readonly status: ScopeStatus;
  readonly selector: ScopeSelector | null;
  readonly revision: string;
  readonly policyRevision?: string;
  readonly pending?: ScopePendingTransition;
  readonly invalidationReason?: ScopeInvalidationReason;
  readonly diagnostic?: Diagnostic;
}

export type ScopeTransitionResult =
  | { readonly status: 'active'; readonly selector: ScopeSelector; readonly activationEpoch: number }
  | {
      readonly status: 'needs-input';
      readonly diagnosticCode: string;
      readonly choices: readonly ('save' | 'discard' | 'stay')[];
    }
  | {
      readonly status: 'stale' | 'cancelled' | 'denied' | 'failed' | 'disposed';
      readonly diagnosticCode: string;
    };

export interface ScopeRequestOptions {
  readonly signal?: AbortSignal;
}

export interface ScopeController extends SurfaceScope {
  getSnapshot(): ScopeSnapshot;
  subscribe(listener: () => void): () => void;
  attach(): () => void;
  requestChange(selector: ScopeSelector, options?: ScopeRequestOptions): Promise<ScopeTransitionResult>;
  invalidate(reason: ScopeInvalidationReason): void;
  dispose(): void;
}

export interface CreateScopeInput {
  readonly binding: ScopeBinding;
  readonly initial: ScopeSelector;
  readonly id?: string;
}
