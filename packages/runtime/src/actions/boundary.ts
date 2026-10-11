import type {
  ActionBoundaryOptions,
  ActionHistoryEntry,
  ActionInspection,
  ActionOutcome,
  ActionPort,
  ActionReadOptions,
} from './types.js';
import { cloneRef, frozen, partition, samePartition, validId, validText } from './boundary-common.js';
import type { LedgerRecord } from './boundary-common.js';
import { ActionExecutionPort } from './boundary-execution.js';

class ActionPortImpl extends ActionExecutionPort implements ActionPort {
  async inspect(
    idempotencyKey: string,
    options: ActionReadOptions = {},
  ): Promise<ActionOutcome<ActionInspection | undefined>> {
    if (!this.live()) return this.lifecycle();
    if (!validId(idempotencyKey))
      return this.outcome('action.invalid', 'The idempotency key is not a bounded identifier.', ['idempotencyKey']);
    const current = await this.readContext(options.signal);
    if (!current.ok) return current;
    if (!this.live()) return this.lifecycle();
    if (options.signal?.aborted) return this.outcome('action.cancelled', 'The action inspection was cancelled.');
    const currentPartition = partition(current.value);
    const record = this.latestLedgerRecord(idempotencyKey, currentPartition);
    if (record === undefined) return { ok: true, value: undefined };
    return {
      ok: true,
      value: frozen({
        state: record.state,
        action: cloneRef(record.action),
        receiptId: record.receiptId,
        outputAvailable: record.output !== undefined,
        at: record.at,
      }),
    };
  }

  private latestLedgerRecord(key: string, current: ReturnType<typeof partition>): LedgerRecord | undefined {
    let latest: LedgerRecord | undefined;
    for (const candidate of this.idempotency.values()) {
      if (candidate.key !== key || !samePartition(candidate.partition, current)) continue;
      if (latest === undefined || candidate.at >= latest.at) latest = candidate;
    }
    return latest;
  }

  async history(options: ActionReadOptions = {}): Promise<ActionOutcome<readonly ActionHistoryEntry[]>> {
    if (!this.live()) return this.lifecycle();
    const current = await this.readContext(options.signal);
    if (!current.ok) return current;
    if (!this.live()) return this.lifecycle();
    if (options.signal?.aborted) return this.outcome('action.cancelled', 'The action history read was cancelled.');
    const currentPartition = partition(current.value);
    return {
      ok: true,
      value: Object.freeze(
        this.historyEntries
          .filter((record) => samePartition(record.partition, currentPartition))
          .map((record) => record.entry),
      ),
    };
  }

  revoke(reason?: string): boolean {
    if (!this.live()) return false;
    if (reason !== undefined && !validText(reason)) throw new TypeError('The revocation reason is not bounded.');
    this.epoch++;
    this.status = 'revoked';
    for (const call of [...this.activeCalls]) call.abort('lifecycle');
    for (const receipt of this.receipts.values()) {
      receipt.input = undefined;
      receipt.consumed = true;
      receipt.executing = false;
    }
    this.receipts.clear();
    for (const preview of this.previews.values()) {
      preview.input = undefined;
      preview.consumed = true;
    }
    this.previews.clear();
    // A revoked port cannot accept a replay, so release every retained
    // identity/output and let late callbacks observe an empty terminal ledger.
    this.idempotency.clear();
    this.ledgerBytes = 0;
    this.pendingPreviewReservations = 0;
    return true;
  }

  dispose(): void {
    if (!this.live()) return;
    this.epoch++;
    this.status = 'disposed';
    for (const call of [...this.activeCalls]) call.abort('lifecycle');
    for (const receipt of this.receipts.values()) {
      receipt.input = undefined;
      receipt.consumed = true;
      receipt.executing = false;
    }
    this.receipts.clear();
    for (const preview of this.previews.values()) {
      preview.input = undefined;
      preview.consumed = true;
    }
    this.previews.clear();
    this.idempotency.clear();
    this.ledgerBytes = 0;
    this.pendingPreviewReservations = 0;
  }
}

export function createActionPort(options: ActionBoundaryOptions): ActionPort {
  return new ActionPortImpl(options);
}
