import { registerAeliqoElements } from '@varendo/web';
import type { Result, ResultRef, VisualizationSpec } from '@varendo/core';
import type { VisualizationBindingContext } from '@varendo/core/visualization';

registerAeliqoElements();

const ROW_COUNT = 1_000;
const BAR_WIDTH = 3_600;
const TREND_WIDTH = 3_600;
const HEIGHT = 480;
const MAX_MARKS = 2_000;
const POPULATION_DIGEST = 'adverse-visualization-population';

const barRef: ResultRef = {
  id: 'adverse-bar',
  revision: '1',
  outputId: 'categories',
  queryDigest: 'adverse-bar-query',
  scopeDigest: 'adverse-bar-scope',
};
const trendRef: ResultRef = {
  id: 'adverse-trend',
  revision: '1',
  outputId: 'observations',
  queryDigest: 'adverse-trend-query',
  scopeDigest: 'adverse-trend-scope',
};

const barFieldTypes = {
  id: { value: 'text', nullable: false },
  category: { value: 'text', nullable: false },
  label: { value: 'text', nullable: false },
  date: { value: 'date', nullable: false, temporal: { calendar: 'gregory', grain: 'day' } },
  value: { value: 'integer', nullable: true },
} as const;

const fields: Result['fields'] = [
  { id: 'id', label: 'ID', role: 'identity', type: barFieldTypes.id },
  { id: 'category', label: 'Kategorie', role: 'dimension', type: barFieldTypes.category },
  { id: 'label', label: 'Lokalisierte Bezeichnung', role: 'attribute', type: barFieldTypes.label },
  { id: 'date', label: 'Datum', role: 'time', type: barFieldTypes.date },
  { id: 'value', label: 'Wert', role: 'measure', type: barFieldTypes.value },
];

const longLabel = (index: number): string => {
  const suffix = String(index + 1).padStart(4, '0');
  return `Beschäftigtenverteilung für die internationale Produktgruppe ${suffix} — département régional / 東京の分類 / توزيع الموظفين`;
};

const rows = (withNulls: boolean): readonly Record<string, string | number | null>[] =>
  Array.from({ length: ROW_COUNT }, (_, index) => ({
    id: `category-${index + 1}`,
    category: `category-${index + 1}`,
    label: longLabel(index),
    date: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10),
    value: withNulls && index % 4 === 0 ? null : index + 1,
  }));

const makeResult = (ref: ResultRef): Result => ({
  version: '1',
  ref,
  taskId: 'adverse-visualization-task',
  identity: ['id'],
  rowGrain: ['id', 'category', 'label', 'date', 'value'],
  fields,
  counts: { loaded: ROW_COUNT, population: { kind: 'exact', value: ROW_COUNT, populationDigest: POPULATION_DIGEST } },
  precision: { kind: 'exact' },
  coverage: { kind: 'complete', populationDigest: POPULATION_DIGEST },
  consistency: { kind: 'snapshot', snapshotId: 'adverse-snapshot', sourceRevisions: { source: '1' } },
  evidence: { kind: 'observed', source: { id: 'adverse-source', revision: '1' } },
  filters: [],
  warnings: [],
  lineage: [],
});

const barResult = makeResult(barRef);
const trendResult = makeResult(trendRef);
const barRows = rows(false);
const trendRows = rows(true);
const context = (result: Result): VisualizationBindingContext => ({ results: [result] });

const plot = (ref: ResultRef, mark: 'bar' | 'line', encoding: Record<string, unknown>): VisualizationSpec =>
  ({
    version: '1',
    view: mark === 'bar' ? 'bar' : 'trend',
    plot: { version: '1', root: { kind: 'unit', mark, result: ref, missing: 'gap', encoding } },
  }) as VisualizationSpec;

const barVisualization = plot(barRef, 'bar', {
  x: { field: 'category', scale: 'ordinal' },
  y: { field: 'value', scale: 'linear', zero: true },
});
const trendVisualization = plot(trendRef, 'line', {
  x: { field: 'date', scale: 'temporal' },
  y: { field: 'value', scale: 'linear' },
});

