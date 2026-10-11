import type { Diagnostic, Outcome, ReadonlyJsonValue, VersionRef } from '@varendo/core';

/** Grants are intentionally independent. A proposal grant never implies execution. */
export type ActionGrant = 'action.propose' | 'action.execute';

export type ActionSideEffect = 'none' | 'domain-write' | 'irreversible';
export type ActionConfirmationPolicy = 'none' | 'required';
export type ActionIdempotencyPolicy = 'optional' | 'required';
export type ActionEntityRevisionPolicy = 'none' | 'required';

export type ActionPayload = Readonly<Record<string, ReadonlyJsonValue>>;

/** A trusted local schema parser. It is never serialized into a proposal or receipt. */
export interface ActionSchema<T extends ActionPayload = ActionPayload> {
  readonly ref: VersionRef;
  readonly parse: (input: unknown) => Outcome<T>;
}

export interface ActionDescriptor {
  readonly ref: VersionRef;
  readonly input: VersionRef;
  readonly output: VersionRef;
  readonly sideEffect: ActionSideEffect;
  readonly confirmation: ActionConfirmationPolicy;
  readonly idempotency: ActionIdempotencyPolicy;
  readonly entityRevision: ActionEntityRevisionPolicy;
}

export interface ActionEntity {
  readonly key: string;
  readonly revision: string;
}

export interface ActionRequest<T extends ActionPayload = ActionPayload> {
  readonly requestId: string;
  readonly action: VersionRef;
  readonly input: T;
  readonly entity?: ActionEntity;
  readonly idempotencyKey?: string;
}

/** Authentication/application context. It is returned by the host, never accepted from wire input. */
export interface TrustedActionContext {
  readonly principalKey: string;
  readonly actorKey: string;
  readonly scopeDigest: string;
  readonly policyRevision: string;
  readonly domainRevision: string;
  readonly confirmationEpoch: string;
  readonly grants: readonly ActionGrant[];
  /** Current entity revisions are host supplied and are checked immediately before dispatch. */
  readonly entityRevisions?: Readonly<Record<string, string>>;
}

export interface HostContextRequest {
  readonly signal: AbortSignal;
}

export interface ActionPreview<T extends ActionPayload = ActionPayload> {
  readonly state: 'preview';
  readonly id: string;
  readonly requestId: string;
  readonly action: VersionRef;
  readonly descriptor: ActionDescriptor;
  /** The normalized input is available while the preview is live and becomes unavailable when it is consumed or revoked. */
  readonly input?: T;
  readonly entity?: ActionEntity;
  readonly idempotencyKey?: string;
  readonly sideEffect: ActionSideEffect;
  readonly confirmation: ActionConfirmationPolicy;
}

/** Metadata-only receipt. The normalized input is held privately by the boundary. */
export interface ActionReceipt {
  readonly state: 'confirmed';
  readonly id: string;
  readonly previewId: string;
  readonly action: VersionRef;
  readonly sideEffect: ActionSideEffect;
  readonly confirmation: ActionConfirmationPolicy;
}

export type ActionExecution<T extends ActionPayload = ActionPayload> =
  | { readonly state: 'executed'; readonly receiptId: string; readonly action: VersionRef; readonly output: T }
  | { readonly state: 'ambiguous'; readonly receiptId: string; readonly action: VersionRef; readonly reason: string };

export type ActionDispatchInput<T extends ActionPayload = ActionPayload> = {
  readonly descriptor: ActionDescriptor;
  readonly input: T;
  readonly entity?: ActionEntity;
  readonly idempotencyKey?: string;
  readonly context: TrustedActionContext;
  readonly signal: AbortSignal;
};

/** A host action may explicitly reject before a side effect, complete, or report uncertainty. */
export type ActionDispatchResult =
  | { readonly state: 'completed'; readonly output: unknown }
  | { readonly state: 'rejected'; readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]] }
  | { readonly state: 'ambiguous'; readonly reason: string };

export type ActionDispatch<T extends ActionPayload = ActionPayload> = (
  input: ActionDispatchInput<T>,
) => ActionDispatchResult | Promise<ActionDispatchResult>;

export interface ActionRegistration<
  TInput extends ActionPayload = ActionPayload,
  TOutput extends ActionPayload = ActionPayload,
> {
  readonly descriptor: ActionDescriptor;
  readonly inputSchema: ActionSchema<TInput>;
  readonly outputSchema: ActionSchema<TOutput>;
  readonly dispatch: ActionDispatch<TInput>;
}

