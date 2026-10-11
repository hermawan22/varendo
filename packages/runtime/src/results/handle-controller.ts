import type { Result } from '@varendo/core';
import type { CarryData, Outcome, ResultCell, ResultRow } from './internal-types.js';
import { ResultHandleBase } from './handle-base.js';
import {
  byteLength,
  failure,
  frozen,
  makeDiagnostic,
  parseAndFreezeEvent,
  sameRef,
  statusForError,
} from './store-utils.js';
import {
  validateBatchHeader,
  validateResultCompletion,
  validateResultDescriptor,
  validateResultProgress,
  validateResultRow,
} from './result-validation.js';
import type { ResultBatch, ResultBeginInput, ResultEvent } from './types.js';
import type { InternalStore } from './internal-types.js';

interface PreparedBatch {
  readonly event: ResultBatch;
  readonly identityKeys: ReadonlySet<string>;
  readonly bytes: number;
}

function stripIdentityKeys(row: Record<string, ResultCell>): void {
  for (const key of Object.keys(row)) {
    if (key.startsWith('\u0000identity:')) delete row[key];
  }
}

function prepareBatchRows(
  event: ResultBatch,
  descriptor: Result,
  seenIdentity: ReadonlySet<string>,
): Outcome<PreparedBatch> {
  const identityKeys = new Set<string>();
  const rows: ResultRow[] = [];
  for (const row of event.rows) {
    const checked = validateResultRow(row as Record<string, unknown>, descriptor);
    if (!checked.ok) return { ok: false, diagnostics: checked.diagnostics };
    const rowValue = checked.value;
    const identity = JSON.stringify(descriptor.identity.map((field) => rowValue[`\u0000identity:${field}`]));
    if (descriptor.identity.length > 0) {
      if (identityKeys.has(identity) || seenIdentity.has(identity))
        return failure('data.result-identity', 'Result batches contain duplicate identity tuples.');
      identityKeys.add(identity);
    }
    stripIdentityKeys(rowValue);
    rows.push(rowValue);
  }
  const normalized = frozen({ ...event, rows: frozen(rows) }) as ResultBatch;
  return {
    ok: true,
    value: { event: normalized, identityKeys, bytes: byteLength(normalized) },
  };
}

export class ResultHandleController extends ResultHandleBase {
  private readonly requestId: string;

  constructor(store: InternalStore, input: ResultBeginInput, generation: number, carry: CarryData | undefined) {
    super(store, input, generation, carry);
    this.requestId = input.requestId;
  }

  private async ingestDescriptor(
    event: Extract<ResultEvent, { readonly kind: 'descriptor' }>,
  ): Promise<Outcome<ResultEvent>> {
    // A descriptor starts a replacement snapshot. A failed replacement falls
    // back to the previous authorized snapshot rather than exposing partial data.
    const priorCarry = this.carry;
    this.showingCarry = false;
    this.carry = priorCarry;
    this.state = this.emptyState('loading');
    const checked = await validateResultDescriptor(event.descriptor, this.key, this.populationDigest);
    if (!checked.ok) {
      this.restoreCarry('failed', checked.diagnostics[0]);
      return { ok: false, diagnostics: checked.diagnostics };
    }
    this.state.descriptor = event.descriptor;
    this.state.bytes = byteLength(event.descriptor);
    if (this.store.totalBytes() > this.store.maxBytes) return this.rejectDescriptorBudget();
    return { ok: true, value: event };
  }

  private rejectDescriptorBudget(): Outcome<ResultEvent> {
    const message = 'The result descriptor exceeds the bounded store byte budget.';
    if (this.carry === undefined) this.state.descriptor = undefined;
    this.restoreCarry('failed', makeDiagnostic('data.result-budget', message));
    return failure('data.result-budget', message);
  }

  private ingestBatch(event: ResultBatch): Outcome<ResultEvent> {
    const descriptor = this.state.descriptor;
    if (descriptor === undefined)
      return this.invalid('data.result-order', 'A result batch arrived before its descriptor.');
    const header = validateBatchHeader(event, descriptor, this.state.nextSequence, this.state.loadedRows);
    if (!header.ok) return this.invalid(header.diagnostics[0].code, header.diagnostics[0].message);
    const prepared = prepareBatchRows(event, descriptor, this.state.seenIdentity);
    if (!prepared.ok) return this.invalid(prepared.diagnostics[0].code, prepared.diagnostics[0].message);
    if (this.exceedsBatchBudget(prepared.value.bytes))
      return this.invalid('data.result-budget', 'Result batches exceed the bounded store byte budget.');
    this.commitBatch(prepared.value);
    return { ok: true, value: prepared.value.event };
  }

