import { parseInteraction } from '@varendo/core';
import { resolveRegisteredAction } from './registry.js';
import type {
  ActionEntity,
  ActionOutcome,
  ActionPayload,
  ActionPreview,
  ActionReceipt,
  ActionRegistration,
  TrustedActionContext,
} from './types.js';
import {
  cloneRef,
  grantsInclude,
  normalizeOutcome,
  frozen,
  partition,
  previewRecords,
  request,
  sameContext,
} from './boundary-common.js';
import type { ParsedRequest, PreviewRecord, ReceiptRecord } from './boundary-common.js';
import { ActionPortBase } from './boundary-base.js';

interface PreviewRequest {
  readonly parsed: ParsedRequest;
  readonly registration: ActionRegistration;
}

interface PreparedPreview extends PreviewRequest {
  readonly context: TrustedActionContext;
  readonly input: ActionPayload;
}

export class ActionPreviewPort extends ActionPortBase {
  async preview(raw: unknown, options: { readonly signal?: AbortSignal } = {}): Promise<ActionOutcome<ActionPreview>> {
    if (!this.live()) return this.lifecycle();
    if (!this.reservePreview()) return this.outcome('action.budget', 'The action preview budget is full.');
    try {
      const prepared = await this.preparePreview(raw, options.signal);
      if (!prepared.ok) return prepared;
      return this.publishPreview(prepared.value, options.signal);
    } finally {
      this.releasePreviewReservation();
    }
  }

  private resolvePreviewRequest(raw: unknown, signal?: AbortSignal): ActionOutcome<PreviewRequest> {
    const parsed = request(raw);
    if (!parsed.ok) return parsed;
    if (signal?.aborted)
      return this.outcome('action.cancelled', 'The action preview was cancelled during request validation.');
    const registration = resolveRegisteredAction(this.registry, parsed.value.action);
    if (registration === undefined)
      return this.outcome('action.unknown', 'The requested action version is not registered.');
    if (registration.descriptor.idempotency === 'required' && parsed.value.idempotencyKey === undefined)
      return this.outcome('action.invalid', 'This action requires an idempotency key.');
    if (registration.descriptor.entityRevision === 'required' && parsed.value.entity === undefined)
      return this.outcome('action.invalid', 'This action requires an entity revision.');
    return { ok: true, value: { parsed: parsed.value, registration } };
  }

  private async preparePreview(raw: unknown, signal?: AbortSignal): Promise<ActionOutcome<PreparedPreview>> {
    const requestValue = this.resolvePreviewRequest(raw, signal);
    if (!requestValue.ok) return requestValue;
    const current = await this.readContext(signal);
    if (!current.ok) return current;
    if (!grantsInclude(current.value, 'action.propose'))
      return this.outcome('action.denied', 'The host did not grant action proposal.');
    if (!this.live()) return this.lifecycle();
    const input = this.normalizedInput(requestValue.value.registration, requestValue.value.parsed.input);
    if (!this.live()) return this.lifecycle();
    if (signal?.aborted)
      return this.outcome('action.cancelled', 'The action preview was cancelled during input validation.');
    if (!input.ok) return input;
    return { ok: true, value: { ...requestValue.value, context: current.value, input: input.value } };
  }

  private publishPreview(prepared: PreparedPreview, signal?: AbortSignal): ActionOutcome<ActionPreview> {
    if (this.previews.size >= this.maxPreviews || this.previews.size + this.receipts.size >= this.maxPending)
      return this.outcome('action.budget', 'The action preview budget is full.');
    if (!this.live()) return this.lifecycle();
    const at = this.clock();
    if (!at.ok) return this.outcome('action.callback', 'The action clock callback failed.');
    if (!this.live()) return this.lifecycle();
    if (signal?.aborted)
      return this.outcome('action.cancelled', 'The action preview was cancelled before publication.');
    const record = this.createPreviewRecord(prepared);
    if (signal?.aborted)
      return this.outcome('action.cancelled', 'The action preview was cancelled before publication.');
    this.previews.set(record.id, record);
    this.addHistoryAt(
      { state: 'preview', action: cloneRef(prepared.registration.descriptor.ref), previewId: record.id },
      at.value,
      partition(prepared.context),
    );
    return { ok: true, value: record.preview };
  }

