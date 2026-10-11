import type { Intent, Outcome } from '@varendo/core';
import { defineDataFeature } from '@varendo/core/features';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import {
  createAeliqoRuntime,
  type DataSurfaceBindings,
  type ExternalSurfaceSnapshot,
  type SurfaceProposal,
  type ScopeBinding,
  type ScopeController,
  type ScopeLeaveDecision,
  type ScopeLeaveState,
  type ScopeResolution,
  type ScopeSelector,
  type SurfaceAddress,
  type SurfaceController,
  type SurfaceScope,
} from '@varendo/runtime';
import {
  createLocalDataService,
  type DataService,
  type LocalDataService,
  type LocalSnapshot,
} from '@varendo/runtime/data';
import {
  createActionPort,
  createActionRegistry,
  type ActionDispatchResult,
  type ActionPayload,
  type ActionPort,
} from '@varendo/runtime/actions';
import { z } from 'zod';

const OrderSchema = z.object({ id: z.string(), workspace: z.string(), total: z.number() });
type Order = z.infer<typeof OrderSchema>;

const ordersFeature = defineDataFeature({
  id: 'orders',
  schema: OrderSchema,
  identity: ['id'],
  fields: { workspace: { role: 'dimension' }, total: { role: 'measure' } },
});

interface OrdersState {
  readonly rows: readonly Order[];
  readonly selection: readonly string[];
  readonly cursor?: string;
}

interface Gate {
  readonly started: Promise<void>;
  readonly completed: Promise<void>;
  readonly resolve: () => void;
  markStarted(scopeId: string): void;
  markCompleted(): void;
  scopeId?: string;
}

function deferredGate(): Gate {
  let start!: () => void;
  let release!: () => void;
  let complete!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return {
    started,
    completed,
    resolve: release,
    markStarted(scopeId) {
      this.scopeId = scopeId;
      start();
    },
    markCompleted: complete,
    waitForRelease: released,
  } as Gate & { readonly waitForRelease: Promise<void> };
}

function snapshot(scopeId: string, rows: readonly Order[], sourceRevision = `orders-${scopeId}-1`): LocalSnapshot {
  return Object.freeze({
    catalog: ordersFeature.catalog,
    sourceRevision,
    records: Object.freeze({ orders: Object.freeze(rows) }),
  });
}

function sourceHarness() {
  const acmePrivateRow = Object.freeze({ id: 'acme-private', workspace: 'acme', total: 41 });
  const acmeSecondRow = Object.freeze({ id: 'acme-second', workspace: 'acme', total: 19 });
  const globexRow = Object.freeze({ id: 'globex-order', workspace: 'globex', total: 73 });
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new TypeError(functions.diagnostics[0].message);
  const services = new Map<string, LocalDataService>();
  let nextGate: (Gate & { readonly waitForRelease: Promise<void> }) | undefined;
  const activeGates = new Set<Gate>();
  const calls = new Map<string, number>();

  const baseFor = (scopeId: string): LocalDataService => {
    const existing = services.get(scopeId);
    if (existing !== undefined) return existing;
    const rows = scopeId === 'acme' ? [acmePrivateRow, acmeSecondRow] : [globexRow];
    const service = createLocalDataService({
      snapshot: snapshot(scopeId, rows),
      functionRegistry: functions.value,
      authorize: ({ context }) =>
        context.principal === 'scope-user'
          ? { ok: true, value: { scopeDigest: `workspace:${scopeId}`, policyRevision: 'policy-1' } }
          : {
              ok: false,
              diagnostics: [{ code: 'data.denied', message: 'The scoped read was denied.', retryable: false }],
            },
    });
    services.set(scopeId, service);
    return service;
  };

  return {
    acmePrivateRow,
    deferNext() {
      const gate = deferredGate() as Gate & { readonly waitForRelease: Promise<void> };
      nextGate = gate;
      activeGates.add(gate);
      return { started: gate.started, resolve: gate.resolve };
    },
    forScope(scopeId: string): DataService {
      const base = baseFor(scopeId);
      return {
        describe: (...args) => base.describe(...args),
        plan: (...args) => base.plan(...args),
        async *execute(...args) {
          calls.set(scopeId, (calls.get(scopeId) ?? 0) + 1);
          const gate = nextGate;
          if (gate !== undefined) {
            nextGate = undefined;
            gate.markStarted(scopeId);
            await gate.waitForRelease;
          }
          try {
            yield* base.execute(...args);
          } finally {
            gate?.markCompleted();
            if (gate !== undefined) activeGates.delete(gate);
          }
        },
      };
    },
    async release(scopeId: string) {
      const gate = [...activeGates].find((candidate) => candidate.scopeId === scopeId);
      if (gate === undefined) throw new TypeError(`No deferred ${scopeId} source request started.`);
      gate.resolve();
      await gate.completed;
    },
    replace(scopeId: string, rows: readonly Order[], sourceRevision: string) {
      return baseFor(scopeId).replaceSnapshot(snapshot(scopeId, rows, sourceRevision));
    },
    callsFor: (scopeId: string) => calls.get(scopeId) ?? 0,
  };
}

