import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { createRegionStore } from '@varendo/runtime/regions';
import { createResultStore } from '@varendo/runtime/results';

/**
 * Adverse lifecycle probe.
 *
 * This is an in-process async-iterator adapter. It exercises the built
 * @varendo/runtime package exports and deliberately makes no network claim.
 * The adapter records source pulls/returns/late values so the report retains
 * the cleanup and concurrency observations that public runtime snapshots do
 * not expose directly.
 */

const timingEnabled = process.env.AELIQO_RUN_PERFORMANCE !== '0';

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

function controlledSource(label, metrics, { cooperativeReturn = true } = {}) {
  const queue = [];
  const waiters = [];
  let closed = false;
  let started = false;
  let returned = false;
  let firstPullResolve;
  const firstPull = new Promise((resolvePromise) => {
    firstPullResolve = resolvePromise;
  });

  const settle = (result) => {
    const waiter = waiters.shift();
    if (waiter === undefined) queue.push(result);
    else waiter(result);
  };

  const close = (kind) => {
    if (closed) return;
    closed = true;
    if (kind === 'return' && !returned) metrics.returnedSources += 1;
    if (started) metrics.activeSources = Math.max(0, metrics.activeSources - 1);
    for (const waiter of waiters.splice(0)) waiter({ done: true, value: undefined });
  };

  const source = {
    label,
    [Symbol.asyncIterator]() {
      return source;
    },
    next() {
      metrics.pulls += 1;
      if (!started) {
        started = true;
        metrics.startedSources += 1;
        metrics.activeSources += 1;
        metrics.maxActiveSources = Math.max(metrics.maxActiveSources, metrics.activeSources);
        firstPullResolve();
      }
      if (queue.length > 0) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve({ done: true, value: undefined });
      return new Promise((resolvePromise) => waiters.push(resolvePromise));
    },
    return() {
      if (returned) return Promise.resolve({ done: true, value: undefined });
      returned = true;
      metrics.returnedSources += 1;
      if (cooperativeReturn) close('return');
      return Promise.resolve({ done: true, value: undefined });
    },
    push(value) {
      if (closed) {
        metrics.lateDropped += 1;
        return;
      }
      if (returned) {
        const waiter = waiters.shift();
        if (waiter === undefined) metrics.lateDropped += 1;
        else {
          metrics.deliveredAfterReturn += 1;
          waiter({ done: false, value });
        }
        return;
      }
      settle({ done: false, value });
    },
    end() {
      close('end');
    },
    async ready() {
      await firstPull;
    },
    get closed() {
      return closed;
    },
  };
  metrics.sources.push(source);
  return source;
}

async function drain(subscription) {
  const updates = [];
  for await (const update of subscription) updates.push(update);
  return updates;
}

const baseResultRef = Object.freeze({
  id: 'adverse-result',
  revision: 'result-r1',
  outputId: 'rows',
  queryDigest: 'adverse-query',
  scopeDigest: 'adverse-scope',
});

