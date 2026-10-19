import { test, expect, type Page } from '@playwright/test';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

type RawEventTiming = {
  readonly entryType: string;
  readonly name: string;
  readonly startTime: number | null;
  readonly duration: number | null;
  readonly processingStart: number | null;
  readonly processingEnd: number | null;
  readonly inputDelayMs: number | null;
  readonly processingDurationMs: number | null;
  readonly interactionId: number | null;
};

type InteractionCapture = {
  readonly sequence: number;
  readonly key: string;
  readonly trustedKeyboard: boolean;
  readonly keydownObservedAtMs: number | null;
  readonly keydownEventTimestampMs: number | null;
  readonly keyupEventTimestampMs: number | null;
  readonly queryBefore: string;
  readonly queryAfter: string;
  readonly visibleUpdate: {
    readonly atMs: number | null;
    readonly delayMs: number | null;
    readonly revision: number;
    readonly rowCount: number;
    readonly rowIds: readonly string[];
    readonly text: string;
  } | null;
  readonly eventTiming: {
    readonly status: 'observed' | 'missing-or-threshold-censored';
    readonly observationThresholdMs: number | null;
    readonly interactionId: number | null;
    readonly entries: readonly RawEventTiming[];
  };
};

type PerceivedInputApi = {
  readonly ready: boolean;
  readonly fixture: {
    readonly rowCount: number;
    readonly directInput: boolean;
    readonly tableRows: number;
    readonly retainedModuleGraphPath: string;
    readonly eventTimingObserverAvailable: boolean;
    readonly eventTimingThresholdMs: number;
  };
  readonly armCalibrationHandler: () => { readonly handlerMs: number };
  readonly beginInteraction: () => { readonly sequence: number; readonly queryBefore: string };
  readonly resetFixture: () => { readonly revision: number };
  readonly completeInteraction: () => InteractionCapture;
  readonly eventTimingEntryCount: () => number;
  readonly visibleUpdateReady: () => boolean;
};

type RetainedModuleGraph = {
  readonly schema: string;
  readonly entryModules: readonly string[];
  readonly retainedModules: readonly string[];
  readonly forbiddenModules: readonly string[];
};

type PerceivedInputReport = {
  readonly schema: string;
  readonly sourceCommit: string;
  readonly mode: 'functional-smoke' | 'extended-observation';
  readonly environment: {
    readonly userAgent: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly devicePixelRatio: number;
  };
  readonly fixture: {
    readonly rowCount: number;
    readonly directInput: boolean;
    readonly tableRows: number;
    readonly eventTimingObserverAvailable: boolean;
    readonly eventTimingThresholdMs: number;
  };
  readonly moduleGraph: RetainedModuleGraph;
  readonly interactions: readonly InteractionCapture[];
  readonly visibleUpdateSummary: {
    readonly sampleCount: number;
    readonly observedCount: number;
    readonly unavailableCount: number;
    readonly p50Ms: number | null;
    readonly p95Ms: number | null;
    readonly valuesMs: readonly number[];
  };
  readonly eventTimingSummary: {
    readonly sampleCount: number;
    readonly observedCount: number;
    readonly missingOrThresholdCensoredCount: number;
    readonly durationMs: readonly number[];
    readonly inputDelayMs: readonly number[];
    readonly processingDurationMs: readonly number[];
  };
  readonly network: { readonly requestsDuringInteractions: number; readonly urls: readonly string[] };
  readonly screenshots: readonly { readonly path: string; readonly bytes: number }[];
  readonly notes: readonly string[];
};

