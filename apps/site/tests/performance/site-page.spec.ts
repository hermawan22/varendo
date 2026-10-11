import { test, expect, type Browser, type CDPSession, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_COLD_SAMPLE_COUNT = 1;
const DEFAULT_WARM_SAMPLE_COUNT = 1;
const EXTENDED_COLD_SAMPLE_COUNT = 10;
const EXTENDED_WARM_SAMPLE_COUNT = 30;
const MAX_RESOURCE_ENTRIES = 2_048;

const ROUTES = [
  { id: 'home', path: '/' },
  { id: 'component-docs', path: '/components/data.table/', host: 'docs.localhost' },
  { id: 'playground', path: '/playground/', host: 'docs.localhost' },
] as const;

type RouteId = (typeof ROUTES)[number]['id'];

type NumericEntry = {
  readonly name: string;
  readonly entryType: string;
  readonly startTime: number;
  readonly duration: number;
};

type NavigationEntry = NumericEntry & {
  readonly initiatorType: string;
  readonly type: string;
  readonly redirectCount: number;
  readonly unloadEventStart: number;
  readonly unloadEventEnd: number;
  readonly workerStart: number;
  readonly fetchStart: number;
  readonly domainLookupStart: number;
  readonly domainLookupEnd: number;
  readonly connectStart: number;
  readonly connectEnd: number;
  readonly secureConnectionStart: number;
  readonly requestStart: number;
  readonly responseStart: number;
  readonly responseEnd: number;
  readonly transferSize: number;
  readonly encodedBodySize: number;
  readonly decodedBodySize: number;
  readonly domInteractive: number;
  readonly domContentLoadedEventStart: number;
  readonly domContentLoadedEventEnd: number;
  readonly domComplete: number;
  readonly loadEventStart: number;
  readonly loadEventEnd: number;
};

type ResourceEntry = NumericEntry & {
  readonly initiatorType: string;
  readonly fetchStart: number;
  readonly requestStart: number;
  readonly responseStart: number;
  readonly responseEnd: number;
  readonly transferSize: number;
  readonly encodedBodySize: number;
  readonly decodedBodySize: number;
  readonly nextHopProtocol: string;
  readonly renderBlockingStatus: string | null;
};

type PaintEntry = NumericEntry;

type LcpEntry = NumericEntry & {
  readonly renderTime: number | null;
  readonly loadTime: number | null;
  readonly size: number | null;
  readonly id: string | null;
  readonly url: string | null;
  readonly element: { readonly tagName: string; readonly id: string; readonly className: string } | null;
};

type LayoutShiftEntry = NumericEntry & {
  readonly value: number | null;
  readonly hadRecentInput: boolean | null;
  readonly lastInputTime: number | null;
  readonly sources:
    | readonly {
        readonly node: { readonly tagName: string; readonly id: string; readonly className: string } | null;
        readonly previousRect: {
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
        } | null;
        readonly currentRect: {
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
        } | null;
      }[]
    | null;
};

type PerformanceObservation = {
  readonly navigation: NavigationEntry | null;
  readonly resources: readonly ResourceEntry[] | null;
  readonly resourceEntriesTruncated: number;
  readonly resourceTimingBufferFull: boolean | null;
  readonly paints: readonly PaintEntry[] | null;
  readonly largestContentfulPaint: readonly LcpEntry[] | null;
  readonly layoutShifts: readonly LayoutShiftEntry[] | null;
  readonly observerEntriesDropped: {
    readonly paint: number;
    readonly largestContentfulPaint: number;
    readonly layoutShift: number;
  } | null;
  readonly observerAvailability: {
    readonly paint: boolean;
    readonly largestContentfulPaint: boolean;
    readonly layoutShift: boolean;
  };
};

type ByteTotals = {
  readonly totalTransferBytes: number | null;
  readonly totalEncodedBytes: number | null;
  readonly totalDecodedBytes: number | null;
  readonly resourceCount: number;
  readonly unavailableTransferCount: number;
  readonly unavailableEncodedCount: number;
  readonly unavailableDecodedCount: number;
};

type ResourceTimingObservation = {
  readonly all: ByteTotals;
  readonly javascript: ByteTotals;
  readonly stylesheet: ByteTotals;
  readonly image: ByteTotals;
  readonly other: ByteTotals;
};

type NetworkResponse = {
  readonly requestId: string;
  readonly url: string;
  readonly status: number;
  readonly fromDiskCache: boolean;
  readonly fromServiceWorker: boolean;
  readonly fromPrefetchCache: boolean;
};

type NetworkExtraInfo = { readonly requestId: string; readonly statusCode: number };
type NetworkLoading = { readonly requestId: string; readonly encodedDataLength: number };

type NetworkObservation = {
  readonly responses: readonly NetworkResponse[];
  readonly extraInfo: readonly NetworkExtraInfo[];
  readonly loadingFinished: readonly NetworkLoading[];
  readonly loadingFailedCount: number;
};

type CacheEvidence = {
  readonly resourceTimingZeroTransferCount: number | null;
  readonly diskCacheResponseCount: number;
  readonly serviceWorkerResponseCount: number;
  readonly revalidated304Count: number;
  readonly networkLoadingFinishedEncodedBytes: number | null;
  readonly status: 'observed' | 'incomplete';
};

type RouteReadiness = {
  readonly visible: string;
  readonly functional: string;
};

type SiteSample = {
  readonly index: number;
  readonly route: { readonly id: RouteId; readonly path: string };
  readonly condition: {
    readonly cache: 'disabled' | 'enabled';
    readonly cacheCleared: boolean;
    readonly cacheDisabled: boolean;
    readonly freshContext: boolean;
    readonly sameContextAsWarmup: boolean;
  };
  readonly responseStatus: number | null;
  readonly readiness: RouteReadiness;
  readonly environment: {
    readonly userAgent: string;
    readonly platform: string;
    readonly language: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly devicePixelRatio: number;
    readonly hardwareConcurrency: number | null;
  };
  readonly performance: PerformanceObservation;
  readonly resourceTimingBytes: ResourceTimingObservation | null;
  readonly network: NetworkObservation;
  readonly cacheEvidence: CacheEvidence;
};

type SiteReport = {
  readonly schema: 'aeliqo.performance.site-page.v1';
  readonly sourceCommit: string;
  readonly buildId: string;
  readonly mode: 'functional-observation';
  readonly samplePlan: {
    readonly coldPerRoute: number;
    readonly warmPerRoute: number;
    readonly extended: boolean;
  };
  readonly environment: {
    readonly browser: string;
    readonly browserVersion: string;
    readonly node: string;
    readonly platform: string;
    readonly arch: string;
    readonly sourceCommit: string;
    readonly buildId: string;
  };
  readonly routes: readonly { readonly id: RouteId; readonly path: string }[];
  readonly cold: readonly SiteSample[];
  readonly warm: readonly SiteSample[];
  readonly notes: readonly string[];
};

type PerformanceState = {
  readonly paints: PaintEntry[];
  readonly largestContentfulPaint: LcpEntry[];
  readonly layoutShifts: LayoutShiftEntry[];
  resourceTimingBufferFull: boolean;
  readonly observerEntriesDropped: { paint: number; largestContentfulPaint: number; layoutShift: number };
  readonly unavailable: { paint: boolean; largestContentfulPaint: boolean; layoutShift: boolean };
};

const PERFORMANCE_INIT_SCRIPT = () => {
  const maxPaintEntries = 128;
  const maxLcpEntries = 128;
  const maxLayoutShiftEntries = 1_024;
  const state: PerformanceState = {
    paints: [],
    largestContentfulPaint: [],
    layoutShifts: [],
    resourceTimingBufferFull: false,
    observerEntriesDropped: { paint: 0, largestContentfulPaint: 0, layoutShift: 0 },
    unavailable: { paint: false, largestContentfulPaint: false, layoutShift: false },
  };
  performance.setResourceTimingBufferSize(2_048);
  performance.addEventListener('resourcetimingbufferfull', () => {
    state.resourceTimingBufferFull = true;
  });
  const base = (entry: PerformanceEntry): NumericEntry => ({
    name: entry.name,
    entryType: entry.entryType,
    startTime: entry.startTime,
    duration: entry.duration,
  });
  const node = (value: unknown): { tagName: string; id: string; className: string } | null => {
    if (!(value instanceof Element)) return null;
    return {
      tagName: value.tagName,
      id: value.id,
      className: typeof value.className === 'string' ? value.className : '',
    };
  };
  const rect = (value: DOMRectReadOnly | undefined) =>
    value === undefined ? null : { x: value.x, y: value.y, width: value.width, height: value.height };
  const observe = (
    type: string,
    callback: (entries: readonly PerformanceEntry[]) => void,
    key: 'paint' | 'largestContentfulPaint' | 'layoutShift',
  ) => {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes(type)) {
      state.unavailable[key] = true;
      return;
    }
    try {
      const observer = new PerformanceObserver((list) => callback(list.getEntries()));
      observer.observe({ type, buffered: true });
    } catch {
      state.unavailable[key] = true;
    }
  };
  observe(
    'paint',
    (entries) => {
      for (let index = 0; index < entries.length; index += 1) {
        if (state.paints.length >= maxPaintEntries) {
          state.observerEntriesDropped.paint += entries.length - index;
          break;
        }
        state.paints.push(base(entries[index]!) as PaintEntry);
      }
    },
    'paint',
  );
  observe(
    'largest-contentful-paint',
    (entries) => {
      for (let index = 0; index < entries.length; index += 1) {
        if (state.largestContentfulPaint.length >= maxLcpEntries) {
          state.observerEntriesDropped.largestContentfulPaint += entries.length - index;
          break;
        }
        const raw = entries[index];
        const entry = raw as PerformanceEntry & {
          renderTime?: number;
          loadTime?: number;
          size?: number;
          id?: string;
          url?: string;
          element?: Element;
        };
        state.largestContentfulPaint.push({
          ...base(entry),
          renderTime: entry.renderTime ?? null,
          loadTime: entry.loadTime ?? null,
          size: entry.size ?? null,
          id: entry.id ?? null,
          url: entry.url ?? null,
          element: node(entry.element),
        });
      }
    },
    'largestContentfulPaint',
  );
  observe(
    'layout-shift',
    (entries) => {
      for (let index = 0; index < entries.length; index += 1) {
        if (state.layoutShifts.length >= maxLayoutShiftEntries) {
          state.observerEntriesDropped.layoutShift += entries.length - index;
          break;
        }
        const raw = entries[index];
        const entry = raw as PerformanceEntry & {
          value?: number;
          hadRecentInput?: boolean;
          lastInputTime?: number;
          sources?: readonly { node?: Element; previousRect?: DOMRectReadOnly; currentRect?: DOMRectReadOnly }[];
        };
        state.layoutShifts.push({
          ...base(entry),
          value: entry.value ?? null,
          hadRecentInput: entry.hadRecentInput ?? null,
          lastInputTime: entry.lastInputTime ?? null,
          sources:
            entry.sources === undefined
              ? null
              : entry.sources.map((source) => ({
                  node: node(source.node),
                  previousRect: rect(source.previousRect),
                  currentRect: rect(source.currentRect),
                })),
        });
      }
    },
    'layoutShift',
  );
  Object.defineProperty(window, '__aeliqoSitePerformance', { value: state, configurable: true });
};

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function collectPerformance(page: Page): Promise<PerformanceObservation> {
  return page.evaluate(
    ({ maxResources }) => {
      const numericEntry = (entry: PerformanceEntry): NumericEntry => ({
        name: entry.name,
        entryType: entry.entryType,
        startTime: entry.startTime,
        duration: entry.duration,
      });
      const state = (window as Window & { __aeliqoSitePerformance?: PerformanceState }).__aeliqoSitePerformance;
      const entries = performance.getEntriesByType('resource');
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const paints =
        state === undefined ? null : state.unavailable.paint ? null : state.paints.map((entry) => ({ ...entry }));
      const largestContentfulPaint =
        state === undefined
          ? null
          : state.unavailable.largestContentfulPaint
            ? null
            : [...state.largestContentfulPaint];
      const layoutShifts = state === undefined ? null : state.unavailable.layoutShift ? null : [...state.layoutShifts];
      const nav =
        navigation === undefined
          ? null
          : {
              ...numericEntry(navigation),
              initiatorType: navigation.initiatorType,
              type: navigation.type,
              redirectCount: navigation.redirectCount,
              unloadEventStart: navigation.unloadEventStart,
              unloadEventEnd: navigation.unloadEventEnd,
              workerStart: navigation.workerStart,
              fetchStart: navigation.fetchStart,
              domainLookupStart: navigation.domainLookupStart,
              domainLookupEnd: navigation.domainLookupEnd,
              connectStart: navigation.connectStart,
              connectEnd: navigation.connectEnd,
              secureConnectionStart: navigation.secureConnectionStart,
              requestStart: navigation.requestStart,
              responseStart: navigation.responseStart,
              responseEnd: navigation.responseEnd,
              transferSize: navigation.transferSize,
              encodedBodySize: navigation.encodedBodySize,
              decodedBodySize: navigation.decodedBodySize,
              domInteractive: navigation.domInteractive,
              domContentLoadedEventStart: navigation.domContentLoadedEventStart,
              domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
              domComplete: navigation.domComplete,
              loadEventStart: navigation.loadEventStart,
              loadEventEnd: navigation.loadEventEnd,
            };
      const resources = entries.slice(0, maxResources).map((entry) => {
        const resource = entry as PerformanceResourceTiming;
        return {
          ...numericEntry(resource),
          initiatorType: resource.initiatorType,
          fetchStart: resource.fetchStart,
          requestStart: resource.requestStart,
          responseStart: resource.responseStart,
          responseEnd: resource.responseEnd,
          transferSize: resource.transferSize,
          encodedBodySize: resource.encodedBodySize,
          decodedBodySize: resource.decodedBodySize,
          nextHopProtocol: resource.nextHopProtocol,
          renderBlockingStatus:
            (resource as PerformanceResourceTiming & { renderBlockingStatus?: string }).renderBlockingStatus ?? null,
        };
      });
      return {
        navigation: nav,
        resources,
        resourceEntriesTruncated: Math.max(0, entries.length - resources.length),
        resourceTimingBufferFull: state?.resourceTimingBufferFull ?? null,
        paints,
        largestContentfulPaint,
        layoutShifts,
        observerEntriesDropped: state === undefined ? null : { ...state.observerEntriesDropped },
        observerAvailability:
          state === undefined
            ? { paint: false, largestContentfulPaint: false, layoutShift: false }
            : {
                paint: !state.unavailable.paint,
                largestContentfulPaint: !state.unavailable.largestContentfulPaint,
                layoutShift: !state.unavailable.layoutShift,
              },
      };
    },
    { maxResources: MAX_RESOURCE_ENTRIES },
  );
}

