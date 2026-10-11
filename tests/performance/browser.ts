import { AeliqoTextFieldElement } from '@varendo/web/inputs';
import { AeliqoTableElement } from '@varendo/web/table';
import {
  LARGE_TRANSFERRED_ROW_COUNT,
  MEDIUM_ROW_COUNT,
  MEDIUM_FIELD_COUNT,
  MEDIUM_VIEW_COUNT,
  SMALL_ROW_COUNT,
  firstSubsequent,
  environmentSnapshot,
  makeRows,
  runMediumPlanner,
  runRuntimeResourceCycles,
  runTargetedReducer,
} from './workloads.mjs';

declare global {
  interface Window {
    aeliqoPerformance?: {
      smallStandalone: (options?: { timed?: boolean }) => Promise<unknown>;
      mediumViews: (options?: { timed?: boolean }) => Promise<unknown>;
      targetedReducer: (options?: { timed?: boolean }) => Promise<unknown>;
      boundedGeometry: (sourceUrl: string) => Promise<unknown>;
      mountDispose: () => Promise<unknown>;
      runAll: (options: { timed?: boolean; sourceUrl: string }) => Promise<unknown>;
      ready: boolean;
    };
  }
}

const root: HTMLElement =
  document.querySelector<HTMLElement>('#fixture') ??
  (() => {
    throw new Error('Performance fixture root is missing.');
  })();

if (!customElements.get('aeliqo-text-field')) customElements.define('aeliqo-text-field', AeliqoTextFieldElement);
if (!customElements.get('aeliqo-table')) customElements.define('aeliqo-table', AeliqoTableElement);

type TestTable = AeliqoTableElement & { readonly updateComplete: Promise<unknown> };

function resetFixture(): void {
  root.replaceChildren();
}

function table(rows: readonly Record<string, string | number>[], virtualized = false, totalRows?: number): TestTable {
  const element = document.createElement('aeliqo-table') as TestTable;
  element.caption = 'Performance records';
  element.columns = [
    { key: 'id', label: 'ID' },
    { key: 'label', label: 'Label' },
    { key: 'value', label: 'Value' },
  ];
  element.identity = ['id'];
  element.rows = rows;
  element.virtualized = virtualized;
  element.virtualCount = 40;
  element.overscan = 4;
  if (totalRows !== undefined) element.totalRows = totalRows;
  root.append(element);
  return element;
}

async function settle(element: TestTable | AeliqoTextFieldElement): Promise<void> {
  await element.updateComplete;
}

async function smallOnce(): Promise<{
  readonly rowCount: number;
  readonly renderedRows: number;
  readonly inputValue: string;
}> {
  resetFixture();
  const rows = makeRows(SMALL_ROW_COUNT);
  const control = document.createElement('aeliqo-text-field') as AeliqoTextFieldElement;
  control.label = 'Standalone value';
  control.value = 'ready';
  const dataTable = table(rows);
  root.prepend(control);
  await Promise.all([settle(control), settle(dataTable)]);
  const renderedRows = dataTable.shadowRoot?.querySelectorAll('tbody tr').length ?? 0;
  const input = control.shadowRoot?.querySelector('input') as HTMLInputElement | null;
  return { rowCount: rows.length, renderedRows, inputValue: input?.value ?? '' };
}

async function mediumOnce(timed = false): Promise<{
  readonly rowCount: number;
  readonly rowFieldCount: number;
  readonly views: number;
  readonly virtualRows: number;
  readonly plan: ReturnType<typeof runMediumPlanner>;
}> {
  resetFixture();
  const rows = makeRows(MEDIUM_ROW_COUNT, MEDIUM_FIELD_COUNT);
  const views = Array.from({ length: MEDIUM_VIEW_COUNT }, () => table(rows, true, MEDIUM_ROW_COUNT));
  await Promise.all(views.map((view) => settle(view)));
  const virtualRows = views.reduce(
    (total, view) => total + (view.shadowRoot?.querySelectorAll('tbody tr').length ?? 0),
    0,
  );
  const plan = runMediumPlanner({ timed });
  return { rowCount: rows.length, rowFieldCount: MEDIUM_FIELD_COUNT, views: views.length, virtualRows, plan };
}

