import type { Catalog, CommitPreconditions, MeaningDefinition, Outcome, VersionRef } from '@varendo/core';
import type {
  MeaningActivationPolicy,
  MeaningActivationReceipt,
  MeaningBundle,
  MeaningScope,
  SemanticPolicy,
} from '@varendo/core/semantics';
import type { DefineMetricInput, FunctionRegistry, TypedAuthoring } from '@varendo/core/expressions';
import type { QueryLimits, QueryResult, QuerySource } from '@varendo/core/query';

/** The trusted surface that produced a canonical definition. */
type MeaningAuthoringSurface = 'code' | 'ai-assisted';

/** Repository ownership is separate from canonical origin and activation authority. */
type MeaningOwnership = 'code' | 'session' | 'personal' | 'workspace' | 'organization';

export interface MeaningSource {
  readonly surface: MeaningAuthoringSurface;
  readonly ownership: MeaningOwnership;
  /** Code-owned entries cannot be overwritten through AI or registry activation. */
  readonly readOnly?: boolean;
  /** Optional bounded repository/application identity for audit and diff routing. */
  readonly ownerId?: string;
}

export interface MeaningDraft {
  readonly version: '1';
  readonly meaning: MeaningDefinition;
  readonly source: MeaningSource;
  readonly digest: string;
  readonly assumptions: readonly string[];
  /** The immutable version from which an edit was proposed. */
  readonly base?: VersionRef;
}

export interface MeaningEntry {
  readonly draft: MeaningDraft;
  readonly active: boolean;
  readonly revoked: boolean;
}

export interface MeaningRegistrationReceipt {
  readonly state: 'registered';
  readonly meaning: VersionRef;
  readonly digest: string;
  readonly catalogRevision: string;
  readonly idempotent: boolean;
  readonly active: boolean;
}

export interface MeaningRevocationReceipt {
  readonly state: 'revoked';
  readonly meaning: VersionRef;
  readonly catalogRevision: string;
}

export interface MeaningActivationContext {
  readonly principalKey: string;
  readonly scopeDigest: string;
  readonly policyRevision: string;
  readonly catalogRevision: string;
  readonly functionRegistryDigest: string;
  readonly grants: readonly string[];
  /** Exact host allowlist; the model/request never supplies this policy. */
  readonly policy: MeaningActivationPolicy;
  /** Optional scope restriction applied in addition to semantic validation. */
  readonly allowedScopes?: readonly MeaningScope[];
  /** Optional host read-set pin for callers that stage activation with a task. */
  readonly readSet?: CommitPreconditions;
}

export interface MeaningActivationContextRequest {
  readonly meaning: VersionRef;
  readonly signal: AbortSignal;
}

export interface MeaningActivationHost {
  readonly readContext: (
    input: MeaningActivationContextRequest,
  ) => Outcome<MeaningActivationContext> | Promise<Outcome<MeaningActivationContext>>;
}

export interface MeaningRegistryOptions {
  readonly catalog: Catalog;
  readonly registry: FunctionRegistry;
  readonly definitions?: readonly MeaningDefinition[];
  readonly policy?: SemanticPolicy;
  readonly activationHost?: MeaningActivationHost;
  readonly maxEntries?: number;
  /** Aggregate UTF-8 bytes retained in locally registered drafts, including tombstones. */
  readonly maxBytes?: number;
}

export interface MeaningRegistrationInput {
  readonly draft: MeaningDraft;
  /** Code bundles may be registered before a later trusted activation pass. */
  readonly activate?: boolean;
}

export interface MeaningActivationOptions {
  readonly signal?: AbortSignal;
  /** Trusted calling adapter pins; never supplied by an untrusted proposal. */
  readonly expectedAuthority?: { readonly principalKey: string; readonly readSet?: CommitPreconditions };
}

