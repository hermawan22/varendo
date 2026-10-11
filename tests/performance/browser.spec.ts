import { test, expect, type Page } from '@playwright/test';
import { createSourceGuard } from '../../scripts/performance/provenance.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname } from 'node:path';

type TraceEvent = {
  readonly name?: unknown;
  readonly dur?: unknown;
  readonly ts?: unknown;
  readonly ph?: unknown;
  readonly cat?: unknown;
};

function traceEvent(value: unknown): TraceEvent | undefined {
  return typeof value === 'object' && value !== null ? (value as TraceEvent) : undefined;
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? null;
}

function tracePhaseSummary(
  events: readonly TraceEvent[],
  matches: (event: TraceEvent, normalizedName: string) => boolean,
) {
  const selected = events.filter((event) =>
    matches(
      event,
      String(event.name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]/gu, ''),
    ),
  );
  const durations = selected.map((event) =>
    typeof event.dur === 'number' && Number.isFinite(event.dur) ? event.dur / 1000 : 0,
  );
  return {
    count: selected.length,
    timedCount: durations.filter((duration) => duration > 0).length,
    totalMs: durations.reduce((total, duration) => total + duration, 0),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations.length === 0 ? null : Math.max(...durations),
    names: [...new Set(selected.map((event) => String(event.name ?? 'unknown')))].sort(),
  };
}

function summarizeTrace(events: readonly unknown[]) {
  const parsed = events.map(traceEvent).filter((event): event is TraceEvent => event !== undefined);
  return {
    eventCount: parsed.length,
    script: tracePhaseSummary(
      parsed,
      (_event, name) =>
        name.includes('script') || ['functioncall', 'runmicrotasks', 'v8execute', 'compilecode'].includes(name),
    ),
    layout: tracePhaseSummary(
      parsed,
      (_event, name) => name === 'layout' || name === 'updatelayouttree' || name === 'recalculatestyles',
    ),
    paint: tracePhaseSummary(parsed, (_event, name) => name === 'paint' || name.startsWith('paint')),
    compositeLayers: tracePhaseSummary(parsed, (_event, name) => name === 'compositelayers'),
  };
}

type PerformanceApi = {
  smallStandalone: (options?: { timed?: boolean }) => Promise<any>;
  mediumViews: (options?: { timed?: boolean }) => Promise<any>;
  targetedReducer: (options?: { timed?: boolean }) => Promise<any>;
  boundedGeometry: (sourceUrl: string) => Promise<any>;
  mountDispose: () => Promise<any>;
  runAll: (options: { timed?: boolean; sourceUrl: string }) => Promise<any>;
  ready: boolean;
};

interface LargeSourceFixture {
  readonly url: string;
  close(): Promise<void>;
}

async function startLargeSourceFixture(): Promise<LargeSourceFixture> {
  const source = {
    populationRows: 1_000_000,
    recordAt(index: number) {
      return { id: `source-row-${index + 1}`, label: `Source row ${index + 1}`, value: index };
    },
    readWindow(limit: number, cursor: string | null) {
      const start = cursor === 'page-1' || cursor === null ? 0 : 100;
      const records = Array.from({ length: limit }, (_, index) => this.recordAt(start + index));
      return {
        populationRows: this.populationRows,
        requestedRows: limit,
        executedRows: records.length,
        examinedRows: records.length,
        cursor,
        records,
      };
    },
  };
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || requestUrl.pathname !== '/rows') {
      response.writeHead(404).end();
      return;
    }
    const parsedLimit = Number(requestUrl.searchParams.get('limit') ?? '100');
    const requestedRows = Number.isSafeInteger(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 100;
    const encoded = JSON.stringify(source.readWindow(requestedRows, requestUrl.searchParams.get('cursor')));
    response
      .writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(encoded),
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'content-length',
      })
      .end(encoded);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Large source fixture did not bind a TCP port.');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function openFixture(page: Page): Promise<void> {
  await page.goto('/tests/performance/browser.html');
  await page.waitForFunction(
    () => (window as Window & { aeliqoPerformance?: PerformanceApi }).aeliqoPerformance?.ready === true,
  );
}

test('runs small, medium, large-window, reducer and teardown workloads', async ({ page }) => {
  await openFixture(page);
  const source = await startLargeSourceFixture();
  let result: any;
  try {
    result = await page.evaluate(async (sourceUrl): Promise<any> => {
      const api = (window as Window & { aeliqoPerformance?: PerformanceApi }).aeliqoPerformance;
      if (api === undefined) throw new Error('Performance API is unavailable.');
      const all = (await api.runAll({ timed: false, sourceUrl })) as any;
      return {
        small: await api.smallStandalone(),
        medium: await api.mediumViews(),
        large: all.large,
        reducer: await api.targetedReducer(),
        geometry: await api.boundedGeometry(sourceUrl),
        cleanup: await api.mountDispose(),
      };
    }, source.url);
  } finally {
    await source.close();
  }
  expect(result.small.rowCount).toBe(100);
  expect(result.small.renderedRows).toBe(100);
  expect(result.small.inputValue).toBe('ready');
  expect(result.medium.rowCount).toBe(10_000);
  expect(result.medium.views).toBe(30);
  expect(result.medium.virtualRows).toBeLessThanOrEqual(30 * 100);
  expect(['composed', 'search-exhausted']).toContain(result.medium.plan.status);
  expect(result.medium.plan.nodes).toBe(31);
  expect(result.medium.plan.candidateCount).toBe(64);
  expect(result.large.populationRows).toBe(1_000_000);
  expect(result.large.requestedRows).toBe(100);
  expect(result.large.executedRows).toBe(100);
  expect(result.large.examinedRows).toBe(100);
  expect(result.large.transferredRows).toBe(100);
  expect(result.large.contentLengthBodyBytes).toBeGreaterThan(0);
  expect(result.large.responseBodyBytes).toBe(result.large.contentLengthBodyBytes);
  expect(result.large.mountedRows).toBeLessThanOrEqual(100);
  expect(result.reducer.successful).toBe(result.reducer.iterations);
  expect(result.reducer.unrelatedRoutes).toBe(0);
  expect(result.geometry.geometry.bounded).toBe(true);
  expect(result.cleanup.bounded).toBe(true);
});