function resultEvents(rowId, sourceRevision) {
  const ref = { ...baseResultRef };
  const populationDigest = `population-${sourceRevision}`;
  const descriptor = {
    version: '1',
    ref,
    taskId: 'adverse-task',
    fields: [{ id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' }],
    identity: ['id'],
    rowGrain: ['id'],
    counts: { loaded: 1, population: { kind: 'exact', value: 1, populationDigest } },
    precision: { kind: 'exact' },
    coverage: { kind: 'complete', populationDigest },
    consistency: { kind: 'snapshot', snapshotId: sourceRevision, sourceRevisions: { records: sourceRevision } },
    evidence: { kind: 'observed', source: { id: 'records', revision: sourceRevision } },
    filters: [],
    warnings: [],
    lineage: [],
  };
  return [
    { kind: 'descriptor', descriptor },
    { kind: 'batch', result: ref, sequence: 0, rows: [{ id: rowId }] },
    { kind: 'complete', result: ref, finalCoverage: { kind: 'complete', populationDigest } },
  ];
}

function resultKey(requestId, sourceRevision = 'source-a') {
  return {
    principalKey: 'adverse-principal',
    scopeDigest: baseResultRef.scopeDigest,
    policyRevision: 'adverse-policy',
    populationDigest: `population-${sourceRevision}`,
    queryDigest: baseResultRef.queryDigest,
    catalogRevision: 'adverse-catalog',
    functionRegistryDigest: 'adverse-functions',
    sourceRevision,
    outputId: baseResultRef.outputId,
    taskId: 'adverse-task',
    requestId,
  };
}

function makeRegionFixture() {
  const authority = {
    principalKey: 'adverse-principal',
    scopeDigest: 'adverse-scope',
    policyRevision: 'adverse-policy',
    catalogRevision: 'adverse-catalog',
    experienceRevision: 'adverse-experience',
    functionRegistryDigest: 'adverse-functions',
    results: [],
  };
  const task = {
    version: '1',
    id: 'adverse-region-task',
    revision: 'task-r1',
    catalogRevision: authority.catalogRevision,
    functionRegistryDigest: authority.functionRegistryDigest,
    regionId: 'adverse-region',
    goal: 'Run an adverse lifecycle probe',
    kind: 'presentation',
    needs: [],
    assumptions: [],
    inputs: [],
  };
  return { authority, task, state: { task } };
}

function writeReport(report) {
  const output = process.env.AELIQO_ADVERSE_RUNTIME_OUTPUT;
  if (output === undefined || output.length === 0) return Promise.resolve();
  return mkdir(dirname(output), { recursive: true }).then(() =>
    writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  );
}

async function runSlowSourceProbe() {
  const metrics = {
    sources: [],
    pulls: 0,
    startedSources: 0,
    returnedSources: 0,
    lateDropped: 0,
    deliveredAfterReturn: 0,
    activeSources: 0,
    maxActiveSources: 0,
  };
  const store = createResultStore({ maxEntries: 8 });
  const handle = store.begin(resultKey('slow-source'));
  const source = controlledSource('slow-source', metrics);
  const startedAt = timingEnabled ? performance.now() : undefined;
  const updatesPromise = drain(handle.subscribe(source));
  await source.ready();
  await sleep(12);
  for (const event of resultEvents('slow-row', 'source-a')) source.push(event);
  const updates = await updatesPromise;
  const elapsedMs = timingEnabled ? performance.now() - startedAt : undefined;
  const snapshot = handle.snapshot();
  const observation = {
    elapsedMs,
    updateCount: updates.length,
    finalStatus: snapshot.status,
    sourceRevision: snapshot.key.sourceRevision,
    loadedRows: snapshot.loadedRows,
    retainedBatches: snapshot.batches.length,
    activeSources: metrics.activeSources,
    maxActiveSources: metrics.maxActiveSources,
    retainedHandleBeforeCleanup: store.get(handle.key) === handle,
  };
  handle.dispose();
  observation.retainedHandleAfterCleanup = store.get(handle.key) !== undefined;
  observation.retainedBatchesAfterCleanup = handle.snapshot().batches.length;
  store.dispose();
  return { observation, metrics };
}

async function runSupersedingStormProbe() {
  const metrics = {
    sources: [],
    pulls: 0,
    startedSources: 0,
    returnedSources: 0,
    lateDropped: 0,
    deliveredAfterReturn: 0,
    activeSources: 0,
    maxActiveSources: 0,
  };
  const store = createResultStore({ maxEntries: 64 });
  const key = resultKey('storm-1');
  const handles = [];
  const sources = [];
  const drains = [];
  const requestCount = 16;
  for (let index = 0; index < requestCount; index += 1) {
    const handle = store.begin({ ...key, requestId: `storm-${index + 1}` });
    const source = controlledSource(`storm-${index + 1}`, metrics);
    handles.push(handle);
    sources.push(source);
    drains.push(drain(handle.subscribe(source)));
    await source.ready();
  }
  const newest = sources.at(-1);
  for (const source of sources.slice(0, -1))
    for (const event of resultEvents('late-row', 'source-a')) source.push(event);
  for (const event of resultEvents('new-row', 'source-a')) newest.push(event);
  const updates = await Promise.all(drains);
  const snapshots = handles.map((handle) => handle.snapshot());
  const current = store.get(key);
  const observation = {
    requestCount,
    supersededCount: snapshots.filter((snapshot) => snapshot.status === 'stale').length,
    disposedBeforeCleanup: snapshots.filter((snapshot) => snapshot.status === 'disposed').length,
    staleRows: snapshots.slice(0, -1).reduce((sum, snapshot) => sum + snapshot.loadedRows, 0),
    finalStatus: snapshots.at(-1)?.status,
    finalRows: snapshots.at(-1)?.batches.flatMap((batch) => batch.rows.map((row) => row.id)) ?? [],
    finalGeneration: snapshots.at(-1)?.generation,
    currentGeneration: current?.generation,
    terminalUpdates: updates.map((items) => items.at(-1)?.snapshot.status),
    activeSources: metrics.activeSources,
    maxActiveSources: metrics.maxActiveSources,
    lateDropped: metrics.lateDropped,
    deliveredAfterReturn: metrics.deliveredAfterReturn,
  };
  for (const handle of handles) handle.dispose();
  const retainedAfterDispose = store.get(key) !== undefined;
  const disposedAfterCleanup = handles.filter((handle) => handle.snapshot().status === 'disposed').length;
  const retainedBuffersAfterCleanup = handles.reduce((sum, handle) => sum + handle.snapshot().batches.length, 0);
  store.dispose();
  return {
    observation: { ...observation, retainedAfterDispose, disposedAfterCleanup, retainedBuffersAfterCleanup },
    metrics,
  };
}

async function runNonCooperativeLateDeliveryProbe() {
  const metrics = {
    sources: [],
    pulls: 0,
    startedSources: 0,
    returnedSources: 0,
    lateDropped: 0,
    deliveredAfterReturn: 0,
    activeSources: 0,
    maxActiveSources: 0,
  };
  const store = createResultStore({ maxEntries: 8 });

  const superseded = store.begin(resultKey('non-cooperative-old', 'source-a'));
  const oldSource = controlledSource('non-cooperative-superseded', metrics, { cooperativeReturn: false });
  const oldDrain = drain(superseded.subscribe(oldSource));
  await oldSource.ready();
  const current = store.begin(resultKey('non-cooperative-current', 'source-a'));
  const oldDescriptor = resultEvents('late-descriptor', 'source-a')[0];
  oldSource.push(oldDescriptor);
  oldSource.end();
  const currentSource = controlledSource('non-cooperative-current', metrics);
  const currentDrain = drain(current.subscribe(currentSource));
  await currentSource.ready();
  for (const event of resultEvents('current-row', 'source-a')) currentSource.push(event);
  const [oldUpdates, currentUpdates] = await Promise.all([oldDrain, currentDrain]);
  const supersededSnapshot = superseded.snapshot();
  const currentSnapshot = current.snapshot();

  const disposed = store.begin(resultKey('non-cooperative-disposed', 'source-b'));
  const disposedSource = controlledSource('non-cooperative-disposed', metrics, { cooperativeReturn: false });
  const disposedDrain = drain(disposed.subscribe(disposedSource));
  await disposedSource.ready();
  disposed.dispose();
  const oldBatch = resultEvents('late-batch', 'source-b')[1];
  disposedSource.push(oldBatch);
  disposedSource.end();
  const disposedUpdates = await disposedDrain;
  const disposedSnapshot = disposed.snapshot();
  const observation = {
    supersededStatus: supersededSnapshot.status,
    supersededDescriptorRetained: supersededSnapshot.descriptor !== undefined,
    supersededRows: supersededSnapshot.loadedRows,
    supersededUpdates: oldUpdates.length,
    currentStatus: currentSnapshot.status,
    currentRows: currentSnapshot.batches.flatMap((batch) => batch.rows.map((row) => row.id)),
    currentUpdates: currentUpdates.length,
    disposedStatus: disposedSnapshot.status,
    disposedDescriptorRetained: disposedSnapshot.descriptor !== undefined,
    disposedRows: disposedSnapshot.loadedRows,
    disposedUpdates: disposedUpdates.length,
    activeSources: metrics.activeSources,
    maxActiveSources: metrics.maxActiveSources,
    deliveredAfterReturn: metrics.deliveredAfterReturn,
  };
  current.dispose();
  store.dispose();
  return { observation, metrics };
}

async function runRevisionAndRegionCleanupProbe() {
  const metrics = {
    sources: [],
    pulls: 0,
    startedSources: 0,
    returnedSources: 0,
    lateDropped: 0,
    deliveredAfterReturn: 0,
    activeSources: 0,
    maxActiveSources: 0,
  };
  const resultStore = createResultStore({ maxEntries: 8 });
  const oldHandle = resultStore.begin(resultKey('revision-a', 'source-a'));
  const oldSource = controlledSource('source-a', metrics);
  const oldDrain = drain(oldHandle.subscribe(oldSource));
  await oldSource.ready();

  const freshHandle = resultStore.begin(resultKey('revision-b', 'source-b'));
  const freshSource = controlledSource('source-b', metrics);
  const freshDrain = drain(freshHandle.subscribe(freshSource));
  await freshSource.ready();
  const revisionChangedAt = timingEnabled ? performance.now() : undefined;
  oldHandle.dispose();
  for (const event of resultEvents('old-row', 'source-a')) oldSource.push(event);
  for (const event of resultEvents('fresh-row', 'source-b')) freshSource.push(event);
  const [oldUpdates, freshUpdates] = await Promise.all([oldDrain, freshDrain]);

  let authorizationStarted;
  let resolveAuthorization;
  const authorizationPromise = new Promise((resolvePromise) => {
    resolveAuthorization = resolvePromise;
  });
  const fixture = makeRegionFixture();
  let aborted = false;
  const regionStore = createRegionStore({
    readAuthority: () => ({ ok: true, value: fixture.authority }),
    authorizeCommit: ({ signal }) => {
      authorizationStarted?.();
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
        },
        { once: true },
      );
      return authorizationPromise;
    },
  });
  const created = regionStore.create({ id: fixture.task.regionId, state: fixture.state });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error(created.diagnostics[0]?.message ?? 'region creation failed');
  const region = created.value;
  let observerUpdates = 0;
  const observer = region.observe(() => {
    observerUpdates += 1;
  });
  let resolveStarted;
  const started = new Promise((resolvePromise) => {
    resolveStarted = resolvePromise;
  });
  authorizationStarted = resolveStarted;
  const staged = await region.stage({
    requestId: 'dispose-request',
    expected: region.snapshot().readSet,
    state: fixture.state,
  });
  assert.equal(staged.ok, true);
  if (!staged.ok) throw new Error(staged.diagnostics[0]?.message ?? 'region stage failed');
  const commitPromise = region.commit(staged.value);
  await started;
  const disposeStartedAt = timingEnabled ? performance.now() : undefined;
  region.dispose();
  resolveAuthorization({ ok: true, value: undefined });
  const commit = await commitPromise;
  const regionSnapshot = region.snapshot();
  const regionHistory = region.history();
  const revisionObservation = {
    elapsedMs: timingEnabled ? performance.now() - revisionChangedAt : undefined,
    oldUpdates: oldUpdates.length,
    oldStatus: oldHandle.snapshot().status,
    oldRows: oldHandle.snapshot().loadedRows,
    oldSourceRevision: oldHandle.snapshot().key.sourceRevision,
    freshUpdates: freshUpdates.length,
    freshStatus: freshHandle.snapshot().status,
    freshRows: freshHandle.snapshot().batches.flatMap((batch) => batch.rows.map((row) => row.id)),
    freshSourceRevision: freshHandle.snapshot().key.sourceRevision,
    freshGeneration: freshHandle.generation,
    oldGeneration: oldHandle.generation,
    activeSources: metrics.activeSources,
    staleLateEventsDropped: metrics.lateDropped,
    deliveredAfterDispose: metrics.deliveredAfterReturn,
    regionCommitCode: commit.ok ? null : commit.diagnostics[0]?.code,
    regionStatus: regionSnapshot.status,
    regionObserverClosed: observer.closed,
    regionStoreEntryAfterDispose: regionStore.get(fixture.task.regionId) !== undefined,
    regionHistoryLength: regionHistory.length,
    observerUpdates,
    authorizationAborted: aborted,
    disposeToCommitMs: timingEnabled ? performance.now() - disposeStartedAt : undefined,
  };
  freshHandle.dispose();
  resultStore.dispose();
  regionStore.dispose();
  return { observation: revisionObservation, metrics };
}

