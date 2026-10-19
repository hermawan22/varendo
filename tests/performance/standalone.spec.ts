import { test, expect, type Browser, type Page, type CDPSession } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const FIXTURE_PATH = '/tests/performance/standalone.html';
const DEFAULT_COLD_SAMPLE_COUNT = 1;
const DEFAULT_WARM_SAMPLE_COUNT = 1;
const EXTENDED_COLD_SAMPLE_COUNT = 10;
const EXTENDED_WARM_SAMPLE_COUNT = 30;

type StandaloneObservation = {
  readonly environment: {
    readonly userAgent: string;
    readonly platform: string;
    readonly language: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly devicePixelRatio: number;
    readonly hardwareConcurrency: number | null;
  };
  readonly fixture: {
    readonly rowCount: number;
    readonly renderedRows: number;
    readonly controlValue: string;
    readonly inputPresent: boolean;
    readonly tablePresent: boolean;
  };
  readonly timing: {
    readonly navigation: {
      readonly name: string;
      readonly type: string;
      readonly startTime: number | null;
      readonly duration: number | null;
      readonly domInteractive: number | null;
      readonly domContentLoadedEventEnd: number | null;
      readonly loadEventEnd: number | null;
      readonly transferSize: number | null;
      readonly encodedBodySize: number | null;
      readonly decodedBodySize: number | null;
    } | null;
    readonly resources: readonly {
      readonly name: string;
      readonly initiatorType: string;
      readonly startTime: number | null;
      readonly duration: number | null;
      readonly transferSize: number | null;
      readonly encodedBodySize: number | null;
      readonly decodedBodySize: number | null;
    }[];
    readonly paints: readonly {
      readonly name: string;
      readonly startTime: number | null;
      readonly duration: number | null;
    }[];
    readonly fixtureReadyMs: number | null;
  };
  readonly resourceBytes: {
    readonly totalTransferBytes: number | null;
    readonly totalEncodedBytes: number | null;
    readonly totalDecodedBytes: number | null;
    readonly javascriptTransferBytes: number | null;
    readonly javascriptEncodedBytes: number | null;
    readonly javascriptDecodedBytes: number | null;
    readonly resourceCount: number;
    readonly javascriptResourceCount: number;
    readonly cachedResourceCount: number;
    readonly cachedJavascriptResourceCount: number;
    readonly resourceTimingUnavailableCount: number;
    readonly javascriptResourceTimingUnavailableCount: number;
  };
};

type Sample = {
  readonly index: number;
  readonly condition: {
    readonly cache: 'disabled' | 'enabled';
    readonly cacheCleared: boolean;
    readonly cacheDisabled: boolean;
    readonly freshContext: boolean;
    readonly sameContextAsWarmup: boolean;
  };
  readonly observation: StandaloneObservation;
  readonly network: NetworkObservation;
};

type NetworkObservation = {
  readonly responses: readonly {
    requestId: string;
    url: string;
    status: number;
    fromDiskCache: boolean;
    fromServiceWorker: boolean;
  }[];
  readonly extraInfo: readonly { requestId: string; statusCode: number }[];
};

function networkRecorder(client: CDPSession) {
  let responses: NetworkObservation['responses'][number][] = [];
  let extraInfo: NetworkObservation['extraInfo'][number][] = [];
  client.on('Network.responseReceived', (event) =>
    responses.push({
      requestId: event.requestId,
      url: event.response.url,
      status: event.response.status,
      fromDiskCache: event.response.fromDiskCache === true,
      fromServiceWorker: event.response.fromServiceWorker === true,
    }),
  );
  // Chromium reports the actual 304 here; responseReceived can expose the
  // effective cached 200 response. Never retain response headers or cookies.
  client.on('Network.responseReceivedExtraInfo', (event) =>
    extraInfo.push({ requestId: event.requestId, statusCode: event.statusCode }),
  );
  return {
    reset() {
      responses = [];
      extraInfo = [];
    },
    snapshot(): NetworkObservation {
      return { responses: [...responses], extraInfo: [...extraInfo] };
    },
  };
}

type RetainedModuleGraph = {
  readonly schema: string;
  readonly entryModules: readonly string[];
  readonly retainedModules: readonly string[];
  readonly forbiddenModules: readonly string[];
};

async function waitForFixture(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as Window & { varendoStandalone?: { ready: boolean } }).varendoStandalone;
    return api?.ready === true;
  });
}