  private exceedsBatchBudget(bytes: number): boolean {
    return this.state.bytes + bytes > this.store.maxBytes || this.store.totalBytes() + bytes > this.store.maxBytes;
  }

  private commitBatch(batch: PreparedBatch): void {
    for (const identity of batch.identityKeys) this.state.seenIdentity.add(identity);
    this.state.nextSequence += 1;
    this.state.loadedRows += batch.event.rows.length;
    this.state.batches = Object.freeze([...this.state.batches, batch.event]);
    this.state.bytes += batch.bytes;
    this.state.status = 'partial';
  }

  private ingestProgress(event: Extract<ResultEvent, { readonly kind: 'progress' }>): Outcome<ResultEvent> {
    const descriptor = this.state.descriptor;
    if (descriptor === undefined)
      return this.invalid('data.result-order', 'A result progress event arrived before its descriptor.');
    if (!sameRef(descriptor.ref, event.result))
      return this.invalid('data.result-lineage', 'The result progress belongs to another result handle.');
    const prior = this.state.progress.get(event.unit) ?? 0;
    const checked = validateResultProgress(event, descriptor, prior);
    if (!checked.ok) return this.invalid(checked.diagnostics[0].code, checked.diagnostics[0].message);
    this.state.progress.set(event.unit, event.completed);
    return { ok: true, value: event };
  }

  private ingestComplete(event: Extract<ResultEvent, { readonly kind: 'complete' }>): Outcome<ResultEvent> {
    const descriptor = this.state.descriptor;
    if (descriptor === undefined)
      return this.invalid('data.result-order', 'A result completion arrived before its descriptor.');
    const checked = validateResultCompletion(event, descriptor, this.key, this.populationDigest, this.state.loadedRows);
    if (!checked.ok) return this.invalid(checked.diagnostics[0].code, checked.diagnostics[0].message);
    const finalDescriptor = frozen({ ...descriptor, coverage: event.finalCoverage });
    const descriptorDelta = byteLength(finalDescriptor) - byteLength(descriptor);
    if (this.exceedsCompletionBudget(descriptorDelta))
      return this.invalid('data.result-budget', 'Final coverage exceeds the bounded store byte budget.');
    this.commitCompletion(event, finalDescriptor, descriptorDelta);
    return { ok: true, value: event };
  }

  private exceedsCompletionBudget(descriptorDelta: number): boolean {
    return this.store.totalBytes() + descriptorDelta - (this.carry?.bytes ?? 0) > this.store.maxBytes;
  }

  private commitCompletion(
    event: Extract<ResultEvent, { readonly kind: 'complete' }>,
    descriptor: Result,
    descriptorDelta: number,
  ): void {
    this.state.descriptor = descriptor;
    this.state.bytes += descriptorDelta;
    this.carry = undefined;
    this.state.lastEvent = event;
    this.state.terminal = true;
    this.state.status = event.finalCoverage.kind === 'complete' ? 'ready' : 'partial';
  }

  private ingestError(event: Extract<ResultEvent, { readonly kind: 'error' }>): Outcome<ResultEvent> {
    if (event.requestId !== this.requestId)
      return this.invalid('data.result-request', 'The result error belongs to another request.');
    const status = statusForError(event.error.code);
    this.state.lastEvent = event;
    this.restoreCarry(status, event.error, event);
    return { ok: true, value: event };
  }

  private async dispatchEvent(event: ResultEvent): Promise<Outcome<ResultEvent>> {
    switch (event.kind) {
      case 'descriptor':
        return this.ingestDescriptor(event);
      case 'batch':
        return this.ingestBatch(event);
      case 'progress':
        return this.ingestProgress(event);
      case 'complete':
        return this.ingestComplete(event);
      case 'error':
        return this.ingestError(event);
    }
  }

  async ingest(raw: unknown): Promise<Outcome<ResultEvent>> {
    if (!this.current()) return failure('data.stale-result', 'A stale result generation cannot commit events.');
    if (this.state.terminal)
      return failure('data.result-terminal', 'A result stream continued after its terminal event.');
    this.touch();
    const parsed = parseAndFreezeEvent(raw);
    if (!parsed.ok) {
      this.restoreCarry('failed', parsed.diagnostics[0]);
      return parsed;
    }
    const outcome = await this.dispatchEvent(parsed.value);
    if (outcome.ok) this.state.lastEvent = outcome.value;
    return outcome;
  }
}