async function runProbe() {
  const startedAt = timingEnabled ? performance.now() : undefined;
  const slow = await runSlowSourceProbe();
  const storm = await runSupersedingStormProbe();
  const lateDelivery = await runNonCooperativeLateDeliveryProbe();
  const revision = await runRevisionAndRegionCleanupProbe();
  return {
    schema: 'aeliqo.performance.adverse-runtime.v1',
    sourceCommit: process.env.AELIQO_SOURCE_COMMIT ?? 'unknown',
    sourceAdapter: 'in-process async-iterator adapter; no network/server capacity claim',
    packageEntry: '@varendo/runtime/results and @varendo/runtime/regions built package exports',
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    method: {
      slowSourceDelayMs: 12,
      supersedingRequests: 16,
      lifecycle:
        'ResultStore subscription cancellation, source revision change with explicit prior-handle disposal, RegionStore pending commit disposal',
      publicSignals: [
        'ResultHandle.snapshot',
        'ResultStore.get',
        'RegionHandle.snapshot',
        'RegionHandle.history',
        'RegionObserver.closed',
      ],
      rawSourceMetrics: true,
      sourceRevisionPolicy:
        'source-a and source-b use independent cache slots; the prior source-a handle is explicitly disposed before late delivery',
    },
    elapsedMs: timingEnabled ? performance.now() - startedAt : undefined,
    slowSource: slow.observation,
    supersedingStorm: storm.observation,
    nonCooperativeLateDelivery: lateDelivery.observation,
    revisionAndRegionCleanup: revision.observation,
    sourceMetrics: {
      slowSource: { ...slow.metrics, sources: slow.metrics.sources.map(({ label, closed }) => ({ label, closed })) },
      supersedingStorm: {
        ...storm.metrics,
        sources: storm.metrics.sources.map(({ label, closed }) => ({ label, closed })),
      },
      nonCooperativeLateDelivery: {
        ...lateDelivery.metrics,
        sources: lateDelivery.metrics.sources.map(({ label, closed }) => ({ label, closed })),
      },
      revision: {
        ...revision.metrics,
        sources: revision.metrics.sources.map(({ label, closed }) => ({ label, closed })),
      },
    },
    interpretation: {
      observed: [
        'Late events from superseded or disposed subscriptions were not committed to their ResultHandle snapshots.',
        'A non-cooperative source resolved one outstanding next() after runtime return/dispose; the delivered descriptor/batch did not alter the closed or stale handle.',
        'The newest superseding generation retained the expected row identity and source revision.',
        'A pending RegionStore authorization was aborted by dispose and did not publish a commit.',
      ],
      limitations: [
        'The adapter is in-process; this report does not prove HTTP, socket, proxy or backend cancellation.',
        'No heap or garbage-collection verdict is inferred from public handle/store counts.',
        'Timing values are raw observations from one Node process and are not product performance qualification.',
      ],
    },
  };
}

