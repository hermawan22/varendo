import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

type Dataset = {
  readonly result: {
    readonly id: string;
    readonly revision: string;
    readonly outputId: string;
    readonly queryDigest: string;
    readonly scopeDigest: string;
  };
  readonly rows: readonly Record<string, string | number | null>[];
};

type VisualizationHost = HTMLElement & {
  readonly context: { readonly results: readonly unknown[] };
  readonly datasets: readonly Dataset[];
  readonly maxMarks: number;
  readonly selectedIdentity: string;
  readonly updateComplete: Promise<unknown>;
};

type OscillationObservation = {
  readonly cycle: number;
  readonly width: number;
  readonly mutationToDomAndLayoutMs: number;
  readonly windowWidth: number;
  readonly containerWidth: number;
  readonly containerScrollWidth: number;
  readonly viewportWidth: number;
  readonly viewportClientWidth: number;
  readonly viewportScrollWidth: number;
  readonly documentScrollWidth: number;
  readonly selectedIdentity: string;
};

type AdverseVisualizationApi = {
  readonly ready: boolean;
  readonly selectedSet: readonly string[];
  readonly bar: VisualizationHost;
  readonly trend: VisualizationHost;
  oscillate(cycles?: number): Promise<readonly OscillationObservation[]>;
};

type StructureObservation = {
  readonly bar: {
    readonly rowCount: number;
    readonly uniqueIdentities: number;
    readonly firstIdentity: string;
    readonly firstPageRows: number;
    readonly firstPageButtons: number;
    readonly idsMatchExpected: boolean;
    readonly svgRectCount: number;
    readonly svgPathCount: number;
    readonly svgTextCount: number;
    readonly tableText: string;
    readonly scopeText: string;
    readonly tableCaption: string;
  };
  readonly trend: {
    readonly rowCount: number;
    readonly nullValueCount: number;
    readonly uniqueIdentities: number;
    readonly firstPageRows: number;
    readonly firstPageButtons: number;
    readonly idsMatchExpected: boolean;
    readonly markPathCount: number;
    readonly markPathSegmentCount: number;
    readonly svgTextCount: number;
    readonly tableText: string;
    readonly scopeText: string;
    readonly tableCaption: string;
  };
  readonly selectedSetCount: number;
  readonly selectedSetMatchesExpected: boolean;
};

type AdverseVisualizationReport = {
  readonly schema: 'aeliqo.performance.adverse-visualization.v1';
  readonly sourceCommit: string;
  readonly environment: {
    readonly userAgent: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly devicePixelRatio: number;
    readonly browser: string;
  };
  readonly fixture: {
    readonly rows: number;
    readonly nullRows: number;
    readonly selectedSet: number;
    readonly maxMarks: number;
    readonly desktopOnly: true;
  };
  readonly structure: StructureObservation;
  readonly oscillation: readonly OscillationObservation[];
  readonly timing: {
    readonly sampleCount: number;
    readonly p50Ms: number | null;
    readonly p95Ms: number | null;
    readonly valuesMs: readonly number[];
  };
  readonly network: { readonly requestsDuringInteraction: number; readonly urls: readonly string[] };
  readonly notes: readonly string[];
};

const FIXTURE_PATH = '/tests/performance/adverse-visualization.html';
const MAX_MARKS = 2_000;
const PAGE_SIZE = 25;
const PAGE_COUNT = 40;

function nearestRank(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? null;
}

async function openFixture(page: Page): Promise<void> {
  await page.goto(FIXTURE_PATH, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const api = (window as Window & { adverseVisualization?: AdverseVisualizationApi }).adverseVisualization;
    return api?.ready === true;
  });
}

