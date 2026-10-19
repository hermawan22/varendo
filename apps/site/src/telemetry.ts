import { SITE_BASE } from './base.js';
export type PublicSiteLocation = Pick<Location, 'hostname' | 'protocol'>;

type MonitoringConfig = Readonly<{ enabled: true; version?: string }>;
type MetricName = 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB';
type MetricRating = 'good' | 'needs-improvement' | 'poor';
type MetricSample = Readonly<{ name: MetricName; value: number; rating: MetricRating }>;
type Attribute = Readonly<{ key: string; value: Readonly<{ stringValue: string }> }>;

const PUBLIC_HOSTS = new Set(['hermawan22.github.io']);
const timingBounds = [100, 250, 500, 1000, 1800, 2500, 4000, 8000];
const clsBounds = [0.01, 0.05, 0.1, 0.25, 0.5, 1];
const startedDocuments = new WeakSet<object>();
const ratingBounds: Readonly<Record<MetricName, readonly [number, number]>> = {
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  INP: [200, 500],
  LCP: [2500, 4000],
  TTFB: [1800, 3000],
};

export function isPublicVarendoSite(location: PublicSiteLocation): boolean {
  return location.protocol === 'https:' && PUBLIC_HOSTS.has(location.hostname);
}

export function parseMonitoringConfig(input: unknown): MonitoringConfig | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = input as Readonly<Record<string, unknown>>;
  if (value.enabled !== true) return undefined;
  const version = value.version;
  if (version !== undefined && (typeof version !== 'string' || !/^(sha-)?[a-f0-9]{40}$/.test(version)))
    return undefined;
  return version === undefined ? { enabled: true } : { enabled: true, version };
}

function attribute(key: string, value: string): Attribute {
  return { key, value: { stringValue: value } };
}

function nanoTime(milliseconds: number): string {
  return `${Math.round(milliseconds * 1000)}000`;
}

function rating(name: MetricName, value: number): MetricRating {
  const [good, needsImprovement] = ratingBounds[name];
  if (value <= good) return 'good';
  if (value <= needsImprovement) return 'needs-improvement';
  return 'poor';
}

/** Constructs telemetry from a numeric browser observation only. */
export function webVitalData(sample: MetricSample, now: number): object | undefined {
  if (!Number.isFinite(sample.value) || sample.value < 0 || !Number.isFinite(now)) return undefined;
  const bounds = sample.name === 'CLS' ? clsBounds : timingBounds;
  const bucket = bounds.findIndex((bound) => sample.value <= bound);
  return {
    name: `browser.web_vital.${sample.name.toLowerCase()}`,
    unit: sample.name === 'CLS' ? '1' : 'ms',
    histogram: {
      aggregationTemporality: 1,
      dataPoints: [
        {
          attributes: [attribute('web_vital.rating', sample.rating)],
          startTimeUnixNano: nanoTime(now - 1),
          timeUnixNano: nanoTime(now),
          count: '1',
          sum: sample.value,
          min: sample.value,
          max: sample.value,
          explicitBounds: bounds,
          bucketCounts: Array.from({ length: bounds.length + 1 }, (_, index) =>
            index === (bucket < 0 ? bounds.length : bucket) ? '1' : '0',
          ),
        },
      ],
    },
  };
}

function randomHex(bytes: number, crypto: Crypto | undefined): string | undefined {
  try {
    if (!crypto?.getRandomValues) return undefined;
    return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) =>
      value.toString(16).padStart(2, '0'),
    ).join('');
  } catch {
    return undefined;
  }
}