  private createPreviewRecord(prepared: PreparedPreview): PreviewRecord {
    const { parsed, registration, context: hostContext, input } = prepared;
    const id = this.nextId('preview');
    const identity =
      parsed.idempotencyKey === undefined
        ? ''
        : this.idempotencyIdentity(registration, input, parsed.entity, parsed.idempotencyKey);
    const preview = {
      state: 'preview' as const,
      id,
      requestId: parsed.requestId,
      action: cloneRef(registration.descriptor.ref),
      descriptor: registration.descriptor,
      ...(parsed.entity === undefined ? {} : { entity: parsed.entity }),
      ...(parsed.idempotencyKey === undefined ? {} : { idempotencyKey: parsed.idempotencyKey }),
      sideEffect: registration.descriptor.sideEffect,
      confirmation: registration.descriptor.confirmation,
    } as ActionPreview;
    const record: PreviewRecord = {
      id,
      requestId: parsed.requestId,
      registration,
      preview,
      input,
      inputIdentity: identity,
      context: hostContext,
      consumed: false,
      confirming: false,
    };
    previewRecords.set(preview, record);
    Object.defineProperty(preview, 'input', {
      enumerable: true,
      get(this: object): ActionPayload | undefined {
        return previewRecords.get(this)?.input;
      },
    });
    Object.freeze(preview);
    return record;
  }

  async previewInteraction(
    input: unknown,
    options: { readonly signal?: AbortSignal; readonly entity?: ActionEntity; readonly idempotencyKey?: string } = {},
  ): Promise<ActionOutcome<ActionPreview>> {
    const parsed = parseInteraction(input);
    if (!parsed.ok) return parsed as ActionOutcome<ActionPreview>;
    const payloadValue = parsed.value.payload;
    if (payloadValue.kind !== 'action-request')
      return this.outcome('action.invalid', 'The interaction does not contain an action request.');
    return this.preview(
      {
        requestId: parsed.value.eventId,
        action: payloadValue.action,
        input: payloadValue.input,
        ...(options.entity === undefined ? {} : { entity: options.entity }),
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      },
      options,
    );
  }

  cancel(preview: ActionPreview): boolean {
    if (!this.live()) return false;
    const matched = [...this.previews.values()].find((candidate) => candidate.preview === preview);
    if (matched === undefined || matched.consumed || matched.confirming) return false;
    this.consumePreview(matched);
    this.tryHistory(
      {
        state: 'rejected',
        action: cloneRef(matched.registration.descriptor.ref),
        previewId: matched.id,
        reasonCode: 'action.cancelled',
      },
      partition(matched.context),
    );
    return true;
  }