test('records first/subsequent observations with a Chromium layout/paint trace', async ({ page }, testInfo) => {
  const sourceGuard = await createSourceGuard(process.cwd());
  const sourceCommit = sourceGuard.commit;
  test.skip(
    process.env.AELIQO_RUN_PERFORMANCE !== '1',
    'Set AELIQO_RUN_PERFORMANCE=1 to run timing workloads in isolation.',
  );
  test.skip(testInfo.project.use.browserName !== 'chromium', 'The CDP timeline trace is Chromium-specific.');
  await openFixture(page);
  const source = await startLargeSourceFixture();
  const client = await page.context().newCDPSession(page);
  const traceEvents: unknown[] = [];
  client.on('Tracing.dataCollected', (event: { value?: unknown[] }) => {
    if (Array.isArray(event.value)) traceEvents.push(...event.value);
  });
  await client.send('Tracing.start', {
    transferMode: 'ReportEvents',
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-lighthouse',
      'blink.user_timing',
      'v8.execute',
      'toplevel',
      'blink',
      'cc',
    ].join(','),
  });
  let report: unknown;
  try {
    report = await page.evaluate(async (sourceUrl): Promise<any> => {
      const api = (window as Window & { aeliqoPerformance?: PerformanceApi }).aeliqoPerformance;
      if (api === undefined) throw new Error('Performance API is unavailable.');
      return api.runAll({ timed: true, sourceUrl });
    }, source.url);
  } finally {
    await new Promise<void>((resolve, reject) => {
      const complete = () => resolve();
      client.once('Tracing.tracingComplete', complete);
      client.send('Tracing.end').catch(reject);
    });
    await source.close();
  }
  await client.detach();
  const measured = report as any;
  const trace = summarizeTrace(traceEvents);
  const tracePhasesAvailable = trace.script.count > 0 && trace.layout.count > 0 && trace.paint.count > 0;
  const plannerDurations =
    (measured as any)?.medium?.measurement?.results?.subsequent
      ?.map((sample: any) => sample?.plan?.durationMs)
      ?.filter((duration: unknown): duration is number => typeof duration === 'number' && Number.isFinite(duration)) ??
    [];
  const reducerDispatchDurations =
    (measured as any)?.reducer?.results?.subsequent
      ?.flatMap((sample: any) => (Array.isArray(sample?.rawMs) ? sample.rawMs : []))
      ?.filter((duration: unknown): duration is number => typeof duration === 'number' && Number.isFinite(duration)) ??
    [];
  const plannerP95Ms = percentile(plannerDurations, 0.95);
  const reducerDispatchP95Ms = percentile(reducerDispatchDurations, 0.95);
  await writeFile(
    testInfo.outputPath('chromium-timeline-trace.json'),
    `${JSON.stringify({ traceEvents, trace }, null, 2)}\n`,
    'utf8',
  );
  const budgetAssertions = {
    targetedReducerDispatchP95Ms: reducerDispatchP95Ms,
    largeMountedRows: measured.large?.sample?.mountedRows,
    targetedReducerWithinBudget: reducerDispatchP95Ms !== null && reducerDispatchP95Ms <= 4,
    largeGeometryWithinBudget: measured.large?.sample?.mountedRows <= 100,
    tracePhasesAvailable,
    enforced: process.env.AELIQO_ENFORCE_PERFORMANCE_BUDGETS !== '0',
  };
  const sourceChangedDuringRun = !(await sourceGuard.current());
  const output = testInfo.outputPath('performance-report.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify({ sourceCommit, sourceChangedDuringRun, report, trace, plannerP95Ms, budgetAssertions }, null, 2)}\n`,
    'utf8',
  );
  expect(report).toMatchObject({
    environment: { runtime: 'browser' },
    small: { measurement: { first: { rawMs: expect.any(Array) }, subsequent: { rawMs: expect.any(Array) } } },
  });
  expect(tracePhasesAvailable).toBe(true);
  expect(sourceChangedDuringRun).toBe(false);
  if (budgetAssertions.enforced)
    expect(budgetAssertions).toMatchObject({
      targetedReducerWithinBudget: true,
      largeGeometryWithinBudget: true,
    });
});
