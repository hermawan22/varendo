import type { Outcome } from '@varendo/core';
import type { OperationGrant } from '@varendo/core/agent';
import type {
  ScopeController,
  SurfaceAddress,
  SurfaceController,
  SurfaceRequest,
  SurfaceSnapshot,
} from '@varendo/runtime';
import type { AgentCapabilityReceipt } from '../capabilities/types.js';
import type { AgentModelToolEndpoint, AgentToolDefinition, AgentToolTransport } from '../protocol/types.js';
import type { ToolModelBudget, ToolModelLoopOutcome, ToolModelPort, ToolModelRunPolicy } from '../model/types.js';

/** A host-owned acknowledgement from the actual renderer attached to a surface. */
export type AgentSurfaceRenderResult =
  | { readonly status: 'renderer-ready'; readonly revision: string }
  | { readonly status: 'committed'; readonly revision: string }
  | {
      readonly status: 'needs-input' | 'unsupported' | 'denied' | 'stale' | 'cancelled' | 'failed';
      readonly diagnosticCode: string;
    };

export interface AgentSurfaceRenderInput {
  readonly targetId: string;
  readonly intent: unknown;
  readonly signal: AbortSignal;
}

/**
 * One explicitly host-registered target. The bridge never discovers surfaces
 * from a runtime or from the DOM; the client resolves only the requested IDs.
 */
export interface AgentSurfaceTarget {
  readonly id: string;
  readonly surface: SurfaceController<unknown, unknown>;
  /**
   * The renderer owner may acknowledge a committed surface revision. Without
   * this callback a request can only produce a plan-committed receipt.
   */
  readonly render?: (input: AgentSurfaceRenderInput) => AgentSurfaceRenderResult | Promise<AgentSurfaceRenderResult>;
}

export interface AgentClientPairing {
  readonly sessionId: string;
  readonly goalEpoch: string;
  readonly scope: ScopeController;
  readonly targets: readonly string[];
  readonly endpoint: AgentModelToolEndpoint;
  readonly transport: AgentToolTransport;
}

export interface ScopedSurfaceEndpointOptions {
  readonly scope: ScopeController;
  readonly sessionId: string;
  readonly goalEpoch: string;
  readonly targets: readonly AgentSurfaceTarget[];
  readonly transport: AgentToolTransport;
  /**
   * Host-delegated grant ceiling for this pairing. Effective authority is the
   * intersection of these grants and the operations the endpoint's registered
   * tools actually require; a broader request is clamped, never unioned.
   */
  readonly grants?: readonly OperationGrant[];
  readonly expiresAt: number;
  readonly now?: () => number;
  readonly maxPending?: number;
  readonly maxMilliseconds?: number;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
}

export interface AgentClientHandle {
  readonly disconnect: () => void;
}

/**
 * A deliberately small host adapter. All fields other than `kind` are
 * optional so applications can supply only a transport, model port, or target
 * resolver that they actually own.
 */
export interface AgentClient {
  readonly kind: 'host-agent-client';
  readonly transport?: Extract<AgentToolTransport, 'byok' | 'webmcp' | 'mcp'>;
  readonly model?: ToolModelPort;
  readonly modelPort?: ToolModelPort;
  readonly resolveTarget?: (targetId: string) => AgentSurfaceTarget | undefined;
  readonly getTarget?: (targetId: string) => AgentSurfaceTarget | undefined;
  readonly registeredTargets?: readonly AgentSurfaceTarget[];
  readonly connect?: (pairing: AgentClientPairing) => AgentClientHandle | void;
  readonly onConnect?: (pairing: AgentClientPairing) => AgentClientHandle | void;
}

export type AgentConnectionStatus = 'connected' | 'stale' | 'denied' | 'disconnected';

export interface AgentConnectionSnapshot {
  readonly status: AgentConnectionStatus;
  readonly sessionId?: string;
  readonly goalEpoch?: string;
  readonly scopeInstanceId?: string;
  readonly activationEpoch?: number;
  readonly targets: readonly string[];
}

export interface AgentExperienceOptions {
  readonly signal?: AbortSignal;
  readonly budget?: ToolModelBudget;
  readonly policy?: ToolModelRunPolicy;
}

export interface AgentConnection {
  readonly disconnect: () => void;
  readonly inspect: () => AgentConnectionSnapshot;
  readonly endpoint: AgentModelToolEndpoint | undefined;
  readonly discover: (options?: { readonly signal?: AbortSignal }) => Promise<Outcome<readonly AgentToolDefinition[]>>;
  readonly invoke: (
    name: string,
    input: unknown,
    options?: { readonly requestId?: string; readonly signal?: AbortSignal },
  ) => Promise<Outcome<AgentCapabilityReceipt>>;
  readonly render: (
    targetId: string,
    intent: SurfaceRequest<unknown>,
    options?: { readonly requestId?: string; readonly signal?: AbortSignal },
  ) => Promise<Outcome<AgentCapabilityReceipt>>;
  readonly runExperience: (prompt: string, options?: AgentExperienceOptions) => Promise<ToolModelLoopOutcome>;
}

export interface AgentTargetMetadata {
  readonly id: string;
  readonly address: SurfaceAddress;
  readonly revision: string;
  readonly phase: SurfaceSnapshot<unknown, unknown>['phase'];
  readonly intent: Readonly<Record<string, string>>;
}