async function collectStructure(page: Page): Promise<StructureObservation> {
  return page.evaluate(() => {
    const api = (window as Window & { adverseVisualization?: AdverseVisualizationApi }).adverseVisualization;
    if (api?.ready !== true) throw new Error('Adverse visualization fixture is not ready.');

    const identitySet = (host: VisualizationHost): Set<string> => {
      const rows = host.datasets[0]?.rows ?? [];
      return new Set(rows.map((row) => JSON.stringify([JSON.stringify(['text', row.id])])));
    };
    const barRows = api.bar.datasets[0]?.rows ?? [];
    const trendRows = api.trend.datasets[0]?.rows ?? [];
    const expectedIds = Array.from({ length: 1_000 }, (_, index) => `category-${index + 1}`);
    const identityFor = (id: string): string => JSON.stringify([JSON.stringify(['text', id])]);
    const barIds = barRows.map((row) => String(row.id));
    const trendIds = trendRows.map((row) => String(row.id));
    const barRoot = api.bar.shadowRoot;
    const trendRoot = api.trend.shadowRoot;
    if (barRoot === null || trendRoot === null) throw new Error('Production visualization shadow roots are missing.');
    const barSvg = barRoot.querySelector<SVGSVGElement>('svg');
    const trendSvg = trendRoot.querySelector<SVGSVGElement>('svg');
    if (barSvg === null || trendSvg === null) throw new Error('Production visualization SVGs are missing.');
    const trendPaths = [...trendSvg.querySelectorAll<SVGPathElement>('path')];
    const axisPath = (path: SVGPathElement): boolean => path.getAttribute('d')?.startsWith('M64,24V') === true;
    const trendMarkPaths = trendPaths.filter((path) => !axisPath(path));
    return {
      bar: {
        rowCount: barRows.length,
        uniqueIdentities: identitySet(api.bar).size,
        firstIdentity: JSON.stringify([JSON.stringify(['text', String(barRows[0]?.id)])]),
        firstPageRows: barRoot.querySelectorAll('tbody tr').length,
        firstPageButtons: barRoot.querySelectorAll('button[data-aeliqo-row-identity]').length,
        idsMatchExpected:
          barIds.length === expectedIds.length && barIds.every((id, index) => id === expectedIds[index]),
        svgRectCount: barSvg.querySelectorAll('rect').length,
        svgPathCount: barSvg.querySelectorAll('path').length,
        svgTextCount: barSvg.querySelectorAll('text').length,
        tableText: barRoot.querySelector('table')?.textContent ?? '',
        scopeText: barRoot.querySelector('[part="scope"]')?.textContent ?? '',
        tableCaption: barRoot.querySelector('table caption')?.textContent ?? '',
      },
      trend: {
        rowCount: trendRows.length,
        nullValueCount: trendRows.filter((row) => row.value === null).length,
        uniqueIdentities: identitySet(api.trend).size,
        firstPageRows: trendRoot.querySelectorAll('tbody tr').length,
        firstPageButtons: trendRoot.querySelectorAll('button[data-aeliqo-row-identity]').length,
        idsMatchExpected:
          trendIds.length === expectedIds.length && trendIds.every((id, index) => id === expectedIds[index]),
        markPathCount: trendMarkPaths.length,
        markPathSegmentCount: trendMarkPaths.reduce(
          (count, path) => count + (path.getAttribute('d')?.match(/M/gu)?.length ?? 0),
          0,
        ),
        svgTextCount: trendSvg.querySelectorAll('text').length,
        tableText: trendRoot.querySelector('table')?.textContent ?? '',
        scopeText: trendRoot.querySelector('[part="scope"]')?.textContent ?? '',
        tableCaption: trendRoot.querySelector('table caption')?.textContent ?? '',
      },
      selectedSetCount: api.selectedSet.length,
      selectedSetMatchesExpected:
        api.selectedSet.length === expectedIds.length &&
        api.selectedSet.every((identity, index) => identity === identityFor(expectedIds[index]!)),
    };
  });
}

