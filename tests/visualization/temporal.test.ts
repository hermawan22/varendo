import { expect, it } from 'vitest';
import type { Result, VisualizationSpec } from '../../packages/core/src/index.js';
import { result as source } from '../contracts/fixtures.js';
import type { VisualizationInputs } from '../../packages/web/src/visualization/types.js';
import { compileTemporalVisualization } from '../../packages/web/src/visualization/temporal/geometry.js';
import {
  AeliqoCalendarGridElement,
  AeliqoMatrixElement,
  AeliqoTimelineElement,
  defineTemporalElements,
} from '../../packages/web/src/visualization/temporal/index.js';
const type = {
  value: 'instant',
  nullable: true,
  temporal: { calendar: 'gregory', timezone: 'America/New_York' },
} as const;
const result: Result = {
  ...source,
  counts: { loaded: 3, population: { kind: 'unknown' } },
  coverage: { kind: 'unknown', reason: 'Loaded page' },
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
const input = (visualization: VisualizationSpec): VisualizationInputs => ({
  visualization,
  context: { results: [result] },
  datasets: [{ result: result.ref, rows }],
  label: 'Example',
  width: 640,
  height: 320,
  maxMarks: 1000,
});
const timeline: VisualizationSpec = { version: '1', view: 'timeline', result: result.ref, start: 'start', end: 'end' };
it('allocates overlap lanes and preserves exact/null rows without marks for missing endpoints', () => {
  const g = compileTemporalVisualization(input(timeline));
  expect(g.ok).toBe(true);
  if (!g.ok) return;
  expect(g.value.timeline?.map((m) => m.lane)).toEqual([0, 1]);
  expect(g.value.rows).toHaveLength(3);
  expect(g.value.rows[0]?.values.amount).toEqual({ decimal: '100000000000000000000.01' });
});
it('rejects backwards intervals and revoked result bindings', () => {
  const a = input(timeline);
  expect(
    compileTemporalVisualization({
      ...a,
      datasets: [
        { result: result.ref, rows: rows.map((r, i) => (i === 0 ? { ...r, end: '2026-09-07T03:00:00Z' } : r)) },
      ],
    }).ok,
  ).toBe(false);
  expect(compileTemporalVisualization({ ...a, context: { results: [] } }).ok).toBe(false);
});
it('retains data when lane and mark budgets are exceeded', () => {
  for (const a of [
    {
      ...input(timeline),
      height: 120,
      datasets: [
        {
          result: result.ref,
          rows: rows.map((r) => ({ ...r, start: '2026-09-08T01:00:00Z', end: '2026-09-08T04:00:00Z' })),
        },
      ],
    },
    { ...input(timeline), maxMarks: 1 },
  ]) {
    const g = compileTemporalVisualization(a);
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.value.state).toBe('data-only');
      expect(g.value.rows).toHaveLength(3);
    }
  }
});
it('uses the declared timezone to group days and explicit week boundaries', () => {
  const g = compileTemporalVisualization(
    input({ version: '1', view: 'calendar-grid', result: result.ref, date: 'start', weekStartsOn: 0 }),
  );
  expect(g.ok).toBe(true);
  if (!g.ok) return;
  expect(g.value.days?.map((d) => [d.date, d.rows.length])).toEqual([['2026-09-07', 2]]);
  expect(g.value.weekStartsOn).toBe(0);
});
it('keeps unsupported calendars and large spans as exact data', () => {
  const a = input({ version: '1', view: 'calendar-grid', result: result.ref, date: 'start' });
  const alternate = {
    ...result,
    fields: result.fields.map((f) =>
      f.id === 'start' ? { ...f, type: { ...type, temporal: { ...type.temporal, calendar: 'hebrew' } } } : f,
    ),
  };
  for (const value of [
    { ...a, context: { results: [alternate] } },
    {
      ...a,
      datasets: [
        { result: result.ref, rows: rows.map((r, i) => (i === 0 ? { ...r, start: '2020-01-01T00:00:00Z' } : r)) },
      ],
    },
  ]) {
    const g = compileTemporalVisualization(value);
    expect(g.ok).toBe(true);
    if (g.ok) expect(g.value.state).toBe('data-only');
  }
});
it('preserves matrix column order and bounds unsafe dimensions', () => {
  const a = input({ version: '1', view: 'matrix', result: result.ref, columns: ['amount', 'employee.id'] });
  const g = compileTemporalVisualization(a);
  expect(g.ok).toBe(true);
  if (g.ok) expect(g.value.columns).toEqual(['amount', 'employee.id']);
  expect(compileTemporalVisualization({ ...a, width: Infinity }).ok).toBe(false);
});
it('registers temporal elements in the supplied registry and rejects incompatible definitions', () => {
  const constructors = new Map<string, CustomElementConstructor>();
  const registry = {
    get: (name: string) => constructors.get(name),
    define: (name: string, constructor: CustomElementConstructor) => constructors.set(name, constructor),
  } as unknown as CustomElementRegistry;
  defineTemporalElements(registry);
  expect(constructors.get('aeliqo-matrix')).toBe(AeliqoMatrixElement);
  expect(constructors.get('aeliqo-timeline')).toBe(AeliqoTimelineElement);
  expect(constructors.get('aeliqo-calendar-grid')).toBe(AeliqoCalendarGridElement);
  defineTemporalElements(registry);
  const incompatible = {
    get: () =>
      class {
        static readonly aeliqoVersion = '0.1.0-m0';
      },
    define: () => undefined,
  } as unknown as CustomElementRegistry;
  expect(() => defineTemporalElements(incompatible)).toThrow('incompatible');
});
it('reports a stable error when no custom element registry is available', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  Object.defineProperty(globalThis, 'customElements', { value: undefined, configurable: true });
  try {
    expect(() => defineTemporalElements()).toThrow('Temporal visualization elements require a CustomElementRegistry.');
  } finally {
    if (descriptor === undefined) delete (globalThis as { customElements?: CustomElementRegistry }).customElements;
    else Object.defineProperty(globalThis, 'customElements', descriptor);
  }
});
