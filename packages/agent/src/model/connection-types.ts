import type { ToolModelUsage } from './types.js';
import type { ToolModelCapability, ToolModelProtocolAdapter } from './protocol.js';

export type ModelExecutionEnvironment = 'trusted-server';

declare const opaqueSecretBrand: unique symbol;

/** A server-owned credential handle with no readable or enumerable secret value. */
export interface OpaqueModelSecret {
  readonly kind: 'opaque';
  readonly [opaqueSecretBrand]: true;
}

export type ToolModelAuthScheme = 'none' | 'bearer' | 'header';

/**
 * Authentication is deliberately a discriminated union. `none` is an explicit
 * local/self-hosted policy choice; it is never synthesized when a credential
 * is absent.
 */
export type ToolModelAuth =
  | { readonly scheme: 'none' }
  | { readonly scheme: 'bearer'; readonly secret: OpaqueModelSecret }
  | { readonly scheme: 'header'; readonly secret: OpaqueModelSecret; readonly headerName: string };

export interface ToolModelConnectionPolicy {
  readonly allowExternalEgress: boolean;
  readonly allowInsecureHttp?: boolean;
  readonly allowedOrigins?: readonly string[];
}

export interface ToolModelConnectionBudget {
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
}

export interface ToolModelRetryPolicy {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}

export interface ToolModelCostPolicy {
  readonly currency?: 'USD';
  readonly inputUSDPerMillion?: number;
  readonly outputUSDPerMillion?: number;
  readonly source?: string;
}

export type ToolModelFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ToolModelProviderObservation {
  readonly protocol: string;
  readonly configuredModel: string;
  readonly providerModel?: string;
  readonly responseId?: string;
  readonly usage: ToolModelUsage;
}

export interface ToolModelConnectionOptions {
  readonly adapter: ToolModelProtocolAdapter;
  readonly baseURL: string;
  readonly model: string;
  readonly auth: ToolModelAuth;
  readonly policy: ToolModelConnectionPolicy;
  readonly capabilities: readonly ToolModelCapability[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly retry?: ToolModelRetryPolicy;
  readonly budget?: ToolModelConnectionBudget;
  readonly cost?: ToolModelCostPolicy;
  readonly fetch?: ToolModelFetch;
  readonly onResponse?: (observation: ToolModelProviderObservation) => void;
}

export type ToolModelProviderErrorKind =
  | 'configuration'
  | 'authentication'
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'http'
  | 'malformed-response'
  | 'request-too-large'
  | 'response-too-large';

export interface NormalizedToolModelConnection {
  readonly adapter: ToolModelProtocolAdapter;
  readonly baseURL: string;
  readonly url: string;
  readonly model: string;
  readonly auth: ToolModelAuth;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly cost?: ToolModelCostPolicy;
  readonly fetch: ToolModelFetch;
  readonly onResponse?: (observation: ToolModelProviderObservation) => void;
}