async function largeOnce(sourceUrl: string): Promise<{
  readonly populationRows: number;
  readonly requestedRows: number;
  readonly transferredRows: number;
  readonly mountedRows: number;
  readonly totalRows: number;
  readonly executedRows: number;
  readonly examinedRows: number;
  readonly contentLengthBodyBytes: number;
  readonly responseBodyBytes: number;
}> {
  resetFixture();
  const response = await fetch(
    `${sourceUrl.replace(/\/$/u, '')}/rows?limit=${LARGE_TRANSFERRED_ROW_COUNT}&cursor=page-1`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`large source fixture returned ${response.status}`);
  const responseBuffer = await response.arrayBuffer();
  const payload = JSON.parse(new TextDecoder().decode(responseBuffer)) as {
    populationRows: number;
    requestedRows: number;
    executedRows: number;
    examinedRows: number;
    records: Array<Record<string, string | number>>;
  };
  const rows = payload.records;
  const dataTable = table(rows, true, payload.populationRows);
  await settle(dataTable);
  const mountedRows = dataTable.shadowRoot?.querySelectorAll('tbody tr').length ?? 0;
  return {
    populationRows: payload.populationRows,
    requestedRows: payload.requestedRows,
    transferredRows: rows.length,
    mountedRows,
    totalRows: dataTable.totalRows ?? 0,
    executedRows: payload.executedRows,
    examinedRows: payload.examinedRows,
    contentLengthBodyBytes: Number(response.headers.get('content-length') ?? 0),
    responseBodyBytes: responseBuffer.byteLength,
  };
}

async function measured(label: string, once: () => Promise<unknown>, timed: boolean): Promise<unknown> {
  if (!timed) return once();
  const measurement = await firstSubsequent(label, async () => once());
  const sample = await once();
  return { sample, measurement };
}

async function boundedGeometry(sourceUrl: string): Promise<unknown> {
  const result = await largeOnce(sourceUrl);
  const dataTable = root.querySelector('aeliqo-table') as TestTable | null;
  const bodyRows = dataTable?.shadowRoot?.querySelectorAll('tbody tr') ?? [];
  const rects = [...bodyRows].map((row) => row.getBoundingClientRect());
  return {
    result,
    geometry: {
      mountedRectCount: rects.length,
      maxMountedRows: 100,
      bounded: rects.length <= 100,
      totalWidth: dataTable?.getBoundingClientRect().width ?? 0,
    },
  };
}

