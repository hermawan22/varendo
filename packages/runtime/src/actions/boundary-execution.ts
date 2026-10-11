import type { Diagnostic, Outcome, VersionRef } from '@varendo/core';
import { resolveRegisteredAction } from './registry.js';
import type {
  ActionDispatchResult,
  ActionExecution,
  ActionFailure,
  ActionOutcome,
  ActionPayload,
  ActionReceipt,
  TrustedActionContext,
} from './types.js';
import {
  bytes,
  canonical,
  cloneRef,
  copyDiagnostics,
  diagnostic,
  dispatchFailureReason,
  grantsInclude,
  normalizeDispatch,
  normalizeOutcome,
  payload,
  partition,
  sameContext,
} from './boundary-common.js';
import type { ActionPartition, LedgerRecord, ReceiptRecord } from './boundary-common.js';
import { entityCurrent, idempotencyKey } from './boundary-execution-identity.js';
import { ActionPreviewPort } from './boundary-preview.js';

interface DispatchPlan {
  readonly kind: 'dispatch';
  readonly record: ReceiptRecord;
  readonly context: TrustedActionContext;
  readonly input: ActionPayload;
  readonly ledgerKey?: string;
}

type ExecutionSetup = { readonly kind: 'result'; readonly result: ActionOutcome<ActionExecution> } | DispatchPlan;

