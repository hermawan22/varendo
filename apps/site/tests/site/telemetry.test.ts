import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseAnalyticsConfig,
  prepareGoogleAnalytics,
  setAnalyticsConsent,
  startGoogleAnalytics,
} from '../../src/analytics.js';
import { isPublicAeliqoSite, parseMonitoringConfig, startBasicTelemetry, webVitalData } from '../../src/telemetry.js';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function fakeBrowser(hostname = 'hermawan22.github.io', protocol = 'https:') {
  const posts: Array<{ url: string; init: RequestInit }> = [];
  const browser = Object.assign(new EventTarget(), {
    location: {
      hostname,
      protocol,
      origin: `${protocol}//${hostname}`,
      pathname: '/varendo/docs',
      search: '?private=secret',
      hash: '#secret',
    },
    localStorage: storage(),
    performance: { timeOrigin: 1000, getEntriesByType: () => [] },
    fetch: vi.fn((url: string, init: RequestInit) => {
      posts.push({ url, init });
      return Promise.resolve(new Response('{}'));
    }),
  });
  return { browser: browser as unknown as Window, posts };
}

afterEach(() => vi.unstubAllGlobals());

describe('public telemetry boundary', () => {
  it('ships both deployment controls disabled', () => {
    expect(JSON.parse(readFileSync(resolve(process.cwd(), 'public/browser-monitoring.json'), 'utf8'))).toEqual({
      enabled: false,
    });
    expect(JSON.parse(readFileSync(resolve(process.cwd(), 'public/google-analytics.json'), 'utf8'))).toEqual({
      enabled: false,
    });
  });

  it('allows only the public HTTPS Varendo origins', () => {
    expect(isPublicAeliqoSite({ hostname: 'hermawan22.github.io', protocol: 'https:' } as Location)).toBe(true);
    expect(isPublicAeliqoSite({ hostname: 'hermawan22.github.io', protocol: 'https:' } as Location)).toBe(true);
    expect(isPublicAeliqoSite({ hostname: 'preview.aeliqo.com', protocol: 'https:' } as Location)).toBe(false);
    expect(isPublicAeliqoSite({ hostname: 'hermawan22.github.io', protocol: 'http:' } as Location)).toBe(false);
  });

  it('rejects disabled, malformed, and credential-like monitoring configurations', () => {
    expect(parseMonitoringConfig({ enabled: false })).toBeUndefined();
    expect(parseMonitoringConfig({ enabled: true, version: 'secret' })).toBeUndefined();
    expect(parseMonitoringConfig({ enabled: true, version: 'sha-0123456789abcdef0123456789abcdef01234567' })).toEqual({
      enabled: true,
      version: 'sha-0123456789abcdef0123456789abcdef01234567',
    });
  });

  it('serializes only bounded numeric telemetry and omits error details', async () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(12) });
    const { browser, posts } = fakeBrowser();
    expect(startBasicTelemetry({ enabled: true }, browser)).toBe(true);
    for (let index = 0; index < 4; index += 1) browser.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(posts).toHaveLength(4));
    expect(
      posts.every(
        ({ url, init }) =>
          url === '/otel/v1/metrics' &&
          init.credentials === 'omit' &&
          init.referrerPolicy === 'no-referrer' &&
          init.mode === 'same-origin' &&
          init.redirect === 'error' &&
          init.keepalive === true,
      ),
    ).toBe(true);
    const serialized = posts.map(({ init }) => init.body).join('');
    expect(serialized).not.toMatch(/private|secret|url|referrer|session|message|stack/i);
    expect(serialized).toContain('browser.page_views');
    expect(serialized.match(/browser.errors/g)).toHaveLength(3);
  });

  it('produces a finite histogram with a bounded rating only', () => {
    expect(webVitalData({ name: 'LCP', value: Number.NaN, rating: 'good' }, 2)).toBeUndefined();
    const metric = webVitalData({ name: 'CLS', value: 0.2, rating: 'needs-improvement' }, 2);
    expect(metric).toMatchObject({ name: 'browser.web_vital.cls', unit: '1' });
    expect(JSON.stringify(metric)).not.toMatch(/url|referrer|session|id/i);
  });
});

describe('consented Google Analytics boundary', () => {
  it('shows a choice and does not load the script until Allow is selected', () => {
    const { browser } = fakeBrowser();
    const dialog = { hidden: true };
    const decline = new EventTarget();
    const allow = new EventTarget();
    const appended: Array<{ dataset: Record<string, string> }> = [];
    const documentRef = {
      querySelector: (selector: string) =>
        selector === '#analytics-consent'
          ? dialog
          : selector === '#analytics-decline'
            ? decline
            : selector === '#analytics-allow'
              ? allow
              : null,
      createElement: () => ({ dataset: {} }),
      head: { append: (script: (typeof appended)[number]) => appended.push(script) },
    } as unknown as Document;
    const config = parseAnalyticsConfig({ enabled: true, measurementId: 'G-ABCDEF' });
    expect(prepareGoogleAnalytics(config!, browser, documentRef)).toBe(true);
    expect(dialog.hidden).toBe(false);
    expect(appended).toEqual([]);
    allow.dispatchEvent(new Event('click'));
    expect(dialog.hidden).toBe(true);
    expect(appended).toHaveLength(1);
  });

  it('loads only after consent and sends the public path without a persistent client store', () => {
    const { browser } = fakeBrowser();
    const appended: Array<{
      src: string;
      dataset: Record<string, string>;
      onload?: () => void;
      async?: boolean;
      referrerPolicy?: string;
    }> = [];
    const documentRef = {
      querySelector: (selector: string) =>
        selector.startsWith('script')
          ? (appended.find((script) => selector.includes(script.dataset.aeliqoGa ?? '')) ?? null)
          : null,
      createElement: () => ({ dataset: {} }),
      head: { append: (script: (typeof appended)[number]) => appended.push(script) },
    } as unknown as Document;
    const config = parseAnalyticsConfig({ enabled: true, measurementId: 'G-ABCDEF' });
    expect(config).toBeDefined();
    expect(startGoogleAnalytics(config!, browser, documentRef)).toBe(false);
    setAnalyticsConsent(true, browser);
    expect(startGoogleAnalytics(config!, browser, documentRef)).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-ABCDEF');
    expect(appended[0]!.referrerPolicy).toBe('no-referrer');
    appended[0]!.onload?.();
    const commands = (browser as Window).dataLayer ?? [];
    expect(commands.map((command) => Object.prototype.toString.call(command))).toEqual([
      '[object Arguments]',
      '[object Arguments]',
      '[object Arguments]',
    ]);
    const commandArguments = commands.map((command) => Array.from(command as IArguments));
    expect(commandArguments[0]).toEqual(['js', expect.any(Date)]);
    expect(commandArguments[1]).toEqual([
      'config',
      'G-ABCDEF',
      {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        anonymize_ip: true,
        client_storage: 'none',
      },
    ]);
    expect(commandArguments[2]).toEqual([
      'event',
      'page_view',
      { page_location: 'https://hermawan22.github.io/varendo/docs', page_path: '/varendo/docs' },
    ]);
    const sent = JSON.stringify(commands);
    expect(sent).toContain('client_storage');
    expect(sent).toContain('none');
    expect(sent).not.toMatch(/private|secret|\?|#/);
  });

  it('rejects disabled and invalid analytics configurations', () => {
    expect(parseAnalyticsConfig({ enabled: false, measurementId: 'G-ABCDEF' })).toBeUndefined();
    expect(parseAnalyticsConfig({ enabled: true, measurementId: 'not-an-id' })).toBeUndefined();
  });
});