async function collect(page: Page): Promise<StandaloneObservation> {
  return page.evaluate(() => {
    const api = (window as Window & { varendoStandalone?: { ready: boolean; collect: () => StandaloneObservation } })
      .varendoStandalone;
    if (api?.ready !== true) throw new Error('Standalone fixture is not ready.');
    return api.collect();
  });
}

async function openFixture(page: Page, baseURL: string): Promise<StandaloneObservation> {
  await page.goto(`${baseURL}${FIXTURE_PATH}`, { waitUntil: 'load' });
  await waitForFixture(page);
  return collect(page);
}

function finiteValues(samples: readonly Sample[], value: (sample: Sample) => number | null | undefined): number[] {
  return samples
    .map(value)
    .filter((candidate): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate));
}

function timingValues(values: readonly number[], sampleCount: number) {
  return {
    p50: nearestRank(values, 0.5),
    p95: nearestRank(values, 0.95),
    availableCount: values.length,
    unavailableCount: sampleCount - values.length,
    observed: values,
  };
}

function nearestRank(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? null;
}

function timingSummary(samples: readonly Sample[]) {
  const domReady = finiteValues(samples, (sample) => sample.observation.timing.navigation?.domContentLoadedEventEnd);
  const fixtureReady = finiteValues(samples, (sample) => sample.observation.timing.fixtureReadyMs);
  const fcp = finiteValues(
    samples,
    (sample) => sample.observation.timing.paints.find((paint) => paint.name === 'first-contentful-paint')?.startTime,
  );
  return {
    sampleCount: samples.length,
    domContentLoadedEventEndMs: timingValues(domReady, samples.length),
    fixtureReadyMs: timingValues(fixtureReady, samples.length),
    firstContentfulPaintMs: timingValues(fcp, samples.length),
  };
}

async function captureColdSamples(browser: Browser, baseURL: string, sampleCount: number): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    const network = networkRecorder(client);
    await client.send('Network.enable');
    await client.send('Network.clearBrowserCache');
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    try {
      const observation = await openFixture(page, baseURL);
      samples.push({
        index: index + 1,
        condition: {
          cache: 'disabled',
          cacheCleared: true,
          cacheDisabled: true,
          freshContext: true,
          sameContextAsWarmup: false,
        },
        observation,
        network: network.snapshot(),
      });
    } finally {
      await client.detach();
      await context.close();
    }
  }
  return samples;
}

async function captureWarmSamples(
  browser: Browser,
  baseURL: string,
  sampleCount: number,
): Promise<{ readonly warmup: StandaloneObservation; readonly samples: readonly Sample[] }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  const network = networkRecorder(client);
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: false });
  try {
    const warmup = await openFixture(page, baseURL);
    const samples: Sample[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
      network.reset();
      await page.evaluate(() => performance.clearResourceTimings());
      await page.reload({ waitUntil: 'load' });
      await waitForFixture(page);
      const observation = await collect(page);
      samples.push({
        index: index + 1,
        condition: {
          cache: 'enabled',
          cacheCleared: false,
          cacheDisabled: false,
          freshContext: false,
          sameContextAsWarmup: true,
        },
        observation,
        network: network.snapshot(),
      });
    }
    return { warmup, samples };
  } finally {
    await client.detach();
    await context.close();
  }
}