test('observes adverse dense and null-heavy visualization behavior with exact data alternatives', async ({
  page,
}, testInfo) => {
  await openFixture(page);
  const structure = await collectStructure(page);
  const sourceCommit = process.env.AELIQO_SOURCE_COMMIT ?? 'unknown';
  const requestUrls: string[] = [];
  const requestListener = (request: { url(): string }) => requestUrls.push(request.url());
  page.on('request', requestListener);
  let oscillation: readonly OscillationObservation[] = [];
  try {
    oscillation = await page.evaluate(async () => {
      const fixture = (window as Window & { adverseVisualization?: AdverseVisualizationApi }).adverseVisualization;
      if (fixture?.ready !== true) throw new Error('Adverse visualization fixture is not ready.');
      return fixture.oscillate(40);
    });
    const bar = page.locator('aeliqo-bar');
    await bar.locator('details[part="data-details"] > summary').click();
    const next = bar.getByRole('button', { name: 'Next', exact: true });
    const previous = bar.getByRole('button', { name: 'Previous', exact: true });
    await expect(next).toBeEnabled();
    for (let pageIndex = 1; pageIndex < PAGE_COUNT; pageIndex += 1) {
      await next.click();
      await expect(bar.locator('tbody tr')).toHaveCount(PAGE_SIZE);
    }
    await expect(next).toBeDisabled();
    await expect(bar.locator('tbody tr').last()).toContainText('category-1000');
    for (let pageIndex = 1; pageIndex < PAGE_COUNT; pageIndex += 1) {
      await previous.click();
      await expect(bar.locator('tbody tr')).toHaveCount(PAGE_SIZE);
    }
    await expect(previous).toBeDisabled();
    await expect(bar.locator('tbody tr').first().locator('button')).toHaveAttribute('aria-pressed', 'true');
  } finally {
    page.off('request', requestListener);
  }

  const report: AdverseVisualizationReport = {
    schema: 'aeliqo.performance.adverse-visualization.v1',
    sourceCommit,
    environment: await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      browser: navigator.userAgent,
    })),
    fixture: {
      rows: structure.bar.rowCount,
      nullRows: structure.trend.nullValueCount,
      selectedSet: structure.selectedSetCount,
      maxMarks: MAX_MARKS,
      desktopOnly: true,
    },
    structure,
    oscillation,
    timing: {
      sampleCount: oscillation.length,
      p50Ms: nearestRank(
        oscillation.map((sample) => sample.mutationToDomAndLayoutMs),
        0.5,
      ),
      p95Ms: nearestRank(
        oscillation.map((sample) => sample.mutationToDomAndLayoutMs),
        0.95,
      ),
      valuesMs: oscillation.map((sample) => sample.mutationToDomAndLayoutMs),
    },
    network: { requestsDuringInteraction: requestUrls.length, urls: requestUrls },
    notes: [
      'The fixture imports the production @varendo/web custom elements and @varendo/core result/spec contracts through the package entry points.',
      'Bar geometry and line segments are counted from the live SVG. The table is the exact, paginated accessible alternative; its DOM contains only the visible page rows.',
      'Null trend values are retained in the exact table and produce separate line paths, so a path does not bridge a missing observation.',
      'Oscillation timing is raw mutation-to-DOM-and-forced-layout observation. It includes the component DOM update and synchronous layout reads; it is not a paint or input-to-paint timestamp and does not use requestAnimationFrame.',
      'The probe records no timing threshold or pass budget, uses no screenshots or visual approval, and reports this desktop Chromium environment only.',
    ],
  };
  const output = testInfo.outputPath('adverse-visualization-report.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  expect(structure.bar.rowCount).toBe(1_000);
  expect(structure.bar.uniqueIdentities).toBe(1_000);
  expect(structure.bar.idsMatchExpected).toBe(true);
  expect(structure.bar.firstIdentity).toBe(JSON.stringify([JSON.stringify(['text', 'category-1'])]));
  expect(structure.bar.firstPageRows).toBe(PAGE_SIZE);
  expect(structure.bar.firstPageButtons).toBe(PAGE_SIZE);
  expect(structure.bar.svgRectCount).toBeLessThanOrEqual(MAX_MARKS);
  expect(structure.bar.tableText).toContain('Beschäftigtenverteilung für die internationale Produktgruppe');
  expect(structure.bar.scopeText).toMatch(/\d+ rows\./u);
  expect(structure.bar.tableCaption).toContain('Exact loaded values');

  expect(structure.trend.rowCount).toBe(1_000);
  expect(structure.trend.nullValueCount).toBe(250);
  expect(structure.trend.uniqueIdentities).toBe(1_000);
  expect(structure.trend.idsMatchExpected).toBe(true);
  expect(structure.trend.firstPageRows).toBe(PAGE_SIZE);
  expect(structure.trend.firstPageButtons).toBe(PAGE_SIZE);
  expect(structure.trend.markPathSegmentCount).toBe(250);
  expect(structure.trend.tableText).toContain('Missing');
  expect(structure.trend.scopeText).toMatch(/\d+ rows\./u);
  expect(structure.trend.tableCaption).toContain('Exact loaded values');

  expect(structure.selectedSetCount).toBe(1_000);
  expect(structure.selectedSetMatchesExpected).toBe(true);
  expect(oscillation).toHaveLength(40);
  expect(
    oscillation.every(
      (sample) => Number.isFinite(sample.mutationToDomAndLayoutMs) && sample.mutationToDomAndLayoutMs >= 0,
    ),
  ).toBe(true);
  expect(oscillation.every((sample) => sample.windowWidth === 1_440)).toBe(true);
  expect(oscillation.every((sample) => sample.containerWidth > 0 && sample.containerWidth <= sample.windowWidth)).toBe(
    true,
  );
  expect(oscillation.every((sample) => sample.containerScrollWidth <= sample.windowWidth)).toBe(true);
  expect(oscillation.every((sample) => sample.documentScrollWidth <= sample.windowWidth)).toBe(true);
  const wideSamples = oscillation.filter((sample) => sample.width === 3_600);
  expect(wideSamples.length).toBe(20);
  expect(wideSamples.every((sample) => sample.viewportWidth > 0 && sample.viewportWidth <= sample.windowWidth)).toBe(
    true,
  );
  expect(wideSamples.every((sample) => sample.viewportClientWidth <= sample.viewportWidth)).toBe(true);
  expect(wideSamples.every((sample) => sample.viewportScrollWidth >= sample.width)).toBe(true);
  expect(wideSamples.every((sample) => sample.containerWidth <= sample.viewportWidth)).toBe(true);
  const narrowSamples = oscillation.filter((sample) => sample.width === 960);
  expect(narrowSamples.length).toBe(20);
  expect(narrowSamples.every((sample) => sample.viewportScrollWidth === 0)).toBe(true);
  expect(oscillation.every((sample) => sample.selectedIdentity === structure.bar.firstIdentity)).toBe(true);
  expect(new Set(oscillation.map((sample) => sample.width))).toEqual(new Set([960, 3_600]));
  expect(requestUrls).toEqual([]);
});