function finiteValues(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function nearestRank(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? null;
}

async function openFixture(page: Page): Promise<void> {
  await page.goto('/tests/performance/perceived-input.html', { waitUntil: 'load' });
  await page.waitForFunction(
    () => (window as Window & { varendoPerceivedInput?: PerceivedInputApi }).varendoPerceivedInput?.ready === true,
  );
}

async function api(page: Page): Promise<PerceivedInputApi> {
  return page.evaluate(() => {
    const value = (window as Window & { varendoPerceivedInput?: PerceivedInputApi }).varendoPerceivedInput;
    if (value?.ready !== true) throw new Error('Perceived input API is unavailable.');
    return value;
  });
}

async function captureInteractions(
  page: Page,
  count: number,
  testInfo: { outputPath(path: string): string },
): Promise<{
  readonly interactions: readonly InteractionCapture[];
  readonly screenshots: readonly { readonly path: string; readonly bytes: number }[];
  readonly requestUrls: readonly string[];
}> {
  const input = page.locator('#query').locator('input');
  const output = page.locator('#visible-result');
  const table = page.locator('#records');
  await expect(input).toBeVisible();
  await expect(output).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(100);
  const interactions: InteractionCapture[] = [];
  const screenshots: { path: string; bytes: number }[] = [];
  const requestUrls: string[] = [];
  let interactionActive = false;
  const requestListener = (request: { url(): string }) => {
    if (interactionActive) requestUrls.push(request.url());
  };
  page.on('request', requestListener);
  try {
    for (let index = 0; index < count; index += 1) {
      const key = String(index % 10);
      const reset = await page.evaluate(() => {
        const value = (window as Window & { varendoPerceivedInput?: PerceivedInputApi }).varendoPerceivedInput;
        if (value?.ready !== true) throw new Error('Perceived input API is unavailable.');
        return value.resetFixture();
      });
      await expect(output).toHaveAttribute('data-visible-revision', String(reset.revision));
      await expect(input).toHaveValue('');
      await expect(table.locator('tbody tr')).toHaveCount(100);
      const beforeRevision = String(reset.revision);
      await input.focus();
      await page.evaluate(() => {
        const value = (window as Window & { varendoPerceivedInput?: PerceivedInputApi }).varendoPerceivedInput;
        if (value?.ready !== true) throw new Error('Perceived input API is unavailable.');
        const interaction = value.beginInteraction();
        if (interaction.queryBefore !== '') throw new Error(`Expected reset input, got ${interaction.queryBefore}`);
      });
      interactionActive = true;
      await input.press(key);
      await expect.poll(() => output.getAttribute('data-visible-revision')).not.toBe(beforeRevision);
      await expect(output).toBeVisible();
      const expectedRowIds = expectedRowsForQuery(key);
      await expect(table.locator('tbody tr')).toHaveCount(expectedRowIds.length, { timeout: 5_000 });
      await page.waitForFunction(() => {
        const value = (window as Window & { varendoPerceivedInput?: PerceivedInputApi }).varendoPerceivedInput;
        return value?.visibleUpdateReady() === true;
      });
      // PerformanceObserver delivery is asynchronous; one task lets the browser
      // publish any Event Timing entry without using rAF or a Lit readiness hook.
      await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      interactionActive = false;
      const capture = await page.evaluate(() => {
        const value = (window as Window & { varendoPerceivedInput?: PerceivedInputApi }).varendoPerceivedInput;
        if (value?.ready !== true) throw new Error('Perceived input API is unavailable.');
        return value.completeInteraction();
      });
      interactions.push(capture);
      const shouldCaptureScreenshot = count <= 2 || index === 0 || index === count - 1;
      if (shouldCaptureScreenshot) {
        const path = testInfo.outputPath(`interaction-${index + 1}.png`);
        await page.screenshot({ path, fullPage: true });
        screenshots.push({ path, bytes: (await stat(path)).size });
      }
    }
  } finally {
    interactionActive = false;
    page.off('request', requestListener);
  }
  return { interactions, screenshots, requestUrls };
}

async function captureCalibration(
  page: Page,
): Promise<{ readonly requestedHandlerMs: number; readonly interaction: InteractionCapture }> {
  const input = page.locator('#query').locator('input');
  const output = page.locator('#visible-result');
  const table = page.locator('#records');
  const reset = await page.evaluate(() => {
    const value = (window as Window & { varendoPerceivedInput?: PerceivedInputApi }).varendoPerceivedInput;
    if (value?.ready !== true) throw new Error('Perceived input API is unavailable.');
    return value.resetFixture();
  });
  await expect(output).toHaveAttribute('data-visible-revision', String(reset.revision));
  await expect(input).toHaveValue('');
  await expect(table.locator('tbody tr')).toHaveCount(100);
  await input.focus();
  const calibrationStart = await page.evaluate(() => {
    const value = (window as Window & { varendoPerceivedInput?: PerceivedInputApi }).varendoPerceivedInput;
    if (value?.ready !== true) throw new Error('Perceived input API is unavailable.');
    const interaction = value.beginInteraction();
    if (interaction.queryBefore !== '') throw new Error(`Expected reset input, got ${interaction.queryBefore}`);
    return {
      requestedHandlerMs: value.armCalibrationHandler().handlerMs,
      eventTimingEntryCount: value.eventTimingEntryCount(),
    };
  });
  await input.press('0');
  await expect.poll(() => output.getAttribute('data-visible-revision')).not.toBe(String(reset.revision));
  await expect(table.locator('tbody tr')).toHaveCount(expectedRowsForQuery('0').length, { timeout: 5_000 });
  await page.waitForFunction(() => {
    const value = (window as Window & { varendoPerceivedInput?: PerceivedInputApi }).varendoPerceivedInput;
    return value?.visibleUpdateReady() === true;
  });
  // PerformanceObserver delivery is asynchronous; poll the fixture's observer count instead of guessing a delivery delay.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const value = (window as Window & { varendoPerceivedInput?: PerceivedInputApi }).varendoPerceivedInput;
          return value?.eventTimingEntryCount() ?? 0;
        }),
      { timeout: 5_000 },
    )
    .toBeGreaterThan(calibrationStart.eventTimingEntryCount);
  const requestedHandlerMs = calibrationStart.requestedHandlerMs;
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const interaction = await page.evaluate(() => {
    const value = (window as Window & { varendoPerceivedInput?: PerceivedInputApi }).varendoPerceivedInput;
    if (value?.ready !== true) throw new Error('Perceived input API is unavailable.');
    return value.completeInteraction();
  });
  return { requestedHandlerMs, interaction };
}

