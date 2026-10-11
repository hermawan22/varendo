import type { Diagnostic } from '@varendo/core';
import type {
  CarryData,
  InternalResultHandle,
  InternalStore,
  ManagedResultSubscription,
  MutableState,
  Outcome,
  ResultSubscriptionController,
} from './internal-types.js';
import { ResultSubscriptionImpl } from './subscription.js';
import type {
  ResultBeginInput,
  ResultCacheKey,
  ResultEvent,
  ResultLease,
  ResultSnapshot,
  ResultStatus,
  ResultSubscription,
} from './types.js';
import { frozen, makeDiagnostic, preserveOnFailure, slotKey, sourceIterator } from './store-utils.js';

export abstract class ResultHandleBase implements InternalResultHandle, ResultSubscriptionController {
  readonly key: ResultCacheKey;
  readonly generation: number;
  protected readonly store: InternalStore;
  protected readonly populationDigest: string | undefined;
  protected state: MutableState;
  protected carry: CarryData | undefined;
  protected showingCarry: boolean;
  protected superseded = false;
  protected revoked = false;
  protected disposed = false;
  private ownerRetained = true;
  private readonly leaseObjects = new Set<ResultLease>();
  private readonly subscriptions = new Set<ManagedResultSubscription>();
  private lastTouched: number;

  protected constructor(
    store: InternalStore,
    input: ResultBeginInput,
    generation: number,
    carry: CarryData | undefined,
  ) {
    this.store = store;
    this.key = Object.freeze({
      principalKey: input.principalKey,
      scopeDigest: input.scopeDigest,
      ...(input.policyRevision === undefined ? {} : { policyRevision: input.policyRevision }),
      ...(input.populationDigest === undefined ? {} : { populationDigest: input.populationDigest }),
      queryDigest: input.queryDigest,
      catalogRevision: input.catalogRevision,
      functionRegistryDigest: input.functionRegistryDigest,
      sourceRevision: input.sourceRevision,
      ...(input.sourceLineage === undefined ? {} : { sourceLineage: input.sourceLineage }),
      ...(input.planDigest === undefined ? {} : { planDigest: input.planDigest }),
      ...(input.resultShape === undefined ? {} : { resultShape: input.resultShape }),
      ...(input.lineageDigest === undefined ? {} : { lineageDigest: input.lineageDigest }),
      outputId: input.outputId,
      taskId: input.taskId,
    });
    this.generation = generation;
    this.populationDigest = input.populationDigest;
    this.carry = carry;
    this.showingCarry = carry !== undefined;
    this.state = this.emptyState(carry === undefined ? 'loading' : 'refreshing');
    this.lastTouched = store.now();
  }

  protected emptyState(status: ResultStatus): MutableState {
    return {
      status,
      descriptor: undefined,
      batches: [],
      loadedRows: 0,
      diagnostics: [],
      lastEvent: undefined,
      nextSequence: 0,
      seenIdentity: new Set<string>(),
      progress: new Map<string, number>(),
      terminal: false,
      bytes: 0,
    };
  }

  get pinned(): boolean {
    return this.ownerRetained || this.leaseObjects.size > 0 || this.subscriptions.size > 0;
  }

  get touchedAt(): number {
    return this.lastTouched;
  }

  get retainedBytes(): number {
    return this.state.bytes + (this.carry?.bytes ?? 0);
  }

  protected touch(): void {
    this.lastTouched = this.store.now();
  }

  snapshot(): ResultSnapshot {
    this.touch();
    const descriptor = this.showingCarry && this.carry !== undefined ? this.carry.descriptor : this.state.descriptor;
    const batches = this.showingCarry && this.carry !== undefined ? this.carry.batches : this.state.batches;
    const loadedRows = this.showingCarry && this.carry !== undefined ? this.carry.loadedRows : this.state.loadedRows;
    const lastEvent =
      this.showingCarry && this.carry !== undefined && this.state.lastEvent === undefined
        ? this.carry.lastEvent
        : this.state.lastEvent;
    const { principalKey: _principalKey, ...pins } = this.key;
    return frozen({
      status: this.state.status,
      generation: this.generation,
      key: pins as ResultSnapshot['key'],
      ...(descriptor === undefined ? {} : { descriptor }),
      batches,
      loadedRows,
      diagnostics: this.state.diagnostics,
      ...(lastEvent === undefined ? {} : { lastEvent }),
    });
  }

  retain(): ResultLease {
    if (this.disposed || this.revoked)
      return {
        released: true,
        release() {
          /* already unavailable */
        },
      };
    let released = false;
    const lease: ResultLease = {
      get released() {
        return released;
      },
      release: () => {
        if (released) return;
        released = true;
        this.leaseObjects.delete(lease);
        this.touch();
      },
    };
    this.leaseObjects.add(lease);
    return lease;
  }

  release(): void {
    this.ownerRetained = false;
    this.touch();
  }