type VisualizationHost = HTMLElement & {
  context: VisualizationBindingContext;
  datasets: readonly unknown[];
  visualization: VisualizationSpec;
  width: number;
  height: number;
  maxMarks: number;
  selectedIdentity: string;
  updateComplete: Promise<unknown>;
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
  readonly oscillationShell: HTMLElement;
  oscillate(cycles?: number): Promise<readonly OscillationObservation[]>;
};

const fixture = document.querySelector<HTMLElement>('#fixture');
if (fixture === null) throw new Error('Adverse visualization fixture root is missing.');

const identityFor = (id: string): string => JSON.stringify([JSON.stringify(['text', id])]);
const selectedSet = Object.freeze(barRows.map((row) => identityFor(String(row.id))));

function mountVisualization(
  tag: 'bar' | 'trend',
  label: string,
  visualization: VisualizationSpec,
  result: Result,
  data: readonly Record<string, string | number | null>[],
  width: number,
): VisualizationHost {
  const element = document.createElement(`aeliqo-${tag}`) as VisualizationHost;
  Object.assign(element, {
    label,
    visualization,
    context: context(result),
    datasets: [{ result: result.ref, rows: data }],
    width,
    height: HEIGHT,
    maxMarks: MAX_MARKS,
  });
  return element;
}

const barSection = document.createElement('section');
barSection.setAttribute('aria-labelledby', 'bar-title');
barSection.innerHTML = '<h2 id="bar-title">1,000 localized categories</h2>';
const barShell = document.createElement('div');
barShell.className = 'measurement-shell';
const bar = mountVisualization('bar', 'Localized categories', barVisualization, barResult, barRows, BAR_WIDTH);
barShell.append(bar);
barSection.append(barShell);

const trendSection = document.createElement('section');
trendSection.setAttribute('aria-labelledby', 'trend-title');
trendSection.innerHTML = '<h2 id="trend-title">Null-heavy observations</h2>';
const trendShell = document.createElement('div');
trendShell.className = 'measurement-shell';
const trend = mountVisualization(
  'trend',
  'Null-heavy observations',
  trendVisualization,
  trendResult,
  trendRows,
  TREND_WIDTH,
);
trendShell.append(trend);
trendSection.append(trendShell);

fixture.append(barSection, trendSection);
bar.selectedIdentity = selectedSet[0]!;

async function oscillate(cycles = 40): Promise<readonly OscillationObservation[]> {
  const observations: OscillationObservation[] = [];
  const widths = [960, BAR_WIDTH];
  for (let index = 0; index < cycles; index += 1) {
    const width = widths[index % widths.length]!;
    const started = performance.now();
    barShell.style.inlineSize = `${width}px`;
    bar.width = width;
    await bar.updateComplete;
    const viewport = bar.shadowRoot?.querySelector<HTMLElement>('[part=viewport]');
    const containerBounds = barShell.getBoundingClientRect();
    const viewportBounds = viewport?.getBoundingClientRect();
    observations.push({
      cycle: index + 1,
      width,
      mutationToDomAndLayoutMs: performance.now() - started,
      windowWidth: innerWidth,
      containerWidth: containerBounds.width,
      containerScrollWidth: barShell.scrollWidth,
      viewportWidth: viewportBounds?.width ?? 0,
      viewportClientWidth: viewport?.clientWidth ?? 0,
      viewportScrollWidth: viewport?.scrollWidth ?? 0,
      documentScrollWidth: document.documentElement.scrollWidth,
      selectedIdentity: bar.selectedIdentity,
    });
  }
  return observations;
}

await Promise.all([bar.updateComplete, trend.updateComplete]);
Object.assign(window, {
  adverseVisualization: {
    ready: true,
    selectedSet,
    bar,
    trend,
    oscillationShell: barShell,
    oscillate,
  } satisfies AdverseVisualizationApi,
});