function expectedRowsForQuery(query: string): string[] {
  const normalized = query.toLocaleLowerCase();
  return Array.from({ length: 100 }, (_, index) => {
    const value = index + 1;
    const id = `row-${value}`;
    const label = `Local row ${value}`;
    return `${id} ${label} ${value}`.toLocaleLowerCase().includes(normalized) ? id : null;
  }).filter((value): value is string => value !== null);
}

function summarize(interactions: readonly InteractionCapture[]): {
  readonly visibleUpdateSummary: PerceivedInputReport['visibleUpdateSummary'];
  readonly eventTimingSummary: PerceivedInputReport['eventTimingSummary'];
} {
  const visible = finiteValues(interactions.map((interaction) => interaction.visibleUpdate?.delayMs));
  const eventTiming = interactions.flatMap((interaction) => interaction.eventTiming.entries);
  return {
    visibleUpdateSummary: {
      sampleCount: interactions.length,
      observedCount: visible.length,
      unavailableCount: interactions.length - visible.length,
      p50Ms: nearestRank(visible, 0.5),
      p95Ms: nearestRank(visible, 0.95),
      valuesMs: visible,
    },
    eventTimingSummary: {
      sampleCount: interactions.length,
      observedCount: interactions.filter((interaction) => interaction.eventTiming.status === 'observed').length,
      missingOrThresholdCensoredCount: interactions.filter(
        (interaction) => interaction.eventTiming.status !== 'observed',
      ).length,
      durationMs: finiteValues(eventTiming.map((entry) => entry.duration)),
      inputDelayMs: finiteValues(eventTiming.map((entry) => entry.inputDelayMs)),
      processingDurationMs: finiteValues(eventTiming.map((entry) => entry.processingDurationMs)),
    },
  };
}

