import type { Outcome, ReadonlyJsonValue, VersionRef } from '@varendo/core';
import {
  ActionRegistry,
  createActionPort,
  type ActionDescriptor,
  type ActionDispatchResult,
  type ActionExecution,
  type ActionOutcome,
  type ActionPayload,
  type ActionPreview,
  type ActionRegistration,
  type ActionSchema,
  type TrustedActionContext,
} from '@varendo/runtime/actions';
import { z } from 'zod';

const REFUND_REF: VersionRef = Object.freeze({ id: 'billing.refund', revision: '1' });
const REFUND_INPUT_REF: VersionRef = Object.freeze({ id: 'billing.refund-input', revision: '1' });
const REFUND_OUTPUT_REF: VersionRef = Object.freeze({ id: 'billing.refund-output', revision: '1' });
const RefundInputSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive(),
});
const RefundOutputSchema = z.object({
  refundId: z.string().min(1),
  amount: z.number().positive(),
});

export interface RefundEffect {
  readonly refundId: string;
  readonly invoiceId: string;
  readonly amount: number;
  readonly operationKey: string;
}

/** A durable host-owned ledger that survives ActionPort recreation. */
export interface ActionBackend {
  readonly effects: readonly RefundEffect[];
  readonly forceAmbiguous: () => void;
  readonly dispatch: (input: {
    readonly invoiceId: string;
    readonly amount: number;
    readonly idempotencyKey: string;
    readonly context: TrustedActionContext;
    readonly signal: AbortSignal;
  }) => ActionDispatchResult;
}

interface MutableBackend {
  readonly effects: RefundEffect[];
  readonly operations: Map<string, { readonly refundId: string; readonly amount: number }>;
  nextRefundId: number;
  ambiguousOnce: boolean;
}

const durableBackendState = new WeakMap<ActionBackend, MutableBackend>();

function asOutcome<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

function schema<T extends ActionPayload>(ref: VersionRef, parser: z.ZodType<T>): ActionSchema<T> {
  return {
    ref,
    parse: (value) => {
      const parsed = parser.safeParse(value);
      return parsed.success
        ? asOutcome(parsed.data)
        : {
            ok: false,
            diagnostics: [{ code: 'action.input-schema', message: 'The fixture input is invalid.', retryable: false }],
          };
    },
  };
}

function outputSchema<T extends ActionPayload>(ref: VersionRef, parser: z.ZodType<T>): ActionSchema<T> {
  return {
    ref,
    parse: (value) => {
      const parsed = z.object({ ok: z.literal(true), value: parser }).safeParse(value);
      return parsed.success
        ? (parsed.data as Outcome<T>)
        : {
            ok: false,
            diagnostics: [
              { code: 'action.output-schema', message: 'The fixture output is invalid.', retryable: false },
            ],
          };
    },
  };
}

function backendFrom(existing?: ActionBackend): MutableBackend {
  if (existing !== undefined) {
    const state = durableBackendState.get(existing);
    if (state !== undefined) return state;
    throw new TypeError('The action backend does not expose a durable fixture ledger.');
  }
  const backend: MutableBackend = {
    effects: [],
    operations: new Map(),
    nextRefundId: 1,
    ambiguousOnce: false,
  };
  return backend;
}

function operationKey(input: { readonly idempotencyKey: string; readonly context: TrustedActionContext }): string {
  return JSON.stringify([
    input.context.principalKey,
    input.context.scopeDigest,
    input.context.policyRevision,
    input.idempotencyKey,
  ]);
}

function createBackend(existing?: ActionBackend): ActionBackend {
  const backend = backendFrom(existing);
  const publicBackend: ActionBackend = {
    effects: backend.effects,
    forceAmbiguous: () => {
      backend.ambiguousOnce = true;
    },
    dispatch: ({ invoiceId, amount, idempotencyKey, context, signal }) => {
      if (signal.aborted) return { state: 'ambiguous', reason: 'The backend observed cancellation.' };
      const key = operationKey({ idempotencyKey, context });
      const prior = backend.operations.get(key);
      if (prior !== undefined)
        return { state: 'completed', output: { ok: true, value: { refundId: prior.refundId, amount: prior.amount } } };
      const refundId = `refund-${backend.nextRefundId++}`;
      backend.operations.set(key, { refundId, amount });
      backend.effects.push({ refundId, invoiceId, amount, operationKey: key });
      if (backend.ambiguousOnce) {
        backend.ambiguousOnce = false;
        return { state: 'ambiguous', reason: 'The backend committed but the response was lost.' };
      }
      return { state: 'completed', output: { ok: true, value: { refundId, amount } } };
    },
  };
  durableBackendState.set(publicBackend, backend);
  return publicBackend;
}

const descriptor: ActionDescriptor = Object.freeze({
  ref: REFUND_REF,
  input: REFUND_INPUT_REF,
  output: REFUND_OUTPUT_REF,
  sideEffect: 'domain-write',
  confirmation: 'required',
  idempotency: 'required',
  entityRevision: 'required',
});