export interface MeaningRegistry {
  readonly catalog: Catalog;
  readonly registry: FunctionRegistry;
  readonly register: (input: MeaningRegistrationInput) => Outcome<MeaningRegistrationReceipt>;
  readonly registerBundle: (
    bundle: MeaningBundle,
    source?: MeaningSource,
  ) => Outcome<readonly MeaningRegistrationReceipt[]>;
  readonly get: (ref: VersionRef) => MeaningEntry | undefined;
  readonly list: (options?: {
    readonly includeRevoked?: boolean;
    readonly activeOnly?: boolean;
  }) => readonly MeaningEntry[];
  readonly definitions: (options?: { readonly activeOnly?: boolean }) => readonly MeaningDefinition[];
  readonly activate: (
    ref: VersionRef,
    options?: MeaningActivationOptions,
  ) => Promise<Outcome<MeaningActivationReceipt>>;
  readonly revoke: (ref: VersionRef) => Outcome<MeaningRevocationReceipt>;
  readonly revokeScope: (scopeDigest: string) => Outcome<readonly MeaningRevocationReceipt[]>;
}

export interface MeaningAuthoringOptions<C extends Catalog = Catalog> {
  readonly catalog: C;
  readonly registry: FunctionRegistry;
  readonly definitions?: readonly MeaningDefinition[];
  readonly policy?: SemanticPolicy;
  readonly source?: MeaningSource;
  readonly assumptions?: readonly string[];
}

export interface MeaningDefinitionInput extends DefineMetricInput {
  readonly origin?: MeaningDefinition['origin'];
  readonly lifecycle?: MeaningDefinition['lifecycle'];
  readonly authority?: MeaningDefinition['authority'];
  readonly scope?: MeaningScope;
  readonly assumptions?: readonly string[];
}

export interface MeaningAuthoring<C extends Catalog = Catalog> extends TypedAuthoring<C> {
  readonly defineMeaning: (input: MeaningDefinitionInput) => Outcome<MeaningDraft>;
  readonly draft: (
    meaning: MeaningDefinition,
    options?: { readonly source?: MeaningSource; readonly assumptions?: readonly string[]; readonly base?: VersionRef },
  ) => Outcome<MeaningDraft>;
  readonly edit: (
    base: MeaningDraft | MeaningDefinition,
    meaning: MeaningDefinition,
    options?: { readonly source?: MeaningSource; readonly assumptions?: readonly string[] },
  ) => Outcome<MeaningDraft>;
  readonly proposeDiff: (
    base: MeaningDraft | MeaningDefinition,
    meaning: MeaningDefinition,
    options?: { readonly source?: MeaningSource; readonly assumptions?: readonly string[] },
  ) => Outcome<MeaningDiff>;
}

export interface MeaningDiff {
  readonly version: '1';
  readonly state: 'proposed-diff';
  readonly base: MeaningDraft;
  readonly candidate: MeaningDraft;
  readonly changed: readonly string[];
}

export interface MeaningEvaluationInput {
  readonly meaning: VersionRef | MeaningDefinition;
  readonly entity: string;
  readonly source: QuerySource;
  readonly fields?: readonly string[];
  readonly groupBy?: readonly string[];
  readonly scopeDigest?: string;
  readonly policyRevision?: string;
  readonly signal?: AbortSignal;
}

export interface MeaningEvaluatorOptions {
  readonly catalog: Catalog;
  readonly registry: FunctionRegistry;
  readonly definitions?: readonly MeaningDefinition[];
  readonly policy?: SemanticPolicy;
  readonly limits?: Partial<QueryLimits>;
}

export interface MeaningEvaluator {
  readonly evaluate: (input: MeaningEvaluationInput) => Outcome<QueryResult>;
}

export type MeaningAuthoringOutcome = Outcome<MeaningDraft>;
export type MeaningDiffOutcome = Outcome<MeaningDiff>;
export type MeaningActivationOutcome = Outcome<MeaningActivationReceipt>;
export type MeaningRegistrationOutcome = Outcome<MeaningRegistrationReceipt>;