function entryValue(entry: unknown, property: string): number | undefined {
  if (entry === null || typeof entry !== 'object') return undefined;
  const value = (entry as Readonly<Record<string, unknown>>)[property];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function observeBrowserVitals(report: (name: MetricName, value: number) => void): void {
  if (typeof PerformanceObserver === 'undefined') return;
  const supported = PerformanceObserver.supportedEntryTypes;
  const observe = (type: string, receive: (entries: readonly unknown[]) => void): void => {
    if (!supported.includes(type)) return;
    try {
      const observer = new PerformanceObserver((list) => receive(list.getEntries()));
      observer.observe({ type, buffered: true });
    } catch {
      // A metric unavailable in this browser is absent, never fabricated.
    }
  };
  observe('paint', (entries) => {
    const fcp = entries.find((entry) => (entry as PerformanceEntry).name === 'first-contentful-paint');
    const value = entryValue(fcp, 'startTime');
    if (value !== undefined) report('FCP', value);
  });
  observe('largest-contentful-paint', (entries) => {
    const value = entryValue(entries.at(-1), 'startTime');
    if (value !== undefined) report('LCP', value);
  });
  observe('event', (entries) => {
    const values = entries
      .map((entry) => entryValue(entry, 'duration'))
      .filter((value): value is number => value !== undefined);
    const value = values.length === 0 ? undefined : Math.max(...values);
    if (value !== undefined) report('INP', value);
  });
  let cls = 0;
  observe('layout-shift', (entries) => {
    for (const entry of entries) {
      if ((entry as Readonly<Record<string, unknown>>).hadRecentInput === true) continue;
      const value = entryValue(entry, 'value');
      if (value !== undefined) cls += value;
    }
    if (cls > 0) report('CLS', cls);
  });
}

function createTelemetryRecorder(browser: Window, config: MonitoringConfig) {
  const resourceAttributes: Attribute[] = [
    attribute('service.name', 'varendo-browser'),
    attribute('service.namespace', 'varendo'),
    attribute('deployment.environment', 'production'),
  ];
  if (config.version !== undefined) resourceAttributes.push(attribute('service.version', config.version));
  const resource = { attributes: resourceAttributes };
  const scope = { name: 'varendo.browser.basic', version: '1' };
  let sends = 0;
  const send = (signal: 'metrics' | 'traces', payload: object): void => {
    if (sends >= 10) return;
    sends += 1;
    try {
      void browser
        .fetch(`/otel/v1/${signal}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          mode: 'same-origin',
          redirect: 'error',
        })
        .catch(() => undefined);
    } catch {
      // Telemetry failures never affect the site.
    }
  };
  const sendMetric = (metric: object): void =>
    send('metrics', { resourceMetrics: [{ resource, scopeMetrics: [{ scope, metrics: [metric] }] }] });
  const count = (name: 'browser.page_views' | 'browser.errors', attributes: readonly Attribute[] = []): void => {
    const now = Date.now();
    sendMetric({
      name,
      unit: '1',
      sum: {
        aggregationTemporality: 1,
        isMonotonic: true,
        dataPoints: [{ attributes, startTimeUnixNano: nanoTime(now - 1), timeUnixNano: nanoTime(now), asInt: '1' }],
      },
    });
  };
  return { count, resource, scope, send, sendMetric };
}

function createVitalReporter(sendMetric: (metric: object) => void) {
  const sentMetrics = new Set<MetricName>();
  return (name: MetricName, value: number): void => {
    if (sentMetrics.has(name)) return;
    const metric = webVitalData({ name, value, rating: rating(name, value) }, Date.now());
    if (metric === undefined) return;
    sentMetrics.add(name);
    sendMetric(metric);
  };
}

function trackBrowserErrors(
  browser: Window,
  count: (name: 'browser.page_views' | 'browser.errors', attributes?: readonly Attribute[]) => void,
): void {
  let errors = 0;
  const countError = (type: 'script' | 'unhandledrejection'): void => {
    if (errors >= 3) return;
    errors += 1;
    count('browser.errors', [attribute('error.type', type)]);
  };
  browser.addEventListener('error', () => countError('script'));
  browser.addEventListener('unhandledrejection', () => countError('unhandledrejection'));
}

function reportNavigation(
  browser: Window,
  report: (name: MetricName, value: number) => void,
  send: (signal: 'metrics' | 'traces', payload: object) => void,
  resource: { readonly attributes: readonly Attribute[] },
  scope: { readonly name: string; readonly version: string },
): void {
  const navigation = browser.performance.getEntriesByType('navigation')[0];
  const loadEnd = entryValue(navigation, 'loadEventEnd');
  const ttfb = entryValue(navigation, 'responseStart');
  if (ttfb !== undefined) report('TTFB', ttfb);
  const start = browser.performance.timeOrigin;
  const traceId = randomHex(16, browser.crypto);
  const spanId = randomHex(8, browser.crypto);
  if (loadEnd === undefined || !Number.isFinite(start) || traceId === undefined || spanId === undefined) return;
  const navigationType = (navigation as PerformanceNavigationTiming).type;
  const type = ['navigate', 'reload', 'back_forward', 'prerender'].includes(navigationType)
    ? navigationType
    : 'unknown';
  send('traces', {
    resourceSpans: [
      {
        resource,
        scopeSpans: [
          {
            scope,
            spans: [
              {
                traceId,
                spanId,
                name: 'browser.navigation',
                kind: 1,
                startTimeUnixNano: nanoTime(start),
                endTimeUnixNano: nanoTime(start + loadEnd),
                attributes: [attribute('navigation.type', type)],
              },
            ],
          },
        ],
      },
    ],
  });
}

/** Starts a bounded, same-origin, best-effort telemetry session for one document. */
export function startBasicTelemetry(config: MonitoringConfig, browser: Window = window): boolean {
  if (!config.enabled || !isPublicVarendoSite(browser.location) || startedDocuments.has(browser)) return false;
  startedDocuments.add(browser);
  const telemetry = createTelemetryRecorder(browser, config);
  const report = createVitalReporter(telemetry.sendMetric);
  telemetry.count('browser.page_views');
  trackBrowserErrors(browser, telemetry.count);
  observeBrowserVitals(report);
  reportNavigation(browser, report, telemetry.send, telemetry.resource, telemetry.scope);
  return true;
}

export async function startDeploymentTelemetry(browser: Window = window): Promise<boolean> {
  if (!isPublicVarendoSite(browser.location)) return false;
  try {
    const response = await browser.fetch(`${SITE_BASE}browser-monitoring.json`, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    const config = response.ok ? parseMonitoringConfig(await response.json()) : undefined;
    return config === undefined ? false : startBasicTelemetry(config, browser);
  } catch {
    return false;
  }
}
