import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const FIXTURE_PATH = '/tests/performance/browser.html';
const BATCH_SIZE = 10;
const DEFAULT_BATCH_COUNT = 1;
const FULL_BATCH_COUNT = 10;

type HeapUsage = {
  readonly usedSize: number | null;
  readonly totalSize: number | null;
  readonly embedderHeapUsedSize: number | null;
  readonly backingStorageSize: number | null;
  readonly availableFieldCount: number;
  readonly missingFields: readonly string[];
};

type HeapSample = HeapUsage & { readonly label: string; readonly footprintBytes: number | null };

type DomCounters = {
  readonly rootChildren: number;
  readonly componentCount: number;
  readonly inputCount: number;
  readonly tableCount: number;
  readonly documentComponentCount: number;
};

type ListenerCounters = {
  readonly trackedRegistrationCount: number;
  readonly connectedListenerCount: number;
  readonly detachedListenerCount: number;
  readonly trackedTargetCount: number;
};

type BatchObservation = {
  readonly batch: number;
  readonly cycles: number;
  readonly peakComponentCount: number;
  readonly peakRenderedRows: number;
  readonly disposalChecks: readonly DomCounters[];
  readonly listeners: ListenerCounters | null;
  readonly finalDom: DomCounters;
};

type HeapLifecyclePageApi = {
  readonly runBatch: (cycles: number, batch: number) => Promise<BatchObservation>;
  readonly snapshotListeners: () => ListenerCounters;
  readonly stop: () => ListenerCounters;
};

type PerformanceApi = {
  readonly ready: boolean;
  readonly smallStandalone: () => Promise<unknown>;
  readonly mountDispose: () => Promise<{
    readonly cycles: number;
    readonly resources: {
      readonly cycles: number;
      readonly retainedHandles: number;
      readonly liveRegions: number;
      readonly openObservers: number;
      readonly bounded: boolean;
    };
    readonly bounded: boolean;
  }>;
};

type RuntimeCleanup = Awaited<ReturnType<PerformanceApi['mountDispose']>>;
type RuntimeCleanupSummary = Pick<RuntimeCleanup, 'cycles' | 'resources' | 'bounded'>;

declare global {
  interface Window {
    __aeliqoHeapLifecycle: HeapLifecyclePageApi | undefined;
    __aeliqoHeapPositiveControl: { readonly strings: readonly string[]; readonly bytes: Uint8Array } | undefined;
  }
}

const HEAP_USAGE_FIELDS = ['usedSize', 'totalSize', 'embedderHeapUsedSize', 'backingStorageSize'] as const;
const LIVE_HEAP_FIELDS = ['usedSize', 'embedderHeapUsedSize', 'backingStorageSize'] as const;

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseHeapUsage(response: unknown): HeapUsage {
  const record = response !== null && typeof response === 'object' ? (response as Record<string, unknown>) : {};
  const usage = {
    usedSize: finiteOrNull(record.usedSize),
    totalSize: finiteOrNull(record.totalSize),
    embedderHeapUsedSize: finiteOrNull(record.embedderHeapUsedSize),
    backingStorageSize: finiteOrNull(record.backingStorageSize),
  };
  const missingFields = HEAP_USAGE_FIELDS.filter((field) => usage[field] === null);
  return { ...usage, availableFieldCount: HEAP_USAGE_FIELDS.length - missingFields.length, missingFields };
}

function heapFootprint(usage: HeapUsage): number | null {
  if (LIVE_HEAP_FIELDS.some((field) => usage[field] === null)) return null;
  return usage.usedSize! + usage.embedderHeapUsedSize! + usage.backingStorageSize!;
}

function byteDelta(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left - right;
}

async function openFixture(page: Page): Promise<void> {
  await page.goto(FIXTURE_PATH, { waitUntil: 'load' });
  await page.waitForFunction(
    () => (window as Window & { aeliqoPerformance?: { ready: boolean } }).aeliqoPerformance?.ready === true,
  );
}