test('captures standalone production fixture cold and warm browser observations', async ({
  browser,
  baseURL,
  request,
}, testInfo) => {
  if (baseURL === undefined) throw new Error('Playwright baseURL is required.');
  const extended = process.env.VARENDO_RUN_PERFORMANCE === '1';
  const coldSampleCount = extended ? EXTENDED_COLD_SAMPLE_COUNT : DEFAULT_COLD_SAMPLE_COUNT;
  const warmSampleCount = extended ? EXTENDED_WARM_SAMPLE_COUNT : DEFAULT_WARM_SAMPLE_COUNT;
  const cold = await captureColdSamples(browser, baseURL, coldSampleCount);
  const warm = await captureWarmSamples(browser, baseURL, warmSampleCount);
  const moduleGraphResponse = await request.get(`${baseURL}/retained-modules.json`);
  expect(moduleGraphResponse.ok()).toBe(true);
  const moduleGraph = (await moduleGraphResponse.json()) as RetainedModuleGraph;
  expect(moduleGraph.forbiddenModules).toEqual([]);
  const warmCacheHitSampleCount = warm.samples.filter(
    (sample) => sample.observation.resourceBytes.cachedJavascriptResourceCount > 0,
  ).length;
  const warmRevalidatedSampleCount = warm.samples.filter((sample) =>
    sample.network.responses.some(
      (response) =>
        /\.js(?:[?#]|$)/u.test(response.url) &&
        sample.network.extraInfo.some((extra) => extra.requestId === response.requestId && extra.statusCode === 304),
    ),
  ).length;
  const warmDiskCacheSampleCount = warm.samples.filter((sample) =>
    sample.network.responses.some((response) => /\.js(?:[?#]|$)/u.test(response.url) && response.fromDiskCache),
  ).length;
  const warmCacheEvidence = {
    criterion:
      'Separate ResourceTiming zero-transfer JS hits, CDP disk-cache responses, and actual matching CDP ExtraInfo 304 statuses',
    sampleCount: warm.samples.length,
    hitSampleCount: warmCacheHitSampleCount,
    diskCacheSampleCount: warmDiskCacheSampleCount,
    revalidatedSampleCount: warmRevalidatedSampleCount,
    status:
      warmCacheHitSampleCount + warmDiskCacheSampleCount + warmRevalidatedSampleCount > 0 ? 'observed' : 'incomplete',
    note: 'Revalidation still incurs a request; it is reported separately from zero-transfer and disk-cache hits. Incomplete means the run exposed no qualifying cache evidence.',
  } as const;
  const report = {
    schema: 'varendo.performance.standalone.v1',
    sourceCommit: process.env.VARENDO_SOURCE_COMMIT ?? 'unknown',
    mode: extended ? 'extended-observation' : 'functional-smoke',
    environment: cold[0]?.observation.environment ?? warm.warmup.environment,
    fixture: { rowCount: 100, controlValue: 'ready', entrypoint: '@varendo/web/inputs + @varendo/web/table' },
    moduleGraph,
    cold: {
      label: 'cold-cache-disabled-fresh-context',
      sampleCount: cold.length,
      samples: cold,
      summary: timingSummary(cold),
    },
    warm: {
      label: 'warm-cache-enabled-same-context-after-warmup',
      warmup: warm.warmup,
      sampleCount: warm.samples.length,
      samples: warm.samples,
      summary: timingSummary(warm.samples),
      cacheEvidence: warmCacheEvidence,
    },
    notes: [
      'Cold samples use a new browser context and page, clear the Chromium browser cache through CDP, and disable the network cache for the navigation.',
      `Warm samples perform one warmup navigation, then ${warmSampleCount} reload${warmSampleCount === 1 ? '' : 's'} in one context with the browser cache enabled; ResourceTiming transferSize and encodedBodySize are retained for cache-hit evidence.`,
      'Fixture-ready is measured after Lit updateComplete and is not a paint measurement; first-contentful-paint is reported only when the browser exposes a paint timing entry.',
      'Timing summaries and cache evidence are diagnostic observations for this run; they are not performance-budget qualification.',
      'These observations cover this standalone 100-row input/table fixture only. They do not claim input-to-paint, whole-site, or lower-powered-device performance.',
    ],
  };
  const output = testInfo.outputPath('standalone-performance-report.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  expect(cold).toHaveLength(coldSampleCount);
  expect(warm.samples).toHaveLength(warmSampleCount);
  for (const sample of [...cold, ...warm.samples]) {
    expect(sample.observation.fixture).toMatchObject({
      rowCount: 100,
      renderedRows: 100,
      controlValue: 'ready',
      inputPresent: true,
      tablePresent: true,
    });
    const navigation = sample.observation.timing.navigation;
    expect(
      navigation === null ||
        navigation.domContentLoadedEventEnd === null ||
        Number.isFinite(navigation.domContentLoadedEventEnd),
    ).toBe(true);
    expect(sample.observation.timing.resources.length).toBeGreaterThan(0);
    expect(sample.observation.resourceBytes.javascriptResourceCount).toBeGreaterThan(0);
    const javascriptEncodedBytes = sample.observation.resourceBytes.javascriptEncodedBytes;
    expect(
      javascriptEncodedBytes === null || (Number.isFinite(javascriptEncodedBytes) && javascriptEncodedBytes >= 0),
    ).toBe(true);
  }
  expect(
    cold.every(
      (sample) =>
        sample.condition.cache === 'disabled' && sample.condition.cacheCleared && sample.condition.freshContext,
    ),
  ).toBe(true);
  expect(
    warm.samples.every(
      (sample) =>
        sample.condition.cache === 'enabled' && sample.condition.sameContextAsWarmup && !sample.condition.cacheDisabled,
    ),
  ).toBe(true);
  expect(warmCacheEvidence.status === 'observed' || warmCacheEvidence.status === 'incomplete').toBe(true);
});