function bindings(source: DataService): DataSurfaceBindings<OrdersState> {
  return {
    initialState: Object.freeze({ rows: Object.freeze([]), selection: Object.freeze([]) }),
    source: {
      kind: 'data-service',
      service: source,
      coverage: {
        fields: ['id', 'workspace', 'total'],
        operators: ['eq', 'contains'],
        pagination: 'keyset',
        stableOrder: ['id'],
        sorting: 'stable-fields-only',
        aggregation: 'registered-only',
        streaming: 'finite',
        updates: 'snapshot-replace',
        unsupported: ['streaming', 'live-updates'],
      },
      normalize: async (events) => {
        const rows: Order[] = [];
        let cursor: string | undefined;
        for await (const event of events) {
          if (event.kind === 'complete') cursor = event.cursor;
          if (event.kind === 'batch') {
            for (const row of event.rows) {
              const parsed = ordersFeature.parseRecord(row);
              if (!parsed.ok) throw new TypeError(parsed.diagnostics[0].message);
              rows.push(parsed.value);
            }
          }
        }
        return Object.freeze({
          rows: Object.freeze(rows),
          selection: Object.freeze([]),
          ...(cursor === undefined ? {} : { cursor }),
        });
      },
    },
  };
}

let nextFixtureId = 1;

