import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createLocalDataService } from '@varendo/runtime/data';
import { expect, it } from 'vitest';
import { createPeopleFixture } from './fixtures/people.js';

it('keeps surface construction inert until an explicit request', () => {
  const f = createPeopleFixture();
  let sourceCalls = 0;
  const observed = {
    describe: (...args: Parameters<typeof f.source.describe>) => {
      sourceCalls += 1;
      return f.source.describe(...args);
    },
    plan: (...args: Parameters<typeof f.source.plan>) => {
      sourceCalls += 1;
      return f.source.plan(...args);
    },
    execute: (...args: Parameters<typeof f.source.execute>) => {
      sourceCalls += 1;
      return f.source.execute(...args);
    },
  };
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'inert',
    feature: f.feature,
    bindings: { ...f.bindings, source: { ...f.bindings.source, service: observed } },
  });

  expect(sourceCalls).toBe(0);
  expect(surface.getSnapshot()).toMatchObject({ phase: 'idle', revision: '0' });
  f.dispose();
});

it('keeps two instances of a feature independent', async () => {
  const f = createPeopleFixture();
  let releaseSource!: () => void;
  let markStarted!: () => void;
  const sourceGate = new Promise<void>((resolve) => {
    releaseSource = resolve;
  });
  const sourceStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const observed = {
    describe: (...args: Parameters<typeof f.source.describe>) => f.source.describe(...args),
    plan: (...args: Parameters<typeof f.source.plan>) => f.source.plan(...args),
    async *execute(...args: Parameters<typeof f.source.execute>) {
      markStarted();
      await sourceGate;
      yield* f.source.execute(...args);
    },
  };
  const a = f.runtime.createSurface({
    scope: f.scope,
    id: 'left',
    feature: f.feature,
    bindings: { ...f.bindings, source: { ...f.bindings.source, service: observed } },
  });
  const b = f.runtime.createSurface({ scope: f.scope, id: 'right', feature: f.feature, bindings: f.bindings });
  const before = b.getSnapshot();
  let rightNotifications = 0;
  const unsubscribe = b.subscribe(() => {
    rightNotifications += 1;
  });
  const leftPending = a.request({
    kind: 'browse',
    filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
  });
  await sourceStarted;
  expect(b.getSnapshot()).toBe(before);
  expect(rightNotifications).toBe(0);
  releaseSource();
  const leftResult = await leftPending;
  if (leftResult.status !== 'committed') throw new Error(JSON.stringify(leftResult));
  expect(b.getSnapshot()).toBe(before);
  expect(rightNotifications).toBe(0);
  expect(a.getSnapshot().state.rows).toEqual([{ id: 'sam', name: 'Sam Rivera', team: 'Engineering' }]);
  expect(a.id).not.toBe(b.id);
  await b.request({
    kind: 'browse',
    filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Design' },
  });
  expect(b.getSnapshot().state.rows).toEqual([{ id: 'ada', name: 'Ada Chen', team: 'Design' }]);
  expect(a.getSnapshot().state.rows).toEqual([{ id: 'sam', name: 'Sam Rivera', team: 'Engineering' }]);
  unsubscribe();
  f.dispose();
});

it('isolates equal feature and surface IDs across runtimes', async () => {
  const leftFixture = createPeopleFixture();
  const rightFixture = createPeopleFixture();
  const left = leftFixture.runtime.createSurface({
    scope: leftFixture.scope,
    id: 'people',
    feature: leftFixture.feature,
    bindings: leftFixture.bindings,
  });
  const right = rightFixture.runtime.createSurface({
    scope: rightFixture.scope,
    id: 'people',
    feature: rightFixture.feature,
    bindings: rightFixture.bindings,
  });
  const rightBefore = right.getSnapshot();

  await expect(left.request({ kind: 'browse' })).resolves.toMatchObject({ status: 'committed' });
  expect(right.getSnapshot()).toBe(rightBefore);
  expect(left.address.runtimeId).not.toBe(right.address.runtimeId);
  leftFixture.dispose();
  rightFixture.dispose();
});

