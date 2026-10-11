import { SITE_BASE } from './base.js';
import { isPublicAeliqoSite } from './telemetry.js';

const consentKey = 'aeliqo:analytics-consent:v1';
const consentEvent = 'aeliqo:analytics-consent';
const measurementIdPattern = /^G-[A-Z0-9]{6,}$/;

type AnalyticsConfig = Readonly<{ enabled: true; measurementId: string }>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function parseAnalyticsConfig(input: unknown): AnalyticsConfig | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = input as Readonly<Record<string, unknown>>;
  if (
    value.enabled !== true ||
    typeof value.measurementId !== 'string' ||
    !measurementIdPattern.test(value.measurementId)
  )
    return undefined;
  return { enabled: true, measurementId: value.measurementId };
}

function consent(browser: Window): 'granted' | 'denied' | undefined {
  try {
    const value = browser.localStorage.getItem(consentKey);
    return value === 'granted' || value === 'denied' ? value : undefined;
  } catch {
    return undefined;
  }
}

function consentDialog(documentRef: Document): HTMLElement | undefined {
  return documentRef.querySelector<HTMLElement>('#analytics-consent') ?? undefined;
}

export function setAnalyticsConsent(granted: boolean, browser: Window = window): void {
  try {
    browser.localStorage.setItem(consentKey, granted ? 'granted' : 'denied');
  } catch {
    return;
  }
  browser.dispatchEvent(new Event(consentEvent));
}

export function startGoogleAnalytics(
  config: AnalyticsConfig,
  browser: Window = window,
  documentRef: Document = document,
): boolean {
  if (!isPublicAeliqoSite(browser.location) || consent(browser) !== 'granted') return false;
  if (documentRef.querySelector(`script[data-aeliqo-ga="${config.measurementId}"]`)) return true;
  const script = documentRef.createElement('script');
  script.async = true;
  script.referrerPolicy = 'no-referrer';
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.measurementId)}`;
  script.dataset.aeliqoGa = config.measurementId;
  script.onload = () => {
    browser.dataLayer = browser.dataLayer ?? [];
    browser.gtag = function gtag() {
      browser.dataLayer?.push(arguments);
    };
    browser.gtag('js', new Date());
    const pageLocation = `${browser.location.origin}${browser.location.pathname}`;
    browser.gtag('config', config.measurementId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      anonymize_ip: true,
      client_storage: 'none',
    });
    browser.gtag('event', 'page_view', { page_location: pageLocation, page_path: browser.location.pathname });
  };
  documentRef.head.append(script);
  return true;
}

export function prepareGoogleAnalytics(
  config: AnalyticsConfig,
  browser: Window = window,
  documentRef: Document = document,
): boolean {
  if (!isPublicAeliqoSite(browser.location)) return false;
  const dialog = consentDialog(documentRef);
  const current = consent(browser);
  if (current === undefined && dialog !== undefined) {
    dialog.hidden = false;
    documentRef.querySelector<HTMLButtonElement>('#analytics-decline')?.addEventListener(
      'click',
      () => {
        setAnalyticsConsent(false, browser);
        dialog.hidden = true;
      },
      { once: true },
    );
    documentRef.querySelector<HTMLButtonElement>('#analytics-allow')?.addEventListener(
      'click',
      () => {
        setAnalyticsConsent(true, browser);
        dialog.hidden = true;
        startGoogleAnalytics(config, browser, documentRef);
      },
      { once: true },
    );
    return true;
  }
  if (dialog !== undefined) dialog.hidden = true;
  return current === 'granted' ? startGoogleAnalytics(config, browser, documentRef) : false;
}

export async function prepareDeploymentAnalytics(
  browser: Window = window,
  documentRef: Document = document,
): Promise<boolean> {
  if (!isPublicAeliqoSite(browser.location)) return false;
  try {
    const response = await browser.fetch(`${SITE_BASE}google-analytics.json`, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    const config = response.ok ? parseAnalyticsConfig(await response.json()) : undefined;
    return config === undefined ? false : prepareGoogleAnalytics(config, browser, documentRef);
  } catch {
    return false;
  }
}
