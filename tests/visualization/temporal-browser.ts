import { registerAeliqoElements } from '../../packages/web/src/index.js';
import type { VisualizationInputs } from '../../packages/web/src/visualization/types.js';
import type { Result } from '../../packages/core/src/index.js';
import { result as source } from '../contracts/fixtures.js';
registerAeliqoElements();
const type = {
  value: 'instant',
  nullable: true,
  temporal: { calendar: 'gregory', timezone: 'America/New_York' },
} as const;
const result: Result = {
  ...source,
  counts: { loaded: 3, population: { kind: 'unknown' } },
  coverage: { kind: 'partial', populationDigest: 'population-1', reason: 'First page only' },
  warnings: [{ code: 'partial-page', message: 'Rows beyond this page are unavailable.', retryable: false }],
  fields: [
    ...source.fields,
    { id: 'start', label: 'Start', role: 'attribute', type },
    { id: 'end', label: 'End', role: 'attribute', type },
    { id: 'amount', label: 'Amount', role: 'measure', type: { value: 'decimal', nullable: true } },
  ],
};
const rows = [
  {
    'employee.id': 'a',
    start: '2026-09-08T01:00:00Z',
    end: '2026-09-08T03:00:00Z',
    amount: { decimal: '100000000000000000000.01' },
  },
  { 'employee.id': 'b', start: '2026-09-08T02:00:00Z', end: '2026-09-08T04:00:00Z', amount: null },
  { 'employee.id': 'c', start: null, end: null, amount: null },
];
const views: HTMLElement[] = [];
for (const view of ['matrix', 'timeline', 'calendar-grid'] as const) {
  const element = document.createElement(`aeliqo-${view}`) as HTMLElement & VisualizationInputs;
  Object.assign(element, {
    label: view,
    context: { results: [result] },
    datasets: [{ result: result.ref, rows }],
    visualization: {
      version: '1',
      view,
      result: result.ref,
      ...(view === 'matrix'
        ? { columns: ['employee.id', 'amount'] }
        : view === 'timeline'
          ? { start: 'start', end: 'end' }
          : { date: 'start' }),
    },
  });
  element.addEventListener('aeliqo-visualization-select', (event) =>
    Object.assign(window, { selection: (event as CustomEvent).detail }),
  );
  document.querySelector('main')!.append(element);
  views.push(element);
}
Object.assign(window, { views });