function byteTotals(entries: readonly ResourceEntry[]): ByteTotals {
  const total = (key: 'transferSize' | 'encodedBodySize' | 'decodedBodySize'): number | null => {
    const values = entries.map((entry) => safeNumber(entry[key]));
    if (values.every((value) => value === null)) return null;
    return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  };
  return {
    totalTransferBytes: total('transferSize'),
    totalEncodedBytes: total('encodedBodySize'),
    totalDecodedBytes: total('decodedBodySize'),
    resourceCount: entries.length,
    unavailableTransferCount: entries.filter((entry) => safeNumber(entry.transferSize) === null).length,
    unavailableEncodedCount: entries.filter((entry) => safeNumber(entry.encodedBodySize) === null).length,
    unavailableDecodedCount: entries.filter((entry) => safeNumber(entry.decodedBodySize) === null).length,
  };
}

function resourceTimingBytes(performance: PerformanceObservation): ResourceTimingObservation | null {
  if (performance.resources === null) return null;
  const groups: Record<'all' | 'javascript' | 'stylesheet' | 'image' | 'other', ResourceEntry[]> = {
    all: [],
    javascript: [],
    stylesheet: [],
    image: [],
    other: [],
  };
  for (const entry of performance.resources) {
    groups.all.push(entry);
    const type = entry.initiatorType.toLowerCase();
    const name = entry.name.toLowerCase();
    const group =
      type === 'script' || /\.m?js(?:[?#]|$)/u.test(name)
        ? 'javascript'
        : type === 'link' || type === 'css' || /\.css(?:[?#]|$)/u.test(name)
          ? 'stylesheet'
          : type === 'img' || type === 'image' || /\.(?:png|jpe?g|gif|svg|webp|avif|ico)(?:[?#]|$)/u.test(name)
            ? 'image'
            : 'other';
    groups[group].push(entry);
  }
  return {
    all: byteTotals(groups.all),
    javascript: byteTotals(groups.javascript),
    stylesheet: byteTotals(groups.stylesheet),
    image: byteTotals(groups.image),
    other: byteTotals(groups.other),
  };
}

class NetworkRecorder {
  private responses: NetworkResponse[] = [];
  private extraInfo: NetworkExtraInfo[] = [];
  private loadingFinished: NetworkLoading[] = [];
  private loadingFailedCount = 0;
  constructor(private readonly client: CDPSession) {
    client.on('Network.responseReceived', (event) =>
      this.responses.push({
        requestId: event.requestId,
        url: event.response.url,
        status: event.response.status,
        fromDiskCache: event.response.fromDiskCache === true,
        fromServiceWorker: event.response.fromServiceWorker === true,
        fromPrefetchCache: event.response.fromPrefetchCache === true,
      }),
    );
    client.on('Network.responseReceivedExtraInfo', (event) =>
      this.extraInfo.push({ requestId: event.requestId, statusCode: event.statusCode }),
    );
    client.on('Network.loadingFinished', (event) =>
      this.loadingFinished.push({ requestId: event.requestId, encodedDataLength: event.encodedDataLength }),
    );
    client.on('Network.loadingFailed', () => {
      this.loadingFailedCount += 1;
    });
  }
  reset(): void {
    this.responses = [];
    this.extraInfo = [];
    this.loadingFinished = [];
    this.loadingFailedCount = 0;
  }
  snapshot(): NetworkObservation {
    return {
      responses: [...this.responses],
      extraInfo: [...this.extraInfo],
      loadingFinished: [...this.loadingFinished],
      loadingFailedCount: this.loadingFailedCount,
    };
  }
}

function cacheEvidence(performance: PerformanceObservation, network: NetworkObservation): CacheEvidence {
  const resources = performance.resources ?? [];
  const resourceTimingZeroTransferCount =
    performance.resources === null ? null : resources.filter((resource) => resource.transferSize === 0).length;
  const diskCacheResponseCount = network.responses.filter((response) => response.fromDiskCache).length;
  const serviceWorkerResponseCount = network.responses.filter((response) => response.fromServiceWorker).length;
  const responseIds = new Set(network.responses.map((response) => response.requestId));
  const revalidated304Count = network.extraInfo.filter(
    (info) => info.statusCode === 304 && responseIds.has(info.requestId),
  ).length;
  const encodedValues = network.loadingFinished
    .map((item) => item.encodedDataLength)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const networkLoadingFinishedEncodedBytes =
    encodedValues.length === 0 ? null : encodedValues.reduce((sum, value) => sum + value, 0);
  return {
    resourceTimingZeroTransferCount,
    diskCacheResponseCount,
    serviceWorkerResponseCount,
    revalidated304Count,
    networkLoadingFinishedEncodedBytes,
    status:
      (resourceTimingZeroTransferCount ?? 0) +
        diskCacheResponseCount +
        serviceWorkerResponseCount +
        revalidated304Count >
      0
        ? 'observed'
        : 'incomplete',
  };
}

async function waitForObserverDelivery(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

async function assertRouteReady(page: Page, route: (typeof ROUTES)[number]): Promise<RouteReadiness> {
  if (route.id === 'home') {
    await expect(
      page.getByRole('heading', { name: 'Say what to show. Varendo picks the view that fits.', exact: true }),
    ).toBeVisible();
    await expect(page.locator('#home-demo aeliqo-region')).toBeVisible();
    await expect(page.locator('#demo-status')).toContainText('4 of 4');
    return {
      visible: 'hero heading + adaptive Region',
      functional: 'public app facade reports 4 of 4 synthetic people',
    };
  }
  if (route.id === 'component-docs') {
    await expect(page.getByRole('heading', { name: 'Table', exact: true })).toBeVisible();
    await expect(page.locator('[data-component-preview] aeliqo-table')).toBeAttached();
    await expect(page.getByText(/Expected result:/)).toBeVisible();
    return {
      visible: 'Table heading + real table preview',
      functional: 'component documentation exposes expected-result content',
    };
  }
  await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
  await expect(page.locator('#pg-region aeliqo-table')).toBeVisible();
  return {
    visible: 'playground runtime receipt + rendered table',
    functional: 'guided task renders through the public app facade',
  };
}

async function routeEnvironment(page: Page): Promise<SiteSample['environment']> {
  return page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    viewport: { width: innerWidth, height: innerHeight },
    devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
  }));
}

async function navigateAndCollect(
  page: Page,
  route: (typeof ROUTES)[number],
  url: string,
  index: number,
  condition: SiteSample['condition'],
  network: NetworkRecorder,
): Promise<SiteSample> {
  const response = await page.goto(url, { waitUntil: 'load' });
  await expect(page).toHaveURL(url);
  const readiness = await assertRouteReady(page, route);
  await waitForObserverDelivery(page);
  const performance = await collectPerformance(page);
  const networkSnapshot = network.snapshot();
  return {
    index,
    route: { id: route.id, path: route.path },
    condition,
    responseStatus: response?.status() ?? null,
    readiness,
    environment: await routeEnvironment(page),
    performance,
    resourceTimingBytes: resourceTimingBytes(performance),
    network: networkSnapshot,
    cacheEvidence: cacheEvidence(performance, networkSnapshot),
  };
}

async function withContext(
  browser: Browser,
  baseURL: string,
  route: (typeof ROUTES)[number],
  sampleCount: number,
  cold: boolean,
): Promise<SiteSample[]> {
  const samples: SiteSample[] = [];
  const url = new URL(route.path, baseURL);
  if ('host' in route) url.hostname = route.host;
  if (cold) {
    for (let index = 0; index < sampleCount; index += 1) {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      const client = await context.newCDPSession(page);
      const network = new NetworkRecorder(client);
      try {
        await client.send('Network.enable');
        await client.send('Network.clearBrowserCache');
        await client.send('Network.setCacheDisabled', { cacheDisabled: true });
        await context.addInitScript(PERFORMANCE_INIT_SCRIPT);
        samples.push(
          await navigateAndCollect(
            page,
            route,
            url.href,
            index + 1,
            {
              cache: 'disabled',
              cacheCleared: true,
              cacheDisabled: true,
              freshContext: true,
              sameContextAsWarmup: false,
            },
            network,
          ),
        );
      } finally {
        await Promise.allSettled([client.detach(), context.close()]);
      }
    }
    return samples;
  }
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  const network = new NetworkRecorder(client);
  try {
    await client.send('Network.enable');
    await client.send('Network.setCacheDisabled', { cacheDisabled: false });
    await context.addInitScript(PERFORMANCE_INIT_SCRIPT);
    await page.goto(url.href, { waitUntil: 'load' });
    await expect(page).toHaveURL(url.href);
    await assertRouteReady(page, route);
    for (let index = 0; index < sampleCount; index += 1) {
      network.reset();
      await page.evaluate(() => window.performance.clearResourceTimings());
      const response = await page.reload({ waitUntil: 'load' });
      await expect(page).toHaveURL(url.href);
      const readiness = await assertRouteReady(page, route);
      await waitForObserverDelivery(page);
      const performance = await collectPerformance(page);
      const networkSnapshot = network.snapshot();
      samples.push({
        index: index + 1,
        route: { id: route.id, path: route.path },
        condition: {
          cache: 'enabled',
          cacheCleared: false,
          cacheDisabled: false,
          freshContext: false,
          sameContextAsWarmup: true,
        },
        responseStatus: response?.status() ?? null,
        readiness,
        environment: await routeEnvironment(page),
        performance,
        resourceTimingBytes: resourceTimingBytes(performance),
        network: networkSnapshot,
        cacheEvidence: cacheEvidence(performance, networkSnapshot),
      });
    }
    return samples;
  } finally {
    await Promise.allSettled([client.detach(), context.close()]);
  }
}

test('captures whole-site production page observations for home, docs, and playground', async ({
  browser,
}, testInfo) => {
  const extended = process.env.AELIQO_RUN_PERFORMANCE === '1';
  const coldSampleCount = extended ? EXTENDED_COLD_SAMPLE_COUNT : DEFAULT_COLD_SAMPLE_COUNT;
  const warmSampleCount = extended ? EXTENDED_WARM_SAMPLE_COUNT : DEFAULT_WARM_SAMPLE_COUNT;
  const cold: SiteSample[] = [];
  const warm: SiteSample[] = [];
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== 'string' || baseURL.length === 0)
    throw new Error('site-page probe requires a Playwright baseURL');
  for (const route of ROUTES) {
    cold.push(...(await withContext(browser, baseURL, route, coldSampleCount, true)));
    warm.push(...(await withContext(browser, baseURL, route, warmSampleCount, false)));
  }
  const sourceCommit = process.env.AELIQO_SOURCE_COMMIT ?? 'unknown';
  const buildId = process.env.AELIQO_SITE_BUILD_ID ?? 'unknown';
  const report: SiteReport = {
    schema: 'aeliqo.performance.site-page.v1',
    sourceCommit,
    buildId,
    mode: 'functional-observation',
    samplePlan: { coldPerRoute: coldSampleCount, warmPerRoute: warmSampleCount, extended },
    environment: {
      browser: 'chromium',
      browserVersion: browser.version(),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      sourceCommit,
      buildId,
    },
    routes: ROUTES.map((route) => ({ id: route.id, path: route.path })),
    cold,
    warm,
    notes: [
      'This is a whole-site production build+preview observation for three representative routes; it is not a library-only performance claim.',
      'Cold samples use a fresh browser context, clear the Chromium browser cache through CDP, and disable the network cache. Warm samples use one context per route after one warmup navigation with the browser cache enabled.',
      'Navigation, ResourceTiming, PaintTiming, largest-contentful-paint, and layout-shift values are browser observations. Missing APIs or entries are represented as null; no synthetic INP or input-to-paint metric is generated.',
      'The latest observed LCP candidate is retained as raw observer data; it is not presented as a final lifecycle or field LCP percentile. Layout-shift entries are retained individually; their values are not summed or labeled as Core Web Vitals CLS.',
      'ResourceTiming byte totals and CDP loadingFinished byte totals are separate observations. Cache evidence distinguishes zero-transfer ResourceTiming entries, disk-cache responses, service-worker responses, and matching 304 statuses; incomplete cache evidence remains incomplete.',
      'The smoke plan uses one cold and one warm sample per route. A 10-cold/30-warm run is opt-in through AELIQO_RUN_PERFORMANCE=1. No timing threshold or performance pass budget is asserted.',
    ],
  };
  const output = testInfo.outputPath('site-page-performance-report.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  expect(cold).toHaveLength(ROUTES.length * coldSampleCount);
  expect(warm).toHaveLength(ROUTES.length * warmSampleCount);
  for (const sample of [...cold, ...warm]) {
    expect(sample.responseStatus).toBe(200);
    expect(sample.readiness.visible.length).toBeGreaterThan(0);
    expect(sample.readiness.functional.length).toBeGreaterThan(0);
    expect(sample.condition.cache === 'disabled' || sample.condition.cache === 'enabled').toBe(true);
    expect(sample.performance.resourceEntriesTruncated).toBeGreaterThanOrEqual(0);
    expect(sample.cacheEvidence.status === 'observed' || sample.cacheEvidence.status === 'incomplete').toBe(true);
  }
  expect(
    cold.every(
      (sample) =>
        sample.condition.cache === 'disabled' &&
        sample.condition.cacheCleared &&
        sample.condition.cacheDisabled &&
        sample.condition.freshContext,
    ),
  ).toBe(true);
  expect(
    warm.every(
      (sample) =>
        sample.condition.cache === 'enabled' &&
        !sample.condition.cacheCleared &&
        !sample.condition.cacheDisabled &&
        sample.condition.sameContextAsWarmup,
    ),
  ).toBe(true);
});