async function warmup(
  page: Page,
  includeRuntimeProbe: boolean,
): Promise<{
  readonly smallFixture: unknown;
  readonly runtimeCleanup: RuntimeCleanupSummary | null;
  readonly remainingChildren: number;
}> {
  return page.evaluate(
    async (
      includeRuntimeProbe: boolean,
    ): Promise<{
      readonly smallFixture: unknown;
      readonly runtimeCleanup: RuntimeCleanupSummary | null;
      readonly remainingChildren: number;
    }> => {
      const api = (window as unknown as { aeliqoPerformance?: PerformanceApi }).aeliqoPerformance;
      if (api?.ready !== true) throw new Error('Performance workload API is unavailable.');
      const smallFixture = await api.smallStandalone();
      const runtimeCleanup = includeRuntimeProbe
        ? (() => {
            return api
              .mountDispose()
              .then((runtime) => ({ cycles: runtime.cycles, resources: runtime.resources, bounded: runtime.bounded }));
          })()
        : null;
      const resolvedRuntimeCleanup = runtimeCleanup === null ? null : await runtimeCleanup;
      document.querySelector<HTMLElement>('#fixture')?.replaceChildren();
      return {
        smallFixture,
        runtimeCleanup: resolvedRuntimeCleanup,
        remainingChildren: document.querySelector<HTMLElement>('#fixture')?.children.length ?? 0,
      };
    },
    includeRuntimeProbe,
  );
}