test('measures trusted keyboard to visible DOM update on direct input and local 100-row table', async ({
  page,
}, testInfo) => {
  const extended = process.env.VARENDO_RUN_PERFORMANCE === '1';
  const interactionCount = extended ? 30 : 2;
  const sourceCommit = process.env.VARENDO_SOURCE_COMMIT ?? 'unknown';
  await openFixture(page);
  const fixtureApi = await api(page);
  expect(fixtureApi.fixture).toMatchObject({ rowCount: 100, directInput: true, tableRows: 100 });
  const captured = await captureInteractions(page, interactionCount, testInfo);
  const summaries = summarize(captured.interactions);
  const moduleGraphResponse = await page.request.get('/retained-modules.json');
  expect(moduleGraphResponse.ok()).toBe(true);
  const moduleGraph = (await moduleGraphResponse.json()) as RetainedModuleGraph;
  expect(moduleGraph.entryModules).toHaveLength(1);
  expect(moduleGraph.entryModules[0]).toContain('perceived-input.html');
  expect(moduleGraph.forbiddenModules).toEqual([]);
  const report: PerceivedInputReport = {
    schema: 'varendo.performance.perceived-input.v1',
    sourceCommit,
    mode: extended ? 'extended-observation' : 'functional-smoke',
    environment: await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
    })),
    fixture: fixtureApi.fixture,
    moduleGraph,
    interactions: captured.interactions,
    visibleUpdateSummary: summaries.visibleUpdateSummary,
    eventTimingSummary: summaries.eventTimingSummary,
    network: { requestsDuringInteractions: captured.requestUrls.length, urls: captured.requestUrls },
    screenshots: captured.screenshots,
    notes: [
      'Visible update is an observed DOM mutation of the live output/table fixture after a trusted keyboard event; it is not a paint timestamp and does not use requestAnimationFrame or Lit updateComplete.',
      'Event Timing fields are raw browser observations. The browser may omit entries below its configured duration threshold; missing-or-threshold-censored values remain null and are never encoded as zero.',
      'The 16 ms Event Timing observation threshold is the browser API floor documented for durationThreshold; an absent entry does not prove a fast interaction.',
      'This fixture uses direct @varendo/web input and table imports with local filtering only. No per-keystroke network or model request is allowed or expected.',
      'The result describes this Chromium fixture and environment only; it is not a universal INP, input-to-paint, whole-site, or lower-powered-device claim. No 100 ms p95 qualification is asserted.',
    ],
  };
  const output = testInfo.outputPath('perceived-input-report.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  expect(captured.interactions).toHaveLength(interactionCount);
  expect(captured.interactions.every((interaction) => interaction.trustedKeyboard)).toBe(true);
  expect(
    captured.interactions.every(
      (interaction) =>
        interaction.visibleUpdate !== null &&
        (interaction.visibleUpdate.delayMs === null || interaction.visibleUpdate.delayMs >= 0),
    ),
  ).toBe(true);
  expect(summaries.visibleUpdateSummary.observedCount).toBe(interactionCount);
  expect(captured.requestUrls).toEqual([]);
  expect(captured.screenshots.every((screenshot) => screenshot.bytes > 0)).toBe(true);
  for (const interaction of captured.interactions) {
    const expectedRowIds = expectedRowsForQuery(interaction.key);
    expect(interaction.queryBefore).toBe('');
    expect(interaction.queryAfter).toBe(interaction.key);
    expect(interaction.visibleUpdate?.rowCount).toBe(expectedRowIds.length);
    expect(interaction.visibleUpdate?.rowIds).toEqual(expectedRowIds);
    expect(
      interaction.eventTiming.status === 'observed' ||
        interaction.eventTiming.status === 'missing-or-threshold-censored',
    ).toBe(true);
    for (const entry of interaction.eventTiming.entries) {
      expect(entry.duration === null || entry.duration >= 0).toBe(true);
      expect(entry.inputDelayMs === null || entry.inputDelayMs >= 0).toBe(true);
      expect(entry.processingDurationMs === null || entry.processingDurationMs >= 0).toBe(true);
    }
  }
});

test('calibrates exact Event Timing association with a deliberate trusted keyboard handler', async ({
  page,
}, testInfo) => {
  const sourceCommit = process.env.VARENDO_SOURCE_COMMIT ?? 'unknown';
  await openFixture(page);
  const fixtureApi = await api(page);
  expect(fixtureApi.fixture.eventTimingObserverAvailable).toBe(true);
  const calibration = await captureCalibration(page);
  const keydownEntry = calibration.interaction.eventTiming.entries.find(
    (entry) => entry.name === 'keydown' && entry.startTime === calibration.interaction.keydownEventTimestampMs,
  );
  const report = {
    schema: 'varendo.performance.perceived-input.calibration.v1',
    sourceCommit,
    fixture: fixtureApi.fixture,
    requestedHandlerMs: calibration.requestedHandlerMs,
    interaction: calibration.interaction,
    exactKeydownMatch: keydownEntry ?? null,
    notes: [
      'This one-off calibration deliberately occupies the main thread for the requested duration during a trusted keydown so the browser should emit an Event Timing entry above the 16 ms observation threshold.',
      'The exact match uses the normalized KeyboardEvent.timeStamp and PerformanceEventTiming.startTime; no handler-time tolerance window is used.',
      'The calibration interaction is reported separately and is excluded from the real interaction samples and their visible-update summary.',
    ],
  };
  const output = testInfo.outputPath('perceived-input-calibration.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  expect(calibration.interaction.trustedKeyboard).toBe(true);
  expect(calibration.interaction.queryBefore).toBe('');
  expect(calibration.interaction.queryAfter).toBe('0');
  expect(calibration.interaction.eventTiming.status).toBe('observed');
  expect(keydownEntry).toBeDefined();
  expect(keydownEntry?.duration).not.toBeNull();
  expect(keydownEntry?.duration ?? 0).toBeGreaterThanOrEqual(calibration.requestedHandlerMs - 5);
  expect(calibration.interaction.visibleUpdate).not.toBeNull();
});