  async confirm(
    preview: ActionPreview,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<ActionOutcome<ActionReceipt>> {
    const matched = this.beginConfirmation(preview);
    if (!matched.ok) return matched;
    try {
      return await this.confirmMatched(matched.value, options.signal);
    } finally {
      if (!matched.value.consumed) matched.value.confirming = false;
    }
  }

  private beginConfirmation(preview: ActionPreview): ActionOutcome<PreviewRecord> {
    if (!this.live()) return this.lifecycle();
    const matched = [...this.previews.values()].find((candidate) => candidate.preview === preview);
    if (matched === undefined || matched.consumed)
      return this.outcome('action.invalid', 'The action preview token is not recognized.');
    if (matched.confirming) return this.outcome('action.in-flight', 'The action preview is already being confirmed.');
    matched.confirming = true;
    return { ok: true, value: matched };
  }

  private async confirmMatched(matched: PreviewRecord, signal?: AbortSignal): Promise<ActionOutcome<ActionReceipt>> {
    const current = await this.readContext(signal);
    if (!current.ok) return current;
    const valid = this.validateConfirmationContext(matched, current.value);
    if (!valid.ok) return valid;
    const issued = await this.requestHostConfirmation(matched, current.value, signal);
    if (!issued.ok) return issued;
    const rechecked = await this.recheckConfirmation(matched, current.value, signal);
    if (!rechecked.ok) return rechecked;
    return this.issueReceipt(matched, rechecked.value, signal);
  }

  private validateConfirmationContext(matched: PreviewRecord, current: TrustedActionContext): ActionOutcome<void> {
    if (!this.live()) return this.lifecycle();
    if (!grantsInclude(current, 'action.propose') || !grantsInclude(current, 'action.execute'))
      return this.outcome('action.denied', 'The host did not grant both proposal and execution for confirmation.');
    const registration = resolveRegisteredAction(this.registry, matched.registration.descriptor.ref);
    if (sameContext(matched.context, current) && registration === matched.registration)
      return { ok: true, value: undefined };
    this.rejectPreview(matched, current, 'action.stale');
    return this.outcome('action.stale', 'The action preview is stale against the current host context.');
  }

  private async requestHostConfirmation(
    matched: PreviewRecord,
    current: TrustedActionContext,
    signal?: AbortSignal,
  ): Promise<ActionOutcome<void>> {
    if (matched.registration.descriptor.confirmation !== 'required') return { ok: true, value: undefined };
    if (this.host.issueConfirmation === undefined)
      return this.outcome('action.confirmation', 'This action requires a trusted confirmation callback.');
    const issued = await this.callHost(
      (hostSignal) => this.host.issueConfirmation!({ preview: matched.preview, context: current, signal: hostSignal }),
      signal,
    );
    const callFailure = this.confirmationCallFailure(issued.state);
    if (callFailure !== undefined) return callFailure;
    if (!this.live()) return this.lifecycle();
    if (signal?.aborted) return this.outcome('action.cancelled', 'The action confirmation was cancelled.');
    const outcome = normalizeOutcome<unknown>((issued as { readonly value: unknown }).value);
    if (outcome === undefined || !outcome.ok)
      return this.outcome('action.confirmation', 'The trusted host did not confirm this action.');
    return this.live() ? { ok: true, value: undefined } : this.lifecycle();
  }

  private confirmationCallFailure(state: string): ActionOutcome<void> | undefined {
    switch (state) {
      case 'completed':
        return undefined;
      case 'lifecycle':
        return this.lifecycle();
      case 'cancelled':
        return this.outcome('action.cancelled', 'The action confirmation was cancelled.');
      case 'budget':
        return this.outcome('action.budget', 'The host callback budget is full.');
      default:
        return this.outcome('action.budget', 'The action confirmation exceeded its bounded time budget.');
    }
  }

  private async recheckConfirmation(
    matched: PreviewRecord,
    original: TrustedActionContext,
    signal?: AbortSignal,
  ): Promise<ActionOutcome<TrustedActionContext>> {
    const current = await this.readContext(signal);
    if (!current.ok) {
      this.rejectPreview(matched, original, 'action.stale');
      return current;
    }
    if (!this.live()) return this.lifecycle();
    if (signal?.aborted) return this.outcome('action.cancelled', 'The action confirmation was cancelled.');
    if (!grantsInclude(current.value, 'action.propose') || !grantsInclude(current.value, 'action.execute')) {
      this.rejectPreview(matched, current.value, 'action.denied');
      return this.outcome('action.denied', 'The host no longer grants both proposal and execution for confirmation.');
    }
    if (!sameContext(original, current.value)) {
      this.rejectPreview(matched, current.value, 'action.stale');
      return this.outcome('action.stale', 'The action confirmation context changed before a receipt was issued.');
    }
    return current;
  }

  private rejectPreview(matched: PreviewRecord, current: TrustedActionContext, reasonCode: string): void {
    this.consumePreview(matched);
    this.tryHistory(
      {
        state: 'rejected',
        action: cloneRef(matched.registration.descriptor.ref),
        previewId: matched.id,
        reasonCode,
      },
      partition(current),
    );
  }

  private issueReceipt(
    matched: PreviewRecord,
    current: TrustedActionContext,
    signal?: AbortSignal,
  ): ActionOutcome<ActionReceipt> {
    if (this.receipts.size >= this.maxPending)
      return this.outcome('action.budget', 'The pending action receipt budget is full.');
    const historyAt = this.clock();
    if (!historyAt.ok) return this.outcome('action.callback', 'The action clock callback failed.');
    if (!this.live()) return this.lifecycle();
    if (signal?.aborted)
      return this.outcome('action.cancelled', 'The action confirmation was cancelled before receipt issuance.');
    const input = matched.input;
    if (input === undefined) return this.outcome('action.replay', 'The action preview input is no longer available.');
    this.consumePreview(matched);
    const receipt = this.createReceiptRecord(matched, input, current);
    this.receipts.set(receipt.id, receipt);
    this.addHistoryAt(
      {
        state: 'confirmed',
        action: cloneRef(matched.registration.descriptor.ref),
        previewId: matched.id,
        receiptId: receipt.id,
      },
      historyAt.value,
      partition(current),
    );
    return { ok: true, value: receipt.receipt };
  }

  private createReceiptRecord(
    matched: PreviewRecord,
    input: ActionPayload,
    current: TrustedActionContext,
  ): ReceiptRecord {
    const id = this.nextId('receipt');
    const receipt = frozen({
      state: 'confirmed' as const,
      id,
      previewId: matched.id,
      action: cloneRef(matched.registration.descriptor.ref),
      sideEffect: matched.registration.descriptor.sideEffect,
      confirmation: matched.registration.descriptor.confirmation,
    });
    return {
      id,
      previewId: matched.id,
      registration: matched.registration,
      receipt,
      input,
      inputIdentity: matched.inputIdentity,
      ...(matched.preview.entity === undefined ? {} : { entity: matched.preview.entity }),
      ...(matched.preview.idempotencyKey === undefined ? {} : { idempotencyKey: matched.preview.idempotencyKey }),
      context: current,
      consumed: false,
      executing: false,
    };
  }
}