export class ActionExecutionPort extends ActionPreviewPort {
  async execute(
    receipt: ActionReceipt,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<ActionOutcome<ActionExecution>> {
    const setup = await this.prepareExecution(receipt, options.signal);
    if (!setup.ok) return setup;
    if (setup.value.kind === 'result') return setup.value.result;
    return this.dispatchPrepared(setup.value, options.signal);
  }

  private async prepareExecution(receipt: ActionReceipt, signal?: AbortSignal): Promise<ActionOutcome<ExecutionSetup>> {
    const matched = this.findExecutableReceipt(receipt);
    if (!matched.ok) return matched;
    matched.value.executing = true;
    const current = await this.authorizeReceipt(matched.value, signal);
    if (!current.ok) return current;
    const key = matched.value.idempotencyKey;
    if (key === undefined) return this.dispatchPlan(matched.value, current.value);
    const ledgerKey = idempotencyKey(current.value, key);
    const replay = this.replayExisting(matched.value, ledgerKey);
    if (replay !== undefined) return { ok: true, value: { kind: 'result', result: replay } };
    const reserved = this.reserveIdempotency(matched.value, current.value, ledgerKey, key);
    if (!reserved.ok) return reserved;
    return this.dispatchPlan(matched.value, current.value, ledgerKey);
  }

  private findExecutableReceipt(receipt: ActionReceipt): ActionOutcome<ReceiptRecord> {
    if (!this.live()) return this.lifecycle();
    const matched = [...this.receipts.values()].find((candidate) => candidate.receipt === receipt);
    if (matched === undefined || matched.consumed || matched.input === undefined)
      return this.outcome('action.replay', 'The action receipt is unknown or has already been used.');
    if (matched.executing) return this.outcome('action.in-flight', 'The action receipt is already executing.');
    return { ok: true, value: matched };
  }

  private async authorizeReceipt(
    matched: ReceiptRecord,
    signal?: AbortSignal,
  ): Promise<ActionOutcome<TrustedActionContext>> {
    const current = await this.readContext(signal);
    if (!current.ok) {
      this.consumeReceipt(matched);
      return current;
    }
    if (!this.isCurrentReceipt(matched, current.value)) return this.staleReceipt(matched, current.value);
    if (!this.live()) {
      this.consumeReceipt(matched);
      return this.lifecycle();
    }
    if (signal?.aborted) {
      this.consumeReceipt(matched);
      return this.outcome('action.cancelled', 'The action execution was cancelled before dispatch.');
    }
    return current;
  }

  private isCurrentReceipt(record: ReceiptRecord, current: TrustedActionContext): boolean {
    return (
      grantsInclude(current, 'action.execute') &&
      sameContext(record.context, current) &&
      resolveRegisteredAction(this.registry, record.registration.descriptor.ref) === record.registration &&
      entityCurrent(record, current)
    );
  }

  private staleReceipt(record: ReceiptRecord, current: TrustedActionContext): ActionOutcome<never> {
    this.consumeReceipt(record);
    this.tryHistory(
      {
        state: 'rejected',
        action: cloneRef(record.registration.descriptor.ref),
        receiptId: record.id,
        reasonCode: 'action.stale',
      },
      partition(current),
    );
    return this.outcome('action.stale', 'The action receipt is stale against current authority or entity revision.');
  }

  private replayExisting(record: ReceiptRecord, ledgerKey: string): ActionOutcome<ActionExecution> | undefined {
    const existing = this.idempotency.get(ledgerKey);
    if (existing === undefined) return undefined;
    this.consumeReceipt(record);
    if (existing.identity !== record.inputIdentity)
      return this.outcome(
        'action.idempotency',
        'The idempotency key was reused with different action identity or input.',
      );
    switch (existing.state) {
      case 'in-flight':
        return this.outcome('action.in-flight', 'An action with this idempotency key is already executing.');
      case 'ambiguous':
        return {
          ok: true,
          value: {
            state: 'ambiguous',
            receiptId: record.id,
            action: cloneRef(existing.action),
            reason: existing.reason ?? 'The prior action execution is uncertain.',
          },
        };
      case 'rejected':
        return {
          ok: false,
          diagnostics: existing.diagnostics ?? [
            diagnostic('action.callback', 'The prior action execution was rejected.'),
          ],
        };
      case 'executed':
        if (existing.output === undefined)
          return this.outcome('action.ambiguous', 'The completed action output is unavailable for safe replay.');
        return {
          ok: true,
          value: {
            state: 'executed',
            receiptId: record.id,
            action: cloneRef(existing.action),
            output: existing.output,
          },
        };
    }
  }

  private reserveIdempotency(
    record: ReceiptRecord,
    current: TrustedActionContext,
    ledgerKey: string,
    key: string,
  ): ActionOutcome<void> {
    if (this.idempotency.size >= this.maxIdempotencyEntries) {
      this.consumeReceipt(record);
      return this.outcome('action.budget', 'The idempotency ledger is full; no new action is admitted.');
    }
    const identityBytes = bytes(record.inputIdentity);
    const at = this.clock();
    if (!at.ok) {
      this.consumeReceipt(record);
      return this.outcome('action.callback', 'The action clock callback failed.');
    }
    if (!this.live()) {
      this.consumeReceipt(record);
      return this.lifecycle();
    }
    const metadataBytes = this.ledgerMetadataBytes(
      ledgerKey,
      key,
      record.registration.descriptor.ref,
      record.id,
      at.value,
      partition(current),
    );
    if (
      identityBytes > this.maxIdentityBytes ||
      this.ledgerBytes + identityBytes + metadataBytes > this.maxLedgerBytes
    ) {
      this.consumeReceipt(record);
      return this.outcome('action.budget', 'The idempotency identity exceeds the bounded ledger budget.');
    }
    this.idempotency.set(ledgerKey, {
      key,
      identity: record.inputIdentity,
      partition: partition(current),
      identityBytes,
      metadataBytes,
      action: cloneRef(record.registration.descriptor.ref),
      receiptId: record.id,
      at: at.value,
      state: 'in-flight',
    });
    this.ledgerBytes += identityBytes + metadataBytes;
    return { ok: true, value: undefined };
  }

  private dispatchPlan(
    record: ReceiptRecord,
    current: TrustedActionContext,
    ledgerKey?: string,
  ): ActionOutcome<ExecutionSetup> {
    if (record.input === undefined)
      return this.outcome('action.replay', 'The action receipt input is no longer available.');
    return {
      ok: true,
      value: {
        kind: 'dispatch',
        record,
        context: current,
        input: record.input,
        ...(ledgerKey === undefined ? {} : { ledgerKey }),
      },
    };
  }

  private async dispatchPrepared(plan: DispatchPlan, signal?: AbortSignal): Promise<ActionOutcome<ActionExecution>> {
    const barrier = this.dispatchBarrier(plan, signal);
    if (!barrier.ok) return barrier;
    const call = await this.callHost(
      (hostSignal) =>
        plan.record.registration.dispatch({
          descriptor: plan.record.registration.descriptor,
          input: plan.input,
          ...(plan.record.entity === undefined ? {} : { entity: plan.record.entity }),
          ...(plan.record.idempotencyKey === undefined ? {} : { idempotencyKey: plan.record.idempotencyKey }),
          context: plan.context,
          signal: hostSignal,
        }),
      signal,
    );
    if (call.state !== 'completed') return this.dispatchCallFailure(plan, call.state);
    return this.finishDispatch(plan, normalizeDispatch(call.value), signal);
  }

  private dispatchBarrier(plan: DispatchPlan, signal?: AbortSignal): ActionOutcome<void> {
    const at = this.clock();
    if (!at.ok) return this.rejectBeforeDispatch(plan, 'action.callback', 'The action clock callback failed.');
    if (!this.live() || plan.record.input === undefined)
      return this.rejectBeforeDispatch(plan, 'action.revoked', 'The action port has been revoked or disposed.');
    if (this.activeCalls.size >= this.maxInFlight)
      return this.rejectBeforeDispatch(plan, 'action.budget', 'The action callback budget is full.');
    if (signal?.aborted)
      return this.rejectBeforeDispatch(plan, 'action.cancelled', 'The action execution was cancelled before dispatch.');
    return { ok: true, value: undefined };
  }

  private rejectBeforeDispatch(plan: DispatchPlan, code: string, message: string): ActionOutcome<void> {
    if (plan.ledgerKey !== undefined) this.removeLedger(plan.ledgerKey);
    this.consumeReceipt(plan.record);
    if (code === 'action.revoked') return this.lifecycle();
    return this.outcome(code, message);
  }

  private dispatchCallFailure(
    plan: DispatchPlan,
    state: 'cancelled' | 'timeout' | 'lifecycle' | 'budget',
  ): ActionOutcome<ActionExecution> {
    if (state === 'budget') {
      if (plan.ledgerKey !== undefined) this.removeLedger(plan.ledgerKey);
      this.consumeReceipt(plan.record);
      return this.outcome('action.budget', 'The host callback budget is full.');
    }
    return this.ambiguousResult(plan.record, plan.ledgerKey, dispatchFailureReason(state));
  }

  private finishDispatch(
    plan: DispatchPlan,
    dispatch: ActionDispatchResult | undefined,
    signal?: AbortSignal,
  ): ActionOutcome<ActionExecution> {
    if (signal?.aborted)
      return this.ambiguousResult(plan.record, plan.ledgerKey, 'The action execution was cancelled after dispatch.');
    if (!this.live())
      return this.ambiguousResult(
        plan.record,
        plan.ledgerKey,
        'The action port was revoked or disposed after dispatch completed.',
      );
    if (dispatch === undefined)
      return this.ambiguousResult(
        plan.record,
        plan.ledgerKey,
        'The host action returned an invalid result after dispatch.',
      );
    switch (dispatch.state) {
      case 'ambiguous':
        return this.ambiguousResult(plan.record, plan.ledgerKey, dispatch.reason);
      case 'rejected':
        return this.rejectDispatch(plan, dispatch.diagnostics);
      case 'completed':
        return this.completeDispatch(plan, dispatch.output, signal);
    }
  }

  private rejectDispatch(plan: DispatchPlan, values: readonly Diagnostic[]): ActionOutcome<ActionExecution> {
    const diagnostics = copyDiagnostics(values);
    const entry = plan.ledgerKey === undefined ? undefined : this.idempotency.get(plan.ledgerKey);
    if (entry !== undefined) this.recordRejection(entry, diagnostics);
    this.consumeReceipt(plan.record);
    this.tryHistory(
      {
        state: 'rejected',
        action: cloneRef(plan.record.registration.descriptor.ref),
        receiptId: plan.record.id,
        reasonCode: 'action.callback',
      },
      partition(plan.context),
    );
    return { ok: false, diagnostics };
  }

  private recordRejection(entry: LedgerRecord, diagnostics: readonly [ActionFailure, ...ActionFailure[]]): void {
    entry.state = 'rejected';
    const diagnosticsBytes = bytes(canonical(diagnostics));
    if (this.ledgerBytes + diagnosticsBytes > this.maxLedgerBytes) return;
    entry.diagnostics = diagnostics;
    entry.diagnosticsBytes = diagnosticsBytes;
    this.ledgerBytes += diagnosticsBytes;
  }

  private completeDispatch(
    plan: DispatchPlan,
    rawOutput: unknown,
    signal?: AbortSignal,
  ): ActionOutcome<ActionExecution> {
    const output = this.validateOutput(plan.record, rawOutput);
    if (signal?.aborted)
      return this.ambiguousResult(plan.record, plan.ledgerKey, 'The action execution was cancelled after dispatch.');
    if (!this.live())
      return this.ambiguousResult(
        plan.record,
        plan.ledgerKey,
        'The action port was revoked or disposed during output validation.',
      );
    if (output === undefined)
      return this.ambiguousResult(
        plan.record,
        plan.ledgerKey,
        'The host action returned an invalid output after dispatch.',
      );
    return this.publishExecution(plan, output, signal);
  }

  private validateOutput(record: ReceiptRecord, rawOutput: unknown): ActionPayload | undefined {
    let parsed: Outcome<unknown> | undefined;
    try {
      parsed = record.registration.outputSchema.parse(rawOutput);
    } catch {
      return undefined;
    }
    const result = parsed === undefined ? undefined : normalizeOutcome<unknown>(parsed);
    if (result === undefined || !result.ok) return undefined;
    const checked = payload(result.value);
    return checked.ok ? checked.value : undefined;
  }

  private publishExecution(
    plan: DispatchPlan,
    output: ActionPayload,
    signal?: AbortSignal,
  ): ActionOutcome<ActionExecution> {
    const outputBytes = bytes(canonical(output));
    if (outputBytes > this.maxOutputBytes || this.exceedsLedgerBudget(plan.ledgerKey, outputBytes))
      return this.ambiguousResult(
        plan.record,
        plan.ledgerKey,
        'The host action output exceeded its bounded retention budget after dispatch.',
      );
    const at = this.clock();
    if (!at.ok)
      return this.ambiguousResult(
        plan.record,
        plan.ledgerKey,
        'The action clock callback failed after dispatch.',
        false,
      );
    if (!this.live())
      return this.ambiguousResult(
        plan.record,
        plan.ledgerKey,
        'The action port was revoked or disposed after dispatch completed.',
      );
    if (signal?.aborted)
      return this.ambiguousResult(plan.record, plan.ledgerKey, 'The action execution was cancelled after dispatch.');
    this.recordExecution(plan, output, outputBytes);
    this.consumeReceipt(plan.record);
    this.addHistoryAt(
      { state: 'executed', action: cloneRef(plan.record.registration.descriptor.ref), receiptId: plan.record.id },
      at.value,
      partition(plan.context),
    );
    return {
      ok: true,
      value: {
        state: 'executed',
        receiptId: plan.record.id,
        action: cloneRef(plan.record.registration.descriptor.ref),
        output,
      },
    };
  }

  private exceedsLedgerBudget(ledgerKey: string | undefined, outputBytes: number): boolean {
    return ledgerKey !== undefined && this.ledgerBytes + outputBytes > this.maxLedgerBytes;
  }

  private recordExecution(plan: DispatchPlan, output: ActionPayload, outputBytes: number): void {
    if (plan.ledgerKey === undefined) return;
    const entry = this.idempotency.get(plan.ledgerKey);
    if (entry === undefined) return;
    entry.state = 'executed';
    entry.output = output;
    entry.outputBytes = outputBytes;
    this.ledgerBytes += outputBytes;
  }

  private ledgerMetadataBytes(
    ledgerKey: string,
    key: string,
    action: VersionRef,
    receiptId: string,
    at: number,
    historyPartition: ActionPartition,
  ): number {
    // Count the map key and the bounded metadata retained alongside it. This
    // keeps the aggregate ledger budget honest even for rejected/ambiguous
    // entries that have no output payload.
    return bytes(canonical({ ledgerKey, key, action, receiptId, at, partition: historyPartition }));
  }

  private removeLedger(key: string): void {
    const entry = this.idempotency.get(key);
    if (entry === undefined) return;
    this.ledgerBytes -=
      entry.identityBytes +
      entry.metadataBytes +
      (entry.outputBytes ?? 0) +
      (entry.reasonBytes ?? 0) +
      (entry.diagnosticsBytes ?? 0);
    if (this.ledgerBytes < 0) this.ledgerBytes = 0;
    this.idempotency.delete(key);
  }

  private markAmbiguous(key: string | undefined, reason: string): void {
    if (key === undefined) return;
    const entry = this.idempotency.get(key);
    if (entry === undefined) return;
    if (entry.output !== undefined) {
      this.ledgerBytes -= entry.outputBytes ?? 0;
      if (this.ledgerBytes < 0) this.ledgerBytes = 0;
      delete entry.output;
      delete entry.outputBytes;
    }
    if (entry.reason !== undefined) {
      this.ledgerBytes -= entry.reasonBytes ?? 0;
      if (this.ledgerBytes < 0) this.ledgerBytes = 0;
      delete entry.reason;
      delete entry.reasonBytes;
    }
    entry.state = 'ambiguous';
    const reasonBytes = bytes(canonical(reason));
    if (this.ledgerBytes + reasonBytes <= this.maxLedgerBytes) {
      entry.reason = reason;
      entry.reasonBytes = reasonBytes;
      this.ledgerBytes += reasonBytes;
    }
  }

  private ambiguousResult(
    record: ReceiptRecord,
    ledgerKey: string | undefined,
    reason: string,
    recordHistory = true,
    historyPartition = partition(record.context),
  ): ActionOutcome<ActionExecution> {
    this.markAmbiguous(ledgerKey, reason);
    this.consumeReceipt(record);
    if (recordHistory)
      this.tryHistory(
        {
          state: 'ambiguous',
          action: cloneRef(record.registration.descriptor.ref),
          receiptId: record.id,
          reasonCode: 'action.ambiguous',
        },
        historyPartition,
      );
    return {
      ok: true,
      value: { state: 'ambiguous', receiptId: record.id, action: cloneRef(record.registration.descriptor.ref), reason },
    };
  }

  private consumeReceipt(record: ReceiptRecord): void {
    if (record.consumed) return;
    record.consumed = true;
    record.executing = false;
    record.input = undefined;
    this.receipts.delete(record.id);
  }
}