export interface ActionConfirmationRequest<T extends ActionPayload = ActionPayload> {
  readonly preview: ActionPreview<T>;
  readonly context: TrustedActionContext;
  readonly signal: AbortSignal;
}

/** Returning `{ok:true}` from this trusted callback is the only way required confirmation is granted. */
export type IssueActionConfirmation = <T extends ActionPayload = ActionPayload>(
  input: ActionConfirmationRequest<T>,
) => Outcome<void> | Promise<Outcome<void>>;

interface ActionHost {
  readonly readContext: (
    input: HostContextRequest,
  ) => Outcome<TrustedActionContext> | Promise<Outcome<TrustedActionContext>>;
  readonly issueConfirmation?: IssueActionConfirmation;
}

export type ActionFailureCode =
  | 'action.invalid'
  | 'action.unknown'
  | 'action.denied'
  | 'action.stale'
  | 'action.confirmation'
  | 'action.replay'
  | 'action.idempotency'
  | 'action.in-flight'
  | 'action.ambiguous'
  | 'action.cancelled'
  | 'action.budget'
  | 'action.revoked'
  | 'action.disposed'
  | 'action.callback';

/** Boundary diagnostics are wire-shaped but always retain a bounded message. */
export type ActionFailure = Diagnostic & { readonly code: ActionFailureCode | string };

export type ActionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly [ActionFailure, ...ActionFailure[]] };

export type ActionHistoryState =
  'preview' | 'confirmed' | 'executed' | 'ambiguous' | 'rejected' | 'revoked' | 'disposed';

/** Bounded metadata only; inputs, outputs and actor identity are deliberately absent. */
export interface ActionHistoryEntry {
  readonly state: ActionHistoryState;
  readonly action: VersionRef;
  readonly previewId?: string;
  readonly receiptId?: string;
  readonly reasonCode?: string;
  readonly at: number;
}

export type ActionInspectionState = 'in-flight' | 'executed' | 'ambiguous' | 'rejected';

export interface ActionInspection {
  readonly state: ActionInspectionState;
  readonly action: VersionRef;
  readonly receiptId: string;
  readonly outputAvailable: boolean;
  readonly at: number;
}

export interface ActionReadOptions {
  readonly signal?: AbortSignal;
}

export interface ActionBoundaryOptions {
  readonly host: ActionHost;
  readonly registry: import('./registry.js').ActionRegistry;
  readonly maxPreviews?: number;
  readonly maxPending?: number;
  readonly maxHistory?: number;
  readonly maxIdempotencyEntries?: number;
  /** Maximum UTF-8 bytes retained for one canonical idempotency identity. */
  readonly maxIdentityBytes?: number;
  /** Maximum UTF-8 bytes retained across all canonical identities and outputs. */
  readonly maxLedgerBytes?: number;
  /** Maximum UTF-8 bytes retained for one action output. */
  readonly maxOutputBytes?: number;
  readonly maxInputBytes?: number;
  readonly maxCallbackMilliseconds?: number;
  readonly maxInFlight?: number;
  readonly now?: () => number;
}

export interface ActionPort {
  preview(request: ActionRequest, options?: { readonly signal?: AbortSignal }): Promise<ActionOutcome<ActionPreview>>;
  preview(request: unknown, options?: { readonly signal?: AbortSignal }): Promise<ActionOutcome<ActionPreview>>;
  previewInteraction(
    input: unknown,
    options?: {
      readonly signal?: AbortSignal;
      readonly entity?: ActionEntity;
      readonly idempotencyKey?: string;
    },
  ): Promise<ActionOutcome<ActionPreview>>;
  /** Discard one live preview token without revoking unrelated actions. */
  cancel(preview: ActionPreview): boolean;
  confirm(preview: ActionPreview, options?: { readonly signal?: AbortSignal }): Promise<ActionOutcome<ActionReceipt>>;
  execute(receipt: ActionReceipt, options?: { readonly signal?: AbortSignal }): Promise<ActionOutcome<ActionExecution>>;
  inspect(idempotencyKey: string, options?: ActionReadOptions): Promise<ActionOutcome<ActionInspection | undefined>>;
  history(options?: ActionReadOptions): Promise<ActionOutcome<readonly ActionHistoryEntry[]>>;
  revoke(reason?: string): boolean;
  dispose(): void;
}