async function installLifecycleTracker(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#fixture');
    if (root === null) throw new Error('Performance fixture root is missing.');
    if (window.__aeliqoHeapLifecycle !== undefined) throw new Error('Heap lifecycle tracker is already installed.');

    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const listenerIds = new WeakMap<object, number>();
    const registrations = new WeakMap<EventTarget, Set<string>>();
    const targetReferences = new WeakMap<EventTarget, WeakRef<EventTarget>>();
    const trackedTargets = new Set<WeakRef<EventTarget>>();
    let nextListenerId = 0;

    const listenerKey = (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): string => {
      if (listener === null)
        return `${type}:null:${Boolean(options === true || (typeof options === 'object' && options.capture))}`;
      let id = listenerIds.get(listener);
      if (id === undefined) {
        id = ++nextListenerId;
        listenerIds.set(listener, id);
      }
      return `${type}:${id}:${Boolean(options === true || (typeof options === 'object' && options.capture))}`;
    };

    const snapshotListeners = (): ListenerCounters => {
      let trackedRegistrationCount = 0;
      let connectedListenerCount = 0;
      let detachedListenerCount = 0;
      const visitedTargets = new Set<EventTarget>();
      const deadReferences: WeakRef<EventTarget>[] = [];
      for (const reference of trackedTargets) {
        const target = reference.deref();
        if (target === undefined) {
          deadReferences.push(reference);
          continue;
        }
        if (visitedTargets.has(target)) continue;
        visitedTargets.add(target);
        const listeners = registrations.get(target);
        if (listeners === undefined || listeners.size === 0) continue;
        trackedRegistrationCount += listeners.size;
        const connected = target === window || target === document || (target instanceof Node && target.isConnected);
        if (connected) connectedListenerCount += listeners.size;
        else detachedListenerCount += listeners.size;
      }
      for (const reference of deadReferences) trackedTargets.delete(reference);
      return {
        trackedRegistrationCount,
        connectedListenerCount,
        detachedListenerCount,
        trackedTargetCount: visitedTargets.size,
      };
    };

    const domCounters = (): DomCounters => {
      const components = root.querySelectorAll('aeliqo-text-field, aeliqo-table');
      return {
        rootChildren: root.children.length,
        componentCount: components.length,
        inputCount: root.querySelectorAll('aeliqo-text-field').length,
        tableCount: root.querySelectorAll('aeliqo-table').length,
        documentComponentCount: document.querySelectorAll('aeliqo-text-field, aeliqo-table').length,
      };
    };

    const rows = (cycle: number): Array<Record<string, string | number>> =>
      Array.from({ length: 12 }, (_, index) => ({
        id: `heap-cycle-${cycle}-row-${index + 1}`,
        label: `Heap cycle ${cycle} row ${index + 1}`,
        value: index + cycle,
      }));

    const runBatch = async (cycles: number, batch: number): Promise<BatchObservation> => {
      let peakComponentCount = 0;
      let peakRenderedRows = 0;
      const disposalChecks: DomCounters[] = [];
      for (let cycle = 0; cycle < cycles; cycle += 1) {
        const input = document.createElement('aeliqo-text-field') as HTMLElement & {
          label: string;
          value: string;
          updateComplete: Promise<unknown>;
        };
        const table = document.createElement('aeliqo-table') as HTMLElement & {
          caption: string;
          columns: readonly { key: string; label: string }[];
          identity: readonly string[];
          rows: readonly Record<string, string | number>[];
          updateComplete: Promise<unknown>;
          shadowRoot: ShadowRoot | null;
        };
        input.label = `Heap lifecycle input ${batch}-${cycle + 1}`;
        input.value = String(cycle);
        table.caption = 'Heap lifecycle records';
        table.columns = [
          { key: 'id', label: 'ID' },
          { key: 'label', label: 'Label' },
          { key: 'value', label: 'Value' },
        ];
        table.identity = ['id'];
        table.rows = rows(cycle + batch * cycles);
        root.replaceChildren(input, table);
        await Promise.all([input.updateComplete, table.updateComplete]);
        peakComponentCount = Math.max(
          peakComponentCount,
          root.querySelectorAll('aeliqo-text-field, aeliqo-table').length,
        );
        peakRenderedRows = Math.max(peakRenderedRows, table.shadowRoot?.querySelectorAll('tbody tr').length ?? 0);
        input.remove();
        table.remove();
        root.replaceChildren();
        disposalChecks.push(domCounters());
      }
      return {
        batch,
        cycles,
        peakComponentCount,
        peakRenderedRows,
        disposalChecks,
        listeners: null,
        finalDom: domCounters(),
      };
    };

    EventTarget.prototype.addEventListener = function (type, listener, options) {
      const key = listenerKey(type, listener, options);
      const set = registrations.get(this) ?? new Set<string>();
      if (!set.has(key)) {
        set.add(key);
        registrations.set(this, set);
        if (targetReferences.get(this) === undefined) {
          const reference = new WeakRef(this);
          targetReferences.set(this, reference);
          trackedTargets.add(reference);
        }
      }
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      const key = listenerKey(type, listener, options);
      const set = registrations.get(this);
      if (set?.delete(key) && set.size === 0) {
        const reference = targetReferences.get(this);
        if (reference !== undefined) trackedTargets.delete(reference);
        targetReferences.delete(this);
      }
      return originalRemove.call(this, type, listener, options);
    };

    const stop = (): ListenerCounters => {
      const snapshot = snapshotListeners();
      trackedTargets.clear();
      EventTarget.prototype.addEventListener = originalAdd;
      EventTarget.prototype.removeEventListener = originalRemove;
      window.__aeliqoHeapLifecycle = undefined;
      return snapshot;
    };

    window.__aeliqoHeapLifecycle = { runBatch, snapshotListeners, stop };
  });
}