test('adverse runtime lifecycle keeps final identity, rejects stale arrival, and cleans ownership', async () => {
  const report = await runProbe();
  assert.equal(report.slowSource.finalStatus, 'ready');
  assert.equal(report.slowSource.loadedRows, 1);
  assert.equal(report.slowSource.sourceRevision, 'source-a');
  assert.equal(report.supersedingStorm.supersededCount, 15);
  assert.deepEqual(report.supersedingStorm.finalRows, ['new-row']);
  assert.equal(report.supersedingStorm.finalStatus, 'ready');
  assert.equal(report.supersedingStorm.staleRows, 0);
  assert.equal(report.supersedingStorm.retainedAfterDispose, false);
  assert.equal(report.supersedingStorm.deliveredAfterReturn, 0);
  assert.equal(report.sourceMetrics.supersedingStorm.startedSources, 16);
  assert.equal(report.sourceMetrics.supersedingStorm.returnedSources, 16);
  assert.equal(report.sourceMetrics.supersedingStorm.sources.filter(({ closed }) => closed).length, 16);
  assert.equal(report.supersedingStorm.maxActiveSources, 1);
  assert.equal(report.supersedingStorm.disposedAfterCleanup, 16);
  assert.equal(report.supersedingStorm.retainedBuffersAfterCleanup, 0);
  assert.equal(report.sourceMetrics.supersedingStorm.lateDropped, 45);
  assert.equal(report.nonCooperativeLateDelivery.supersededStatus, 'stale');
  assert.equal(report.nonCooperativeLateDelivery.supersededDescriptorRetained, false);
  assert.equal(report.nonCooperativeLateDelivery.supersededRows, 0);
  assert.equal(report.nonCooperativeLateDelivery.currentStatus, 'ready');
  assert.deepEqual(report.nonCooperativeLateDelivery.currentRows, ['current-row']);
  assert.equal(report.nonCooperativeLateDelivery.disposedStatus, 'disposed');
  assert.equal(report.nonCooperativeLateDelivery.disposedDescriptorRetained, false);
  assert.equal(report.nonCooperativeLateDelivery.disposedRows, 0);
  assert.equal(report.nonCooperativeLateDelivery.deliveredAfterReturn, 2);
  assert.equal(report.nonCooperativeLateDelivery.activeSources, 0);
  assert.equal(report.nonCooperativeLateDelivery.maxActiveSources, 1);
  assert.equal(report.sourceMetrics.nonCooperativeLateDelivery.startedSources, 3);
  assert.equal(report.sourceMetrics.nonCooperativeLateDelivery.returnedSources, 3);
  assert.equal(report.sourceMetrics.nonCooperativeLateDelivery.sources.filter(({ closed }) => closed).length, 3);
  assert.equal(report.revisionAndRegionCleanup.oldStatus, 'disposed');
  assert.equal(report.revisionAndRegionCleanup.oldRows, 0);
  assert.deepEqual(report.revisionAndRegionCleanup.freshRows, ['fresh-row']);
  assert.equal(report.revisionAndRegionCleanup.freshStatus, 'ready');
  assert.equal(report.revisionAndRegionCleanup.freshSourceRevision, 'source-b');
  assert.equal(report.revisionAndRegionCleanup.deliveredAfterDispose, 0);
  assert.equal(report.revisionAndRegionCleanup.staleLateEventsDropped, 3);
  assert.equal(report.sourceMetrics.revision.startedSources, 2);
  assert.equal(report.sourceMetrics.revision.returnedSources, 2);
  assert.equal(report.sourceMetrics.revision.sources.filter(({ closed }) => closed).length, 2);
  assert.equal(report.revisionAndRegionCleanup.regionCommitCode, 'runtime.region-disposed');
  assert.equal(report.revisionAndRegionCleanup.regionStatus, 'disposed');
  assert.equal(report.revisionAndRegionCleanup.regionObserverClosed, true);
  assert.equal(report.revisionAndRegionCleanup.regionStoreEntryAfterDispose, false);
  assert.equal(report.revisionAndRegionCleanup.authorizationAborted, true);
  assert.equal(report.sourceMetrics.supersedingStorm.activeSources, 0);
  await writeReport(report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
});

export { runProbe };
