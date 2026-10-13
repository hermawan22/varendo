import { VarendoTextFieldElement } from '@varendo/web/inputs';
import { VarendoTableElement } from '@varendo/web/table';

export const STANDALONE_ROW_COUNT = 100;

type StandaloneRow = { readonly id: string; readonly label: string; readonly value: number };

type NavigationObservation = {
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
};

type ResourceObservation = {
  readonly name: string;
  readonly initiatorType: string;
  readonly startTime: number | null;
  readonly duration: number | null;
  readonly transferSize: number | null;
  readonly encodedBodySize: number | null;
  readonly decodedBodySize: number | null;
};

type PaintObservation = { readonly name: string; readonly startTime: number | null; readonly duration: number | null };

type TimingObservation = {
  readonly navigation: NavigationObservation | null;
  readonly resources: readonly ResourceObservation[];
  readonly paints: readonly PaintObservation[];
  readonly fixtureReadyMs: number | null;
};

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
  readonly timing: TimingObservation;
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

declare global {
  interface Window {
    varendoStandalone?: {
      readonly ready: boolean;
      readonly collect: () => StandaloneObservation;
    };
  }
}

const fixture = document.querySelector<HTMLElement>('#fixture');
if (fixture === null) throw new Error('Standalone fixture root is missing.');

if (!customElements.get('varendo-text-field')) customElements.define('varendo-text-field', VarendoTextFieldElement);
if (!customElements.get('varendo-table')) customElements.define('varendo-table', VarendoTableElement);

function makeRows(): readonly StandaloneRow[] {
  return Array.from({ length: STANDALONE_ROW_COUNT }, (_, index) => ({
    id: `row-${index + 1}`,
    label: `Row ${index + 1}`,
    value: index,
  }));
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function navigationObservation(): NavigationObservation | null {
  const entry = performance.getEntriesByType('navigation').at(-1) as PerformanceNavigationTiming | undefined;
  if (entry === undefined) return null;
  return {
    name: entry.name,
    type: entry.type,
    startTime: finiteOrNull(entry.startTime),
    duration: finiteOrNull(entry.duration),
    domInteractive: finiteOrNull(entry.domInteractive),
    domContentLoadedEventEnd: finiteOrNull(entry.domContentLoadedEventEnd),
    loadEventEnd: finiteOrNull(entry.loadEventEnd),
    transferSize: finiteOrNull(entry.transferSize),
    encodedBodySize: finiteOrNull(entry.encodedBodySize),
    decodedBodySize: finiteOrNull(entry.decodedBodySize),
  };
}

function resourceObservations(): readonly ResourceObservation[] {
  return performance.getEntriesByType('resource').map((entry) => {
    const resource = entry as PerformanceResourceTiming;
    return {
      name: resource.name,
      initiatorType: resource.initiatorType,
      startTime: finiteOrNull(resource.startTime),
      duration: finiteOrNull(resource.duration),
      transferSize: finiteOrNull(resource.transferSize),
      encodedBodySize: finiteOrNull(resource.encodedBodySize),
      decodedBodySize: finiteOrNull(resource.decodedBodySize),
    };
  });
}

function paintObservations(): readonly PaintObservation[] {
  return performance.getEntriesByType('paint').map((entry) => ({
    name: entry.name,
    startTime: finiteOrNull(entry.startTime),
    duration: finiteOrNull(entry.duration),
  }));
}

function isJavascript(resource: ResourceObservation): boolean {
  return resource.initiatorType === 'script' || /\.js(?:[?#]|$)/u.test(resource.name);
}

function timingObservation(): TimingObservation {
  const resources = resourceObservations();
  const readyMark = performance.getEntriesByName('varendo-standalone-fixture-ready').at(-1);
  return {
    navigation: navigationObservation(),
    resources,
    paints: paintObservations(),
    fixtureReadyMs: readyMark === undefined ? null : finiteOrNull(readyMark.startTime),
  };
}

function collect(): StandaloneObservation {
  const input = document.querySelector('varendo-text-field') as VarendoTextFieldElement | null;
  const table = document.querySelector('varendo-table') as VarendoTableElement | null;
  const resources = resourceObservations();
  const javascript = resources.filter(isJavascript);
  const sum = (values: readonly (number | null)[]): number | null => {
    if (values.some((value) => value === null)) return null;
    return values.reduce<number>((total, value) => total + (value ?? 0), 0);
  };
  const unavailable = (values: readonly ResourceObservation[]) =>
    values.filter(
      (resource) =>
        resource.transferSize === null || resource.encodedBodySize === null || resource.decodedBodySize === null,
    ).length;
  return {
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
      devicePixelRatio: globalThis.devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    },
    fixture: {
      rowCount: table?.rows.length ?? 0,
      renderedRows: table?.shadowRoot?.querySelectorAll('tbody tr').length ?? 0,
      controlValue: input?.shadowRoot?.querySelector<HTMLInputElement>('input')?.value ?? '',
      inputPresent: input !== null,
      tablePresent: table !== null,
    },
    timing: timingObservation(),
    resourceBytes: {
      totalTransferBytes: sum(resources.map((resource) => resource.transferSize)),
      totalEncodedBytes: sum(resources.map((resource) => resource.encodedBodySize)),
      totalDecodedBytes: sum(resources.map((resource) => resource.decodedBodySize)),
      javascriptTransferBytes: sum(javascript.map((resource) => resource.transferSize)),
      javascriptEncodedBytes: sum(javascript.map((resource) => resource.encodedBodySize)),
      javascriptDecodedBytes: sum(javascript.map((resource) => resource.decodedBodySize)),
      resourceCount: resources.length,
      javascriptResourceCount: javascript.length,
      cachedResourceCount: resources.filter(
        (resource) => resource.transferSize === 0 && resource.encodedBodySize !== null && resource.encodedBodySize > 0,
      ).length,
      cachedJavascriptResourceCount: javascript.filter(
        (resource) => resource.transferSize === 0 && resource.encodedBodySize !== null && resource.encodedBodySize > 0,
      ).length,
      resourceTimingUnavailableCount: unavailable(resources),
      javascriptResourceTimingUnavailableCount: unavailable(javascript),
    },
  };
}

const input = document.createElement('varendo-text-field') as VarendoTextFieldElement;
input.label = 'Standalone value';
input.value = 'ready';

const table = document.createElement('varendo-table') as VarendoTableElement;
table.caption = 'Standalone records';
table.columns = [
  { key: 'id', label: 'ID' },
  { key: 'label', label: 'Label' },
  { key: 'value', label: 'Value' },
];
table.identity = ['id'];
table.rows = makeRows();

fixture.replaceChildren(input, table);

await Promise.all([input.updateComplete, table.updateComplete]);
performance.mark('varendo-standalone-fixture-ready');
window.varendoStandalone = { ready: true, collect };