test('captures bounded component lifecycle heap evidence', async ({ page, browser }, testInfo) => {
  await openFixture(page);
  const full = process.env.AELIQO_RUN_HEAP_LIFECYCLE === '1';
  const batchCount = full ? FULL_BATCH_COUNT : DEFAULT_BATCH_COUNT;
  const warmupReport = await warmup(page, full);
  await installLifecycleTracker(page);

  const client = await page.context().newCDPSession(page);
  await client.send('Runtime.enable');
  await client.send('HeapProfiler.enable');
  const collectGarbage = async (): Promise<void> => {
    await client.send('HeapProfiler.collectGarbage');
  };
  const readUsage = async (
    label: string,
  ): Promise<{ readonly sample: HeapSample; readonly listeners: ListenerCounters | null }> => {
    await collectGarbage();
    const listeners = await page.evaluate(() => window.__aeliqoHeapLifecycle?.snapshotListeners() ?? null);
    const usage = parseHeapUsage(await client.send('Runtime.getHeapUsage'));
    return { sample: { ...usage, label, footprintBytes: heapFootprint(usage) }, listeners };
  };

  const batchReports: Array<{
    readonly batch: number;
    readonly before: HeapSample;
    readonly after: HeapSample;
    readonly observation: BatchObservation;
  }> = [];
  const environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    viewport: { width: innerWidth, height: innerHeight },
    devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
  }));
  const baselineRead = await readUsage('baseline-after-warmup');
  const baseline = baselineRead.sample;
  try {
    let before = baseline;
    for (let batch = 1; batch <= batchCount; batch += 1) {
      const observation = await page.evaluate(
        async ({ cycles, batch: batchNumber }) => {
          const tracker = window.__aeliqoHeapLifecycle;
          if (tracker === undefined) throw new Error('Heap lifecycle tracker is unavailable.');
          return tracker.runBatch(cycles, batchNumber);
        },
        { cycles: BATCH_SIZE, batch },
      );
      const afterRead = await readUsage(`batch-${batch}-after-gc`);
      const after = afterRead.sample;
      batchReports.push({ batch, before, after, observation: { ...observation, listeners: afterRead.listeners } });
      before = after;
    }

    const positiveControlBefore = before;
    const heldControl = await page.evaluate(() => {
      const strings = Array.from({ length: 131_072 }, (_, index) => `${index}:${'x'.repeat(64)}`);
      const bytes = new Uint8Array(8 * 1024 * 1024);
      bytes.fill(17);
      window.__aeliqoHeapPositiveControl = { strings, bytes };
      return { stringCount: strings.length, byteLength: bytes.byteLength };
    });
    const positiveControlHeld = (await readUsage('positive-control-held-after-gc')).sample;
    await page.evaluate(() => {
      window.__aeliqoHeapPositiveControl = undefined;
    });
    const positiveControlReleased = (await readUsage('positive-control-released-after-gc')).sample;
    await page.evaluate(() => document.querySelector<HTMLElement>('#fixture')?.replaceChildren());
    const finalDom = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('#fixture');
      return {
        rootChildren: root?.children.length ?? 0,
        documentComponentCount: document.querySelectorAll('aeliqo-text-field, aeliqo-table').length,
      };
    });
    const finalListeners = await page.evaluate(() => window.__aeliqoHeapLifecycle?.stop() ?? null);
    const lastBatch = batchReports.at(-1);
    const report = {
      schema: 'aeliqo.performance.heap-lifecycle.v1',
      sourceCommit: process.env.AELIQO_SOURCE_COMMIT ?? 'unknown',
      mode: full ? 'full-100-cycle' : 'functional-10-cycle',
      environment: {
        node: process.version,
        browser: browser.version(),
        project: testInfo.project.name,
        ...environment,
      },
      method: {
        fixture: FIXTURE_PATH,
        measuredBatchCount: batchCount,
        batchSize: BATCH_SIZE,
        measuredCycles: batchCount * BATCH_SIZE,
        warmup: full
          ? 'The exported smallStandalone workload and mountDispose runtime cleanup probe run before the measured batches; their work is excluded from measured heap samples.'
          : 'The exported smallStandalone workload runs before the measured batch; the full mountDispose runtime cleanup probe is opt-in with AELIQO_RUN_HEAP_LIFECYCLE=1.',
        heapUsage: 'Chromium CDP Runtime.getHeapUsage',
        collection:
          'Chromium CDP HeapProfiler.collectGarbage requested before every heap sample; dead listener WeakRefs are pruned synchronously after collection and before Runtime.getHeapUsage.',
        heapMetric:
          'combinedLiveHeapFootprintBytes = usedSize + embedderHeapUsedSize + backingStorageSize; totalSize is retained as a raw field but excluded from the metric because it includes allocator capacity.',
        listenerInstrumentation:
          'EventTarget registration bookkeeping installed only for measured component batches, deduplicated per target, pruned after collection, and restored before the report is written.',
      },
      warmup: warmupReport,
      baseline,
      batches: batchReports,
      cleanup: { finalDom, finalListeners, lastBatch: lastBatch?.observation.finalDom ?? null },
      positiveControl: {
        allocation: heldControl,
        metric:
          'combinedLiveHeapFootprintBytes = usedSize + embedderHeapUsedSize + backingStorageSize; all three fields must be finite for byte deltas, while totalSize remains a raw allocator-capacity observation.',
        before: positiveControlBefore,
        held: positiveControlHeld,
        released: positiveControlReleased,
        heldIncreaseBytes: byteDelta(positiveControlHeld.footprintBytes, positiveControlBefore.footprintBytes),
        releaseReductionBytes: byteDelta(positiveControlHeld.footprintBytes, positiveControlReleased.footprintBytes),
        responsive:
          positiveControlHeld.footprintBytes !== null &&
          positiveControlBefore.footprintBytes !== null &&
          positiveControlReleased.footprintBytes !== null &&
          positiveControlHeld.footprintBytes > positiveControlBefore.footprintBytes &&
          positiveControlReleased.footprintBytes < positiveControlHeld.footprintBytes,
      },
      trend: {
        postGcFootprints: batchReports.map(({ batch, after }) => ({
          batch,
          footprintBytes: after.footprintBytes,
          usedSize: after.usedSize,
          totalSize: after.totalSize,
          embedderHeapUsedSize: after.embedderHeapUsedSize,
          backingStorageSize: after.backingStorageSize,
        })),
        firstPostGcFootprintBytes: batchReports[0]?.after.footprintBytes ?? null,
        lastPostGcFootprintBytes: lastBatch?.after.footprintBytes ?? null,
        netPostGcDeltaBytes:
          lastBatch === undefined
            ? null
            : byteDelta(lastBatch.after.footprintBytes, batchReports[0]!.after.footprintBytes),
      },
      interpretation: {
        observed:
          'Batch samples are raw post-requested-GC observations. A rising or falling trend is an investigation signal for this browser run, not a leak verdict or a heap budget.',
        positiveControl:
          'The held allocation must increase combinedLiveHeapFootprintBytes and release must reduce it; deltas become explicit null when any of the three metric fields is unavailable.',
        limitations: [
          'This is one Chromium process and one production Vite fixture.',
          'Heap totals are allocator/runtime observations; retained capacity can remain in totalSize after release.',
          'The listener tracker uses deduplicated WeakRefs and prunes dead references after requested collection; registration and detached-listener counts are diagnostic bookkeeping and do not prove a production retention path.',
          'Automatic once or AbortSignal listener removal is not observed as a removeEventListener call, so listener counters are diagnostic rather than a complete event-listener inventory.',
          'Zero connected listeners and empty DOM/resource counters do not prove that every object is collectible.',
          'No universal memory budget or cross-device leak claim is inferred.',
        ],
      },
    };
    const output = testInfo.outputPath('heap-lifecycle-report.json');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await testInfo.attach('heap-lifecycle-report.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    expect(report.method.measuredCycles).toBe(batchCount * BATCH_SIZE);
    expect(batchReports).toHaveLength(batchCount);
    expect(
      batchReports.every(
        ({ observation }) =>
          observation.cycles === BATCH_SIZE && observation.peakComponentCount === 2 && observation.peakRenderedRows > 0,
      ),
    ).toBe(true);
    expect(
      batchReports.every(({ observation }) =>
        observation.disposalChecks.every(
          (dom) => dom.rootChildren === 0 && dom.componentCount === 0 && dom.documentComponentCount === 0,
        ),
      ),
    ).toBe(true);
    expect(report.cleanup.finalDom).toMatchObject({ rootChildren: 0, documentComponentCount: 0 });
    expect(report.cleanup.finalListeners).toMatchObject({ connectedListenerCount: 0 });
    if (report.warmup.runtimeCleanup !== null)
      expect(report.warmup.runtimeCleanup.resources).toMatchObject({
        retainedHandles: 0,
        liveRegions: 0,
        openObservers: 0,
        bounded: true,
      });
    expect(report.positiveControl.responsive).toBe(true);
  } finally {
    await client.detach();
  }
});