function createRegistry(backend: ActionBackend): ActionRegistry {
  const registry = new ActionRegistry();
  const registration: ActionRegistration = {
    descriptor,
    inputSchema: schema(REFUND_INPUT_REF, RefundInputSchema as z.ZodType<ActionPayload>),
    outputSchema: outputSchema(REFUND_OUTPUT_REF, RefundOutputSchema as z.ZodType<ActionPayload>),
    dispatch: ({ input, entity, idempotencyKey, context, signal }) => {
      if (entity === undefined || idempotencyKey === undefined)
        return {
          state: 'rejected',
          diagnostics: [{ code: 'fixture.invalid', message: 'Bindings are required.', retryable: false }],
        };
      return backend.dispatch({
        invoiceId: String(input.invoiceId),
        amount: Number(input.amount),
        idempotencyKey,
        context,
        signal,
      });
    },
  };
  const registered = registry.register(registration);
  if (!registered.ok) throw new TypeError(registered.diagnostics[0].message);
  return registry;
}

export interface ActionFixtureHost {
  readonly readContext: (input: { readonly signal: AbortSignal }) => Outcome<TrustedActionContext>;
  readonly approvePreview: (previewId: string) => void;
  readonly revokeExecution: () => void;
  readonly restoreExecution: () => void;
  readonly changeEntityRevision: (revision: string) => void;
}

export interface ActionFixture {
  readonly action: ActionDescriptor;
  readonly backend: ActionBackend;
  readonly host: ActionFixtureHost;
  readonly port: ReturnType<typeof createActionPort>;
  readonly previewRefund: (input?: {
    readonly invoiceId?: string;
    readonly amount?: number;
  }) => Promise<ActionOutcome<ActionPreview>>;
  readonly confirmAndExecute: (preview: ActionPreview) => Promise<ActionOutcome<ActionExecution>>;
  readonly restart: () => ActionFixture;
  readonly dispose: () => void;
}

export function createActionFixture(
  options: { readonly backend?: ActionBackend; readonly requireHostApproval?: boolean } = {},
): ActionFixture {
  const backend = createBackend(options.backend);
  const approvedPreviews = new Set<string>();
  let current: TrustedActionContext = {
    principalKey: 'principal-a',
    actorKey: 'actor-a',
    scopeDigest: 'scope-a',
    policyRevision: 'policy-a',
    domainRevision: 'domain-a',
    confirmationEpoch: 'confirmation-a',
    grants: ['action.propose', 'action.execute'],
    entityRevisions: { 'invoice-1': 'invoice-revision-1' },
  };
  const host: ActionFixtureHost = {
    readContext: ({ signal }) =>
      signal.aborted
        ? { ok: false, diagnostics: [{ code: 'fixture.cancelled', message: 'Cancelled.', retryable: false }] }
        : asOutcome(current),
    approvePreview: (previewId) => {
      approvedPreviews.add(previewId);
    },
    revokeExecution: () => {
      current = { ...current, confirmationEpoch: 'confirmation-revoked', grants: ['action.propose'] };
    },
    restoreExecution: () => {
      current = {
        ...current,
        confirmationEpoch: 'confirmation-restored',
        grants: ['action.propose', 'action.execute'],
      };
    },
    changeEntityRevision: (revision) => {
      current = { ...current, entityRevisions: { 'invoice-1': revision } };
    },
  };
  const registry = createRegistry(backend);
  const port = createActionPort({
    registry,
    host: {
      readContext: host.readContext,
      issueConfirmation: ({ preview, context: confirmationContext }) => {
        const approved = options.requireHostApproval !== true || approvedPreviews.delete(preview.id);
        return confirmationContext.grants.includes('action.execute') && approved
          ? asOutcome(undefined)
          : {
              ok: false,
              diagnostics: [
                {
                  code: 'fixture.confirmation-denied',
                  message: 'Host approval or execution authority is missing.',
                  retryable: false,
                },
              ],
            };
      },
    },
  });
  let requestSequence = 0;
  const previewRefund = (input: { readonly invoiceId?: string; readonly amount?: number } = {}) =>
    port.preview({
      requestId: `refund-request-${++requestSequence}`,
      action: descriptor.ref,
      input: { invoiceId: input.invoiceId ?? 'invoice-1', amount: input.amount ?? 25 },
      entity: { key: 'invoice-1', revision: current.entityRevisions?.['invoice-1'] ?? 'invoice-revision-1' },
      idempotencyKey: 'refund-operation-1',
    });
  const confirmAndExecute = async (preview: ActionPreview): Promise<ActionOutcome<ActionExecution>> => {
    const confirmed = await port.confirm(preview);
    if (!confirmed.ok) return { ok: false, diagnostics: confirmed.diagnostics };
    return port.execute(confirmed.value);
  };
  return {
    action: descriptor,
    backend,
    host,
    port,
    previewRefund,
    confirmAndExecute,
    restart: () =>
      createActionFixture({
        backend,
        ...(options.requireHostApproval === undefined ? {} : { requireHostApproval: options.requireHostApproval }),
      }),
    dispose: () => port.dispose(),
  };
}

export type ActionPayloadJson = Readonly<Record<string, ReadonlyJsonValue>>;