async function mountDispose(measure = false): Promise<unknown> {
  resetFixture();
  const heapMemory = (): number | undefined => {
    const memory = (performance as Performance & { memory?: { readonly usedJSHeapSize?: number } }).memory;
    return memory?.usedJSHeapSize;
  };
  const heapBefore = measure ? heapMemory() : undefined;
  const heapSamples: Array<{ readonly cycle: number; readonly usedBytes: number | undefined }> = [];
  let activeListeners = 0;
  let trackedRegistrations = 0;
  let listenerId = 0;
  const ids = new WeakMap<object, number>();
  const registrations = new WeakMap<EventTarget, Set<string>>();
  const trackedTargets = new Set<EventTarget>();
  const originalAdd = EventTarget.prototype.addEventListener;
  const originalRemove = EventTarget.prototype.removeEventListener;
  const listenerKey = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): string => {
    if (listener === null)
      return `${type}:null:${Boolean(options === true || (typeof options === 'object' && options.capture))}`;
    let id = ids.get(listener);
    if (id === undefined) {
      id = ++listenerId;
      ids.set(listener, id);
    }
    return `${type}:${id}:${Boolean(options === true || (typeof options === 'object' && options.capture))}`;
  };
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const key = listenerKey(type, listener, options);
    const set = registrations.get(this) ?? new Set<string>();
    if (!set.has(key)) {
      set.add(key);
      trackedRegistrations += 1;
      registrations.set(this, set);
      trackedTargets.add(this);
    }
    return originalAdd.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const key = listenerKey(type, listener, options);
    const set = registrations.get(this);
    if (set?.delete(key)) trackedRegistrations -= 1;
    return originalRemove.call(this, type, listener, options);
  };
  try {
    for (let cycle = 0; cycle < 100; cycle += 1) {
      const field = document.createElement('aeliqo-text-field') as AeliqoTextFieldElement;
      field.label = `Cycle ${cycle + 1}`;
      field.value = String(cycle);
      root.append(field);
      await field.updateComplete;
      field.remove();
      if (measure && (cycle + 1) % 20 === 0) heapSamples.push({ cycle: cycle + 1, usedBytes: heapMemory() });
    }
  } finally {
    EventTarget.prototype.addEventListener = originalAdd;
    EventTarget.prototype.removeEventListener = originalRemove;
  }
  for (const target of trackedTargets) {
    if (target === window || (target instanceof Node && target.isConnected)) {
      activeListeners += registrations.get(target)?.size ?? 0;
    }
  }
  const detachedRegistrations = Math.max(0, trackedRegistrations - activeListeners);
  trackedTargets.clear();
  const resources = runRuntimeResourceCycles(100);
  const heapAfter = measure ? heapMemory() : undefined;
  return {
    cycles: 100,
    activeListeners,
    detachedRegistrations,
    remainingElements: root.children.length,
    resources,
    ...(measure
      ? {
          heap: {
            supported: heapBefore !== undefined && heapAfter !== undefined,
            beforeBytes: heapBefore,
            afterBytes: heapAfter,
            samples: heapSamples,
            deltaBytes: heapBefore === undefined || heapAfter === undefined ? undefined : heapAfter - heapBefore,
          },
        }
      : {}),
    bounded: activeListeners === 0 && root.children.length === 0 && resources.bounded,
  };
}

async function targetedReducer(options: { timed?: boolean } = {}): Promise<unknown> {
  if (!options.timed) return runTargetedReducer(100, { timed: false });
  return firstSubsequent('targeted-reducer', () => runTargetedReducer());
}

async function runAll(options: { timed?: boolean; sourceUrl?: string } = {}): Promise<unknown> {
  if (options.sourceUrl === undefined)
    throw new Error('A large workload source URL is required; metadata-only population probes are not accepted.');
  const timed = options.timed === true;
  const started = timed ? performance.now() : undefined;
  const small = await measured('small-standalone', smallOnce, timed);
  const medium = await measured('medium-planner-and-views', () => mediumOnce(timed), timed);
  const large = await measured('large-bounded-source-window', () => largeOnce(options.sourceUrl!), timed);
  const reducer = await targetedReducer({ timed });
  const geometry = await boundedGeometry(options.sourceUrl);
  const cleanup = await mountDispose(timed);
  return {
    environment: environmentSnapshot(),
    ...(timed ? { elapsedMs: performance.now() - started! } : {}),
    small,
    medium,
    large,
    reducer,
    geometry,
    cleanup,
    notes: [
      'First/subsequent samples reuse one already-loaded browser page; they do not claim a process or HTTP-cache cold start.',
      'Layout and paint evidence belongs to the Chromium timeline trace; requestAnimationFrame/updateComplete is not used as a paint measurement.',
      'Large workload fetches 100 records from a local indexed source fixture whose declared population is 1,000,000 rows, and records executed/examined rows plus response body bytes. Content-Length is reported as a body-byte declaration; it is not a full transport-byte measurement including headers.',
      'The teardown probe counts connected listeners separately from detached shadow-root registrations released with their owning elements, and checks ResultStore leases plus Region observers/controllers.',
    ],
  };
}

window.aeliqoPerformance = {
  smallStandalone: (options = {}) => measured('small-standalone', smallOnce, options.timed === true),
  mediumViews: (options = {}) =>
    measured('medium-planner-and-views', () => mediumOnce(options.timed === true), options.timed === true),
  targetedReducer,
  boundedGeometry,
  mountDispose,
  runAll,
  ready: true,
};