  subscribe(
    source: AsyncIterable<unknown> | AsyncIterator<unknown>,
    options: { readonly signal?: AbortSignal } = {},
  ): ResultSubscription {
    const subscription = new ResultSubscriptionImpl(this, sourceIterator(source), options.signal);
    if (this.disposed || this.revoked || this.superseded || this.state.terminal) {
      subscription.closeWithoutPull();
      return subscription;
    }
    this.subscriptions.add(subscription);
    subscription.listenForAbort();
    return subscription;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.superseded = false;
    this.revoked = false;
    this.carry = undefined;
    this.showingCarry = false;
    this.state = this.emptyState('disposed');
    this.state.diagnostics = Object.freeze([makeDiagnostic('data.disposed', 'The result handle has been disposed.')]);
    for (const subscription of [...this.subscriptions]) subscription.closeWithoutPull();
    this.subscriptions.clear();
    for (const lease of [...this.leaseObjects]) lease.release();
    this.leaseObjects.clear();
    this.ownerRetained = false;
    this.store.remove(this);
  }

  supersede(): void {
    if (this.disposed || this.revoked) return;
    this.superseded = true;
    if (this.state.status !== 'disposed') this.state.status = 'stale';
    for (const subscription of [...this.subscriptions]) subscription.closeAsSuperseded();
    this.subscriptions.clear();
    this.touch();
  }

  revoke(): void {
    if (this.disposed || this.revoked) return;
    this.revoked = true;
    this.carry = undefined;
    this.showingCarry = false;
    this.state = this.emptyState('denied');
    this.state.diagnostics = Object.freeze([
      makeDiagnostic('data.authorization-revoked', 'Authorization for this result has been revoked.'),
    ]);
    for (const subscription of [...this.subscriptions]) subscription.closeWithoutPull();
    this.subscriptions.clear();
    for (const lease of [...this.leaseObjects]) lease.release();
    this.leaseObjects.clear();
    this.ownerRetained = false;
    this.store.remove(this);
  }

  protected current(): boolean {
    return !this.disposed && !this.revoked && !this.superseded && this.store.slots.get(slotKey(this.key)) === this;
  }

  protected restoreCarry(status: ResultStatus, diagnostic?: Diagnostic, event?: ResultEvent): void {
    const current: CarryData | undefined =
      this.state.descriptor === undefined
        ? undefined
        : {
            descriptor: this.state.descriptor,
            batches: this.state.batches,
            loadedRows: this.state.loadedRows,
            ...(this.state.lastEvent === undefined ? {} : { lastEvent: this.state.lastEvent }),
            bytes: this.state.bytes,
          };
    const retained = this.carry ?? current;
    if (retained !== undefined && preserveOnFailure(status)) {
      if (this.carry !== undefined) this.state = this.emptyState(status);
      this.showingCarry = retained === this.carry;
      this.state.status = this.carry === undefined ? status : 'stale';
      this.state.diagnostics = diagnostic === undefined ? [] : Object.freeze([diagnostic]);
      this.state.lastEvent = event;
      this.state.terminal = true;
      return;
    }
    this.carry = undefined;
    this.showingCarry = false;
    this.state.status = status;
    this.state.descriptor = undefined;
    this.state.batches = [];
    this.state.loadedRows = 0;
    this.state.bytes = 0;
    this.state.diagnostics = diagnostic === undefined ? [] : Object.freeze([diagnostic]);
    this.state.lastEvent = event;
    this.state.terminal = true;
  }

  protected invalid(code: string, message: string): Outcome<ResultEvent> {
    const diagnostic = makeDiagnostic(code, message);
    this.restoreCarry('failed', diagnostic);
    return { ok: false, diagnostics: [diagnostic] };
  }

  truncated(): void {
    if (this.state.terminal || this.disposed || this.revoked || this.superseded) return;
    this.restoreCarry(
      'failed',
      makeDiagnostic('data.result-truncated', 'The result source ended without a terminal event.'),
    );
  }

  streamFailure(): void {
    if (this.state.terminal || this.disposed || this.revoked || this.superseded) return;
    this.restoreCarry(
      'failed',
      makeDiagnostic('data.stream-network', 'The result source failed before producing a terminal event.'),
    );
  }

  cancel(): void {
    if (this.state.terminal || this.disposed || this.revoked || this.superseded) return;
    this.restoreCarry('cancelled', makeDiagnostic('data.aborted', 'The result subscription was cancelled.'));
  }

  subscriptionClosed(subscription: ManagedResultSubscription): void {
    this.subscriptions.delete(subscription);
    this.touch();
  }

  isTerminal(): boolean {
    return this.state.terminal || this.disposed || this.revoked || this.superseded;
  }

  isSuperseded(): boolean {
    return this.superseded;
  }

  abstract ingest(raw: unknown): Promise<Outcome<ResultEvent>>;
}