it('keeps each surface bound to its own data service for the same feature ID', async () => {
  const f = createPeopleFixture();
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new TypeError(functions.diagnostics[0].message);
  const updated = createLocalDataService({
    snapshot: f.updatedSnapshot,
    functionRegistry: functions.value,
    authorize: () => ({
      ok: true,
      value: { scopeDigest: f.scope.getSnapshot().scopeInstanceId, policyRevision: 'local-policy-1' },
    }),
  });
  const left = f.runtime.createSurface({
    scope: f.scope,
    id: 'original',
    feature: f.feature,
    bindings: f.bindings,
  });
  const right = f.runtime.createSurface({
    scope: f.scope,
    id: 'updated',
    feature: f.feature,
    bindings: { ...f.bindings, source: { ...f.bindings.source, service: updated } },
  });
  const engineering = {
    kind: 'browse' as const,
    filter: { op: 'compare' as const, field: 'team', comparison: 'eq' as const, value: 'Engineering' },
  };

  await expect(left.request(engineering)).resolves.toMatchObject({ status: 'committed' });
  await expect(right.request(engineering)).resolves.toMatchObject({ status: 'committed' });
  expect(left.getSnapshot().state.rows.map((row) => row.id)).toEqual(['sam']);
  expect(right.getSnapshot().state.rows).toEqual([]);
  f.dispose();
});

it('rejects a request captured for another surface address', async () => {
  const f = createPeopleFixture();
  let planCalls = 0;
  const observed = {
    describe: (request: Parameters<typeof f.source.describe>[0], context: Parameters<typeof f.source.describe>[1]) =>
      f.source.describe(request, context),
    plan: (request: Parameters<typeof f.source.plan>[0], context: Parameters<typeof f.source.plan>[1]) => {
      planCalls += 1;
      return f.source.plan(request, context);
    },
    execute: (request: Parameters<typeof f.source.execute>[0], context: Parameters<typeof f.source.execute>[1]) =>
      f.source.execute(request, context),
  };
  const a = f.runtime.createSurface({
    scope: f.scope,
    id: 'left',
    feature: f.feature,
    bindings: { ...f.bindings, source: { ...f.bindings.source, service: observed } },
  });
  const b = f.runtime.createSurface({ scope: f.scope, id: 'right', feature: f.feature, bindings: f.bindings });
  const before = a.getSnapshot();

  await expect(a.request({ kind: 'browse' }, { expectedAddress: b.address })).resolves.toMatchObject({
    status: 'stale',
    diagnosticCode: 'surface.target-mismatch',
  });
  expect(planCalls).toBe(0);
  expect(a.getSnapshot()).toBe(before);
  f.dispose();
});

it('freezes copied address and state without freezing caller-owned objects', async () => {
  const f = createPeopleFixture();
  const callerState = { nested: { value: 'initial' } };
  const feature = {
    kind: 'feature' as const,
    id: 'copy-state',
    label: 'Copy state',
    definitionRevision: '1',
    parseIntent: (value: unknown) => ({ ok: true as const, value: value as { readonly kind: 'read' } }),
  };
  f.scope.setFeaturePermission('copy-state', true);
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'copy-state',
    feature,
    bindings: {
      initialIntent: { kind: 'read' },
      initialState: { nested: { value: 'empty' } },
      source: { kind: 'capability', read: async () => callerState },
    },
    ownership: { mode: 'internal', defaultIntent: { kind: 'read' } },
  });
  await surface.request({ kind: 'read' });
  const snapshot = surface.getSnapshot();
  expect(Object.isFrozen(snapshot.address)).toBe(true);
  expect(Object.isFrozen(snapshot.state.nested)).toBe(true);
  expect(Object.isFrozen(callerState)).toBe(false);
  callerState.nested.value = 'mutated';
  expect(snapshot.state.nested.value).toBe('initial');
  expect(() => {
    (surface.address as { surfaceGeneration: number }).surfaceGeneration = 99;
  }).toThrow();
  f.dispose();
});

it('rechecks local read permission for every request', async () => {
  const f = createPeopleFixture();
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'people',
    feature: f.feature,
    bindings: f.bindings,
  });
  f.scope.setFeaturePermission(f.feature.id, false);

  await expect(surface.request({ kind: 'browse' })).resolves.toMatchObject({
    status: 'denied',
    diagnosticCode: 'surface.permission-denied',
  });
  expect(surface.getSnapshot()).toMatchObject({ phase: 'denied', state: { rows: [], selection: [] } });
  f.dispose();
});

it('isolates throwing listeners from request completion and cleanup', async () => {
  const f = createPeopleFixture();
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'throwing-listener',
    feature: f.feature,
    bindings: f.bindings,
  });
  surface.subscribe(() => {
    throw new Error('observer failure');
  });

  await expect(surface.request({ kind: 'browse' })).resolves.toMatchObject({ status: 'committed' });
  expect(() => surface.dispose()).not.toThrow();
  f.dispose();
});