export async function createScopeFixture() {
  const fixtureId = nextFixtureId++;
  const runtimeId = `scope-runtime-${fixtureId}`;
  let activeSelector: ScopeSelector | undefined;
  const permissionRevisions = new Map<string, number>();
  const selectorKey = (selector: ScopeSelector) => JSON.stringify(selector);
  const permissionFor = (selector: ScopeSelector) => permissionRevisions.get(selectorKey(selector)) ?? 1;
  let leaveState: unknown = { dirty: false, revision: 'draft-0' };
  let leaveReads = 0;
  let throwLeaveStateAfter = Number.POSITIVE_INFINITY;
  let guardDecision: unknown = { status: 'clean' };
  let resolveCalls = 0;
  let guardCalls = 0;
  let recoveryEnabled = false;
  const deniedSelectors = new Set<string>();
  const recoveries: { readonly selector: ScopeSelector; readonly policyRevision: string }[] = [];
  const events: string[] = [];
  let throwOnDeactivate = false;
  let throwOnRecover = false;
  const throwOnAuthorize = new Set<string>();
  const rawAuthorizeOutcomes = new Map<string, unknown>();
  const throwOnResolve = new Set<string>();
  const queuedAuthorizeRevocations = new Map<string, number>();
  const acceptanceRejections = new Set<string>();
  const preparationFailures = new Map<string, 'throw' | 'null' | 'getter'>();
  const activationFailures = new Map<string, 'throw' | 'return' | 'null' | 'getter'>();
  const activationCallbacks = new Map<string, () => void>();
  const preparationCallbacks = new Map<string, () => void>();
  const transitionDeactivateCallbacks = new Map<string, () => void>();
  let lastResolution: ScopeResolution | undefined;
  const allowedFeatures = ['orders', 'react-orders'];
  let activeActionPort: ActionPort | undefined;
  let actionGate:
    | {
        readonly started: Promise<void>;
        start(): void;
        readonly promise: Promise<ActionDispatchResult>;
        resolve(value: ActionDispatchResult): void;
      }
    | undefined;
  const backendEffects: { readonly scopeId: string; readonly input: ActionPayload }[] = [];
  const actionDescriptor = {
    ref: { id: 'orders.update', revision: '1' },
    input: { id: 'orders.update-input', revision: '1' },
    output: { id: 'orders.update-output', revision: '1' },
    sideEffect: 'domain-write' as const,
    confirmation: 'required' as const,
    idempotency: 'required' as const,
    entityRevision: 'none' as const,
  };
  const createScopedActionPort = (selector: ScopeSelector): ActionPort => {
    const registry = createActionRegistry();
    const parsed = (value: unknown): Outcome<ActionPayload> => ({ ok: true, value: value as ActionPayload });
    const registered = registry.register({
      descriptor: actionDescriptor,
      inputSchema: { ref: actionDescriptor.input, parse: parsed },
      outputSchema: { ref: actionDescriptor.output, parse: parsed },
      dispatch: async ({ input }) => {
        const gate = actionGate;
        if (gate !== undefined) {
          actionGate = undefined;
          gate.start();
          const result = await gate.promise;
          backendEffects.push({ scopeId: selector.id, input });
          return result;
        }
        backendEffects.push({ scopeId: selector.id, input });
        return { state: 'completed', output: { saved: true } };
      },
    });
    if (!registered.ok) throw new TypeError(registered.diagnostics[0].message);
    return createActionPort({
      registry,
      host: {
        readContext: () => ({
          ok: true,
          value: {
            principalKey: 'scope-user',
            actorKey: 'scope-user',
            scopeDigest: JSON.stringify(selector),
            policyRevision: 'policy-1',
            domainRevision: 'domain-1',
            confirmationEpoch: 'confirmation-1',
            grants: ['action.propose', 'action.execute'] as const,
          },
        }),
        issueConfirmation: () => ({ ok: true, value: undefined }),
      },
    });
  };
  const resolveGates = new Map<
    string,
    {
      readonly started: Promise<void>;
      start(): void;
      readonly promise: Promise<Outcome<ScopeResolution>>;
      resolve(outcome?: Outcome<ScopeResolution>): void;
    }
  >();
  let authorizeGate:
    | {
        readonly id: string;
        remaining: number;
        readonly started: Promise<void>;
        start(): void;
        readonly promise: Promise<void>;
        resolve(): void;
      }
    | undefined;
  let guardGate:
    | {
        readonly started: Promise<void>;
        start(): void;
        readonly promise: Promise<ScopeLeaveDecision>;
        resolve(decision: ScopeLeaveDecision): void;
      }
    | undefined;

  const host: ScopeBinding & {
    readonly resolveCalls: number;
    readonly guardCalls: number;
    readonly recoveries: readonly { readonly selector: ScopeSelector; readonly policyRevision: string }[];
    readonly events: readonly string[];
    revoke(id: string): void;
    deny(id: string): void;
    allow(id: string): void;
    setDirty(dirty: boolean): void;
    setGuard(decision: ScopeLeaveDecision): void;
    setRawLeaveState(state: unknown): void;
    setRawGuard(decision: unknown): void;
    throwLeaveStateAfter(reads: number): void;
    throwAuthorize(id: string): void;
    setRawAuthorize(id: string, outcome: unknown): void;
    revokeAfterAuthorize(id: string, after?: number): void;
    throwResolve(id: string): void;
    deferAuthorize(id: string, after?: number): { readonly started: Promise<void>; resolve(): void };
    deferGuard(): { readonly started: Promise<void>; resolve(decision: ScopeLeaveDecision): void };
    deferResolve(id: string): { readonly started: Promise<void>; resolve(outcome?: Outcome<ScopeResolution>): void };
    enableRecovery(): void;
    failDeactivate(): void;
    failRecovery(): void;
    failActivate(id: string, mode: 'throw' | 'return' | 'null' | 'getter'): void;
    failPreparation(id: string, mode: 'throw' | 'null' | 'getter'): void;
    rejectAcceptance(id: string): void;
    onActivate(id: string, callback: () => void): void;
    onPreparation(id: string, callback: () => void): void;
    onTransitionDeactivate(id: string, callback: () => void): void;
    currentLeaveState(): unknown;
    mutateLastResolution(): void;
  } = {
    get resolveCalls() {
      return resolveCalls;
    },
    get guardCalls() {
      return guardCalls;
    },
    get recoveries() {
      return recoveries;
    },
    get events() {
      return events;
    },
    async resolve(selector) {
      resolveCalls += 1;
      if (throwOnResolve.has(selector.id)) throw new Error('resolve failed');
      const gate = resolveGates.get(JSON.stringify(selector));
      if (gate !== undefined) {
        gate.start();
        return gate.promise;
      }
      if (deniedSelectors.has(JSON.stringify(selector)))
        return {
          ok: false,
          diagnostics: [{ code: 'scope.membership-denied', message: 'Membership was denied.', retryable: false }],
        };
      lastResolution = {
        selector: {
          kind: selector.kind,
          id: selector.id,
          ...(selector.lineage === undefined
            ? {}
            : { lineage: selector.lineage.map((entry) => ({ kind: entry.kind, id: entry.id })) }),
        },
        permissionRevision: permissionFor(selector),
        policyRevision: 'policy-1',
        allowedFeatures,
      };
      return { ok: true, value: lastResolution };
    },
    authorize(input) {
      const authorizeNow = (): Outcome<void> => {
        if (throwOnAuthorize.has(input.selector.id)) throw new Error('authorize failed');
        if (rawAuthorizeOutcomes.has(input.selector.id)) return rawAuthorizeOutcomes.get(input.selector.id) as never;
        if (input.permissionRevision !== permissionFor(input.selector))
          return {
            ok: false as const,
            diagnostics: [{ code: 'scope.permission-stale', message: 'Scope permission changed.', retryable: false }],
          };
        const outcome = { ok: true as const, value: undefined };
        const revokeAfter = queuedAuthorizeRevocations.get(input.selector.id);
        if (revokeAfter !== undefined) {
          if (revokeAfter === 0) {
            queuedAuthorizeRevocations.delete(input.selector.id);
            queueMicrotask(() => host.revoke(input.selector.id));
          } else queuedAuthorizeRevocations.set(input.selector.id, revokeAfter - 1);
        }
        return outcome;
      };
      if (authorizeGate?.id === input.selector.id) {
        if (authorizeGate.remaining > 0) authorizeGate.remaining -= 1;
        else {
          const pending = authorizeGate;
          authorizeGate = undefined;
          pending.start();
          return pending.promise.then(authorizeNow);
        }
      }
      return authorizeNow();
    },
    prepareActivation(input, context) {
      const callback = preparationCallbacks.get(input.selector.id);
      preparationCallbacks.delete(input.selector.id);
      callback?.();
      const permissionStale = {
        ok: false as const,
        diagnostics: [
          { code: 'scope.permission-stale', message: 'Scope permission changed.', retryable: false },
        ] as const,
      };
      if (input.permissionRevision !== permissionFor(input.selector) || input.policyRevision !== 'policy-1')
        return permissionStale;
      if (context.kind === 'transition') {
        const currentLeave = leaveState as ScopeLeaveState;
        if (
          context.previous.permissionRevision !== permissionFor(context.previous.selector) ||
          context.previous.policyRevision !== 'policy-1' ||
          currentLeave.revision !== context.leaveRevision
        )
          return permissionStale;
      }
      if (acceptanceRejections.has(input.selector.id)) return permissionStale;
      const failure = preparationFailures.get(input.selector.id);
      if (failure === 'throw') throw new Error('activation preparation failed');
      if (failure === 'null') return null as never;
      if (failure === 'getter')
        return new Proxy(
          {},
          {
            get() {
              throw new Error('activation preparation outcome getter failed');
            },
          },
        ) as never;
      return { ok: true, value: undefined };
    },
    activate(input) {
      events.push(`activate:${input.selector.id}`);
      activeSelector = input.selector;
      activeActionPort = createScopedActionPort(input.selector);
      const callback = activationCallbacks.get(input.selector.id);
      activationCallbacks.delete(input.selector.id);
      callback?.();
      const failure = activationFailures.get(input.selector.id);
      if (failure === 'throw') throw new Error('activation failed');
      if (failure === 'return')
        return {
          ok: false,
          diagnostics: [{ code: 'scope.activation-denied', message: 'Activation failed.', retryable: false }],
        };
      if (failure === 'null') return null as never;
      if (failure === 'getter')
        return new Proxy(
          {},
          {
            get() {
              throw new Error('activation outcome getter failed');
            },
          },
        ) as never;
      return { ok: true, value: undefined };
    },
    deactivate(input, reason) {
      events.push(`deactivate:${input.selector.id}`);
      activeActionPort?.revoke('scope transition');
      activeActionPort = undefined;
      if (JSON.stringify(activeSelector) === JSON.stringify(input.selector)) activeSelector = undefined;
      if (reason === 'transition') {
        const callback = transitionDeactivateCallbacks.get(input.selector.id);
        transitionDeactivateCallbacks.delete(input.selector.id);
        callback?.();
      }
      if (throwOnDeactivate) throw new Error('deactivate failed');
    },
    readLeaveState() {
      leaveReads += 1;
      if (leaveReads > throwLeaveStateAfter) throw new Error('leave state failed');
      return leaveState as ScopeLeaveState;
    },
    async beforeLeave() {
      guardCalls += 1;
      if (guardGate === undefined) return guardDecision as ScopeLeaveDecision;
      guardGate.start();
      const pending = guardGate;
      guardGate = undefined;
      return pending.promise;
    },
    recover(input) {
      if (throwOnRecover) throw new Error('recovery failed');
      if (recoveryEnabled) recoveries.push({ selector: input.selector, policyRevision: input.policyRevision });
    },
    revoke(id) {
      const selector = { kind: 'workspace', id } as const;
      permissionRevisions.set(selectorKey(selector), permissionFor(selector) + 1);
    },
    deny(id) {
      deniedSelectors.add(JSON.stringify({ kind: 'workspace', id }));
    },
    allow(id) {
      deniedSelectors.delete(JSON.stringify({ kind: 'workspace', id }));
    },
    setDirty(dirty) {
      const current = leaveState as ScopeLeaveState;
      leaveState = { dirty, revision: `draft-${Number(current.revision.split('-')[1]) + 1}` };
    },
    setGuard(decision) {
      guardDecision = decision;
    },
    setRawLeaveState(state) {
      leaveState = state;
    },
    setRawGuard(decision) {
      guardDecision = decision;
    },
    throwLeaveStateAfter(reads) {
      throwLeaveStateAfter = reads;
    },
    throwAuthorize(id) {
      throwOnAuthorize.add(id);
    },
    setRawAuthorize(id, outcome) {
      rawAuthorizeOutcomes.set(id, outcome);
    },
    revokeAfterAuthorize(id, after = 0) {
      queuedAuthorizeRevocations.set(id, after);
    },
    throwResolve(id) {
      throwOnResolve.add(id);
    },
    deferAuthorize(id, after = 0) {
      let start!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        start = resolve;
      });
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      authorizeGate = { id, remaining: after, started, start, promise, resolve: release };
      return { started, resolve: release };
    },
    deferGuard() {
      let start!: () => void;
      let resolve!: (decision: ScopeLeaveDecision) => void;
      const started = new Promise<void>((done) => {
        start = done;
      });
      const promise = new Promise<ScopeLeaveDecision>((done) => {
        resolve = done;
      });
      guardGate = { started, start, promise, resolve };
      return { started, resolve };
    },
    deferResolve(id) {
      const selector = { kind: 'workspace', id } as const;
      let start!: () => void;
      let resolvePromise!: (outcome: Outcome<ScopeResolution>) => void;
      const started = new Promise<void>((done) => {
        start = done;
      });
      const promise = new Promise<Outcome<ScopeResolution>>((done) => {
        resolvePromise = done;
      });
      const gate = {
        started,
        start,
        promise,
        resolve(
          outcome: Outcome<ScopeResolution> = {
            ok: true,
            value: { selector, permissionRevision: permissionFor(selector), policyRevision: 'policy-1' },
          },
        ) {
          resolvePromise(outcome);
        },
      };
      resolveGates.set(JSON.stringify(selector), gate);
      return { started, resolve: gate.resolve };
    },
    enableRecovery() {
      recoveryEnabled = true;
    },
    failDeactivate() {
      throwOnDeactivate = true;
    },
    failRecovery() {
      throwOnRecover = true;
    },
    failActivate(id, mode) {
      activationFailures.set(id, mode);
    },
    failPreparation(id, mode) {
      preparationFailures.set(id, mode);
    },
    rejectAcceptance(id) {
      acceptanceRejections.add(id);
    },
    onActivate(id, callback) {
      activationCallbacks.set(id, callback);
    },
    onPreparation(id, callback) {
      preparationCallbacks.set(id, callback);
    },
    onTransitionDeactivate(id, callback) {
      transitionDeactivateCallbacks.set(id, callback);
    },
    currentLeaveState() {
      return leaveState;
    },
    mutateLastResolution() {
      if (lastResolution === undefined) throw new TypeError('No resolution was produced.');
      (lastResolution.selector as { id: string }).id = 'mutated-host-id';
      allowedFeatures.splice(0, allowedFeatures.length);
    },
  };
  const source = sourceHarness();
  const runtime = createAeliqoRuntime({
    runtimeId,
    maxRegions: 2,
    resources: [{ resource: ordersFeature.resource, data: source.forScope('acme') }],
    authority: {
      read: () => {
        const id = activeSelector?.id;
        if (id === undefined)
          return {
            ok: false,
            diagnostics: [{ code: 'scope.inactive', message: 'No scope is active.', retryable: false }],
          };
        return {
          ok: true,
          value: {
            principalKey: 'scope-user',
            scopeDigest: `workspace:${id}`,
            policyRevision: 'policy-1',
            experienceRevision: 'experience-1',
            grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
            readContext: { principal: 'scope-user' },
          },
        };
      },
    },
  });
  const scope = runtime.createScope({ binding: host, initial: { kind: 'workspace', id: 'acme' } });
  let fenceSubscriptions = 0;
  const observedScope: SurfaceScope = {
    getSnapshot: () => scope.getSnapshot(),
    authorize: (featureId) => scope.authorize(featureId),
    subscribeFence(listener) {
      fenceSubscriptions += 1;
      const unsubscribe = scope.subscribeFence!(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        fenceSubscriptions -= 1;
        unsubscribe();
      };
    },
    registerTarget: (address, fence) => scope.registerTarget!(address, fence),
  };
  let current: SurfaceController<Intent, OrdersState> | undefined;
  let retiredSurfaces = 0;
  const createCurrent = () => {
    const next = scope.getSnapshot();
    if (next.status !== 'active' || next.selector === null) return;
    if (current?.address.activationEpoch === next.activationEpoch) return;
    if (current !== undefined) {
      if (current.getSnapshot().phase !== 'disposed')
        throw new TypeError('The previous activation surface was not fenced before child replacement.');
      retiredSurfaces += 1;
    }
    current = runtime.createSurface({
      scope: observedScope,
      id: 'orders',
      feature: ordersFeature,
      bindings: bindings(source.forScope(next.selector.id)),
    });
  };
  const unsubscribe = scope.subscribe(createCurrent);
  let detach: (() => void) | undefined;

  return {
    runtime,
    scope,
    feature: ordersFeature,
    bindingsFor: (id: string) => bindings(source.forScope(id)),
    currentOrders() {
      if (current === undefined) throw new TypeError('The Orders surface is not active.');
      return current;
    },
    host,
    source,
    view: {
      readRows: () => current?.getSnapshot().state.rows ?? [],
    },
    release: (scopeId: string) => source.release(scopeId),
    async activate(scopeId: string) {
      if (detach === undefined) detach = scope.attach();
      if (scope.getSnapshot().status === 'active' && scope.getSnapshot().selector?.id === scopeId) return;
      if (scope.getSnapshot().status === 'active') {
        await scope.requestChange({ kind: 'workspace', id: scopeId });
        return;
      }
      await new Promise<void>((resolve) => {
        const stop = scope.subscribe(() => {
          if (scope.getSnapshot().status !== 'active') return;
          stop();
          resolve();
        });
      });
    },
    captureAddress: (): SurfaceAddress => ({ ...current!.address }),
    fenceSubscriptions: () => fenceSubscriptions,
    retiredSurfaces: () => retiredSurfaces,
    createControlledOrders() {
      let snapshot: ExternalSurfaceSnapshot<Intent, OrdersState> | undefined;
      const listeners = new Set<() => void>();
      const proposals: SurfaceProposal<Intent>[] = [];
      const surface = runtime.createSurface({
        scope: observedScope,
        id: `controlled-orders-${scope.getSnapshot().activationEpoch}`,
        feature: ordersFeature,
        bindings: bindings(source.forScope(scope.getSnapshot().selector!.id)),
        ownership: {
          mode: 'external',
          store: {
            getSnapshot() {
              if (snapshot === undefined) throw new TypeError('Controlled store is not initialized.');
              return snapshot;
            },
            subscribe(listener) {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
          onProposal: (proposal) => proposals.push(proposal),
        },
      });
      snapshot = Object.freeze({
        id: surface.id,
        address: surface.address,
        revision: '0',
        phase: 'idle',
        intent: Object.freeze({ version: '1', id: 'controlled-0', resource: 'orders', kind: 'browse' }),
        state: Object.freeze({ rows: Object.freeze([]), selection: Object.freeze([]) }),
      });
      return {
        surface,
        proposals,
        accept(proposalId: string) {
          const proposal = proposals.find((candidate) => candidate.proposalId === proposalId);
          if (proposal === undefined) throw new TypeError('Unknown proposal.');
          snapshot = Object.freeze({
            ...snapshot!,
            revision: '1',
            phase: 'ready',
            intent: proposal.intent,
            state: Object.freeze({ rows: Object.freeze([source.acmePrivateRow]), selection: Object.freeze([]) }),
            proposalDecision: Object.freeze({
              proposalId,
              address: proposal.address,
              expectedRevision: proposal.expectedRevision,
              status: 'accepted',
            }),
          });
          for (const listener of [...listeners]) listener();
        },
      };
    },
    actions: {
      descriptor: actionDescriptor,
      current() {
        if (activeActionPort === undefined) throw new TypeError('No scoped ActionPort is active.');
        return activeActionPort;
      },
      backendEffects,
      hasActive: () => activeActionPort !== undefined,
      deferNextDispatch() {
        let start!: () => void;
        let resolve!: (value: ActionDispatchResult) => void;
        const started = new Promise<void>((done) => {
          start = done;
        });
        const promise = new Promise<ActionDispatchResult>((done) => {
          resolve = done;
        });
        actionGate = { started, start, promise, resolve };
        return { started, resolve };
      },
    },
    dispose: async () => {
      detach?.();
      unsubscribe();
      current?.dispose();
      scope.dispose();
      runtime.dispose();
    },
    disposeRuntime: () => runtime.dispose(),
    runtimeState: (regionId: string) => runtime.snapshot(regionId),
  };
}

export async function createParallelScopeFixture() {
  const fixtureId = nextFixtureId++;
  const northParent = { kind: 'organization', id: 'north' } as const;
  const north = {
    kind: 'workspace',
    id: 'acme',
    lineage: [{ kind: 'organization', id: 'north' }],
  } as const;
  const south = {
    kind: 'workspace',
    id: 'acme',
    lineage: [{ kind: 'organization', id: 'south' }],
  } as const;
  const keyOf = (selector: ScopeSelector) =>
    [...(selector.lineage ?? []), { kind: selector.kind, id: selector.id }]
      .map((entry) => `${entry.kind}:${entry.id}`)
      .join('/');
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new TypeError(functions.diagnostics[0].message);
  const services = new Map<string, DataService>();
  const permissions = new Map<string, number>();
  const regionKeys = new Map<string, string>();
  const revokedRuntimeKeys = new Set<string>();
  const authorityDigests: { readonly regionId: string; readonly scopeDigest: string }[] = [];
  let regionSequence = 0;
  const serviceFor = (selector: ScopeSelector) => {
    const key = keyOf(selector);
    const existing = services.get(key);
    if (existing !== undefined) return existing;
    const service = createLocalDataService({
      snapshot: snapshot(key, [{ id: `${key}-private`, workspace: key, total: key.length }]),
      functionRegistry: functions.value,
      authorize: ({ context }) =>
        context.principal === `parallel:${key}`
          ? { ok: true, value: { scopeDigest: key, policyRevision: `policy:${key}` } }
          : {
              ok: false,
              diagnostics: [{ code: 'data.denied', message: 'Parallel scope mismatch.', retryable: false }],
            },
    });
    services.set(key, service);
    return service;
  };
  const runtime = createAeliqoRuntime({
    runtimeId: `parallel-scope-runtime-${fixtureId}`,
    maxRegions: 4,
    resources: [{ resource: ordersFeature.resource, data: serviceFor(north) }],
    authority: {
      read: ({ regionId }) => {
        const key = regionKeys.get(regionId);
        if (key === undefined || revokedRuntimeKeys.has(key))
          return {
            ok: false,
            diagnostics: [
              { code: 'scope.permission-revoked', message: 'Parallel scope was revoked.', retryable: false },
            ],
          };
        authorityDigests.push({ regionId, scopeDigest: key });
        return {
          ok: true,
          value: {
            principalKey: `parallel-user:${key}`,
            scopeDigest: key,
            policyRevision: `policy:${key}`,
            experienceRevision: 'experience-1',
            grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
            readContext: { principal: `parallel:${key}` },
          },
        };
      },
    },
  });
  const denied = () => ({
    ok: false as const,
    diagnostics: [
      { code: 'scope.membership-denied', message: 'The requested lineage is outside its parent.', retryable: false },
    ] as const,
  });
  const binding = (allows: (selector: ScopeSelector) => boolean): ScopeBinding => {
    const authorize = (resolution: ScopeResolution) => {
      if (!allows(resolution.selector)) return denied();
      return resolution.permissionRevision === (permissions.get(keyOf(resolution.selector)) ?? 1)
        ? { ok: true as const, value: undefined }
        : {
            ok: false as const,
            diagnostics: [
              { code: 'scope.permission-stale', message: 'Scope permission changed.', retryable: false },
            ] as const,
          };
    };
    return {
      resolve: (selector) =>
        allows(selector)
          ? {
              ok: true,
              value: {
                selector,
                permissionRevision: permissions.get(keyOf(selector)) ?? 1,
                policyRevision: `policy:${keyOf(selector)}`,
                allowedFeatures: ['orders'],
              },
            }
          : denied(),
      authorize,
      prepareActivation: (resolution, context) => {
        if (context.kind === 'transition' && !allows(context.previous.selector)) return denied();
        return authorize(resolution);
      },
      activate: () => ({ ok: true, value: undefined }),
      deactivate: () => undefined,
      readLeaveState: () => ({ dirty: false, revision: 'clean' }),
    };
  };
  const attachments = new Map<ScopeController, () => void>();
  const waitActive = (scope: ScopeController) =>
    new Promise<void>((resolve) => {
      const unsubscribe = scope.subscribe(() => {
        if (scope.getSnapshot().status !== 'active') return;
        unsubscribe();
        resolve();
      });
      attachments.set(scope, scope.attach());
    });
  const parentScope = runtime.createScope({
    id: `parent-${fixtureId}`,
    binding: binding((selector) => keyOf(selector) === keyOf(northParent)),
    initial: northParent,
  });
  await waitActive(parentScope);
  const childAllowed = (selector: ScopeSelector) => {
    const parent = parentScope.getSnapshot();
    const lineage = selector.lineage ?? [];
    return (
      parent.active &&
      parent.selector !== null &&
      parent.permissionRevision === (permissions.get(keyOf(parent.selector)) ?? 1) &&
      parent.policyRevision === `policy:${keyOf(parent.selector)}` &&
      selector.kind === 'workspace' &&
      lineage.length === 1 &&
      lineage[0]?.kind === parent.selector.kind &&
      lineage[0]?.id === parent.selector.id
    );
  };
  const leftScope = runtime.createScope({ id: `child-${fixtureId}`, binding: binding(childAllowed), initial: north });
  const rightScope = runtime.createScope({
    id: `peer-${fixtureId}`,
    binding: binding((selector) => keyOf(selector) === keyOf(south)),
    initial: south,
  });
  await Promise.all([waitActive(leftScope), waitActive(rightScope)]);
  const createOrders = (scope: typeof leftScope) => {
    const selector = scope.getSnapshot().selector;
    if (selector === null) throw new TypeError('Parallel scope is inactive.');
    const regionId = `surface-${++regionSequence}`;
    regionKeys.set(regionId, keyOf(selector));
    return runtime.createSurface({
      scope,
      id: 'orders',
      feature: ordersFeature,
      bindings: bindings(serviceFor(selector)),
    });
  };
  const parentOrders = createOrders(parentScope);
  let leftOrders = createOrders(leftScope);
  const rightOrders = createOrders(rightScope);
  return {
    parentScope,
    parentOrders,
    leftScope,
    rightScope,
    leftOrders: () => leftOrders,
    rightOrders,
    keyOf,
    authorityDigests,
    revokeRuntime(selector: ScopeSelector) {
      revokedRuntimeKeys.add(keyOf(selector));
    },
    allowRuntime(selector: ScopeSelector) {
      revokedRuntimeKeys.delete(keyOf(selector));
    },
    async changeLeft(selector: ScopeSelector) {
      const previous = leftOrders;
      const result = await leftScope.requestChange(selector);
      if (result.status === 'active') leftOrders = createOrders(leftScope);
      return { previous, result, current: leftOrders };
    },
    disposeLeft: () => {
      attachments.get(leftScope)?.();
      attachments.delete(leftScope);
      leftScope.dispose();
    },
    dispose: () => {
      for (const detach of attachments.values()) detach();
      attachments.clear();
      leftScope.dispose();
      parentScope.dispose();
      rightScope.dispose();
      runtime.dispose();
    },
  };
}
