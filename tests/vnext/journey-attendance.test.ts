import { describe, expect, it } from 'vitest';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/registry.js';
import { createQueryPlanner } from '../../packages/core/src/query/index.js';
import { resolvePresentation } from '../../packages/core/src/presentation/index.js';
import type { Catalog, MeaningDefinition, QuerySpec } from '../../packages/core/src/contracts/types.js';
import type { QuerySource } from '../../packages/core/src/query/types.js';
import { twoMetricTrendFixture } from './fixtures/presentation.js';
import { attendanceDayFilter } from '../../examples/vnext/attendance/period.js';

// Synthetic employee/day observations. A scheduled day is eligible unless approved
// leave removes it; an observation missing from the complete source is unknown,
// never an absence or a zero-rate day. The host owns this policy and the rows.
const raw = [
  { id: 'ada-01', employee: 'ada', day: '2026-09-01', present: 1, eligible: 1 },
  { id: 'ben-01', employee: 'ben', day: '2026-09-01', present: 1, eligible: 1 },
  { id: 'ada-02', employee: 'ada', day: '2026-09-02', present: 1, eligible: 1 },
  { id: 'ben-02', employee: 'ben', day: '2026-09-02', present: 0, eligible: 1 },
  { id: 'ada-03', employee: 'ada', day: '2026-09-03', present: 1, eligible: 1 },
  { id: 'ben-03-leave', employee: 'ben', day: '2026-09-03', present: 0, eligible: 0 },
  // 4–5 September have no observations. 6 September is future relative to asOf.
  { id: 'ada-06-future', employee: 'ada', day: '2026-09-06', present: 1, eligible: 1 },
] as const;

// Oracle values are authored from the policy, not calculated from planner rows.
const expectedDaily = [
  { day: '2026-09-01', 'attendance.rate': 1 },
  { day: '2026-09-02', 'attendance.rate': 0.5 },
  { day: '2026-09-03', 'attendance.rate': 1 },
];
const ref = (id: string) => ({ id, revision: '1' }) as const;
const registryOutcome = createQueryFunctionRegistry({ version: '2' });
if (!registryOutcome.ok) throw new Error(JSON.stringify(registryOutcome.diagnostics));
const registry = registryOutcome.value;

const rate: MeaningDefinition = {
  id: 'attendance.rate',
  revision: '1',
  label: 'Attendance rate',
  explanation: 'Present eligible employee-days divided by eligible employee-days; approved leave is excluded.',
  output: { value: 'float', nullable: true },
  implementation: {
    kind: 'expression',
    expression: {
      kind: 'call',
      function: ref('core.ratio-of-sums.null'),
      arguments: [
        { kind: 'field', entity: 'attendance', ref: 'present' },
        { kind: 'field', entity: 'attendance', ref: 'eligible' },
      ],
    },
  },
  dependencies: [],
  functionRegistryDigest: registry.digest,
  origin: 'manual',
  lifecycle: 'active',
  scope: 'workspace',
  authority: 'approved',
  aggregation: 'ratio-of-sums',
  aggregationDimensions: [],
  missingPolicy: 'reject',
};

const catalog: Catalog = {
  version: '1',
  revision: 'attendance-catalog-1',
  functionRegistryDigest: registry.digest,
  entities: [
    {
      id: 'attendance',
      label: 'Synthetic attendance',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [
        { id: 'id', label: 'Observation', role: 'identity', type: { value: 'text', nullable: false } },
        { id: 'employee', label: 'Employee', role: 'dimension', type: { value: 'text', nullable: false } },
        {
          id: 'day',
          label: 'Local day',
          role: 'time',
          type: {
            value: 'date',
            nullable: false,
            temporal: { calendar: 'gregorian', timezone: 'Asia/Jakarta', grain: 'day' },
          },
        },
        { id: 'present', label: 'Present eligible days', role: 'measure', type: { value: 'integer', nullable: false } },
        {
          id: 'eligible',
          label: 'Eligible employee-days',
          role: 'measure',
          type: { value: 'integer', nullable: false },
        },
      ],
    },
  ],
  relationships: [],
  meanings: [rate],
  capabilities: [],
};

const period: NonNullable<QuerySpec['period']> = {
  from: '2026-09-01T00:00:00+07:00',
  toExclusive: '2026-10-01T00:00:00+07:00',
  timezone: 'Asia/Jakarta',
  calendar: 'gregorian',
  interpretation: 'September 2026, through the last complete local day as of 6 September',
};

const query: QuerySpec = {
  entity: 'attendance',
  fields: ['day'],
  measures: [ref('attendance.rate')],
  relations: [],
  groupBy: ['day'],
  population: { kind: 'all-authorized' },
  order: [{ field: 'day', direction: 'asc', nulls: 'last' }],
  timeBucket: { field: 'day', grain: 'day', calendar: 'gregorian', timezone: 'Asia/Jakarta' },
  // Host projection of the visible instant period onto supported civil days.
  where: attendanceDayFilter(period, '2026-09-06'),
};

function source(
  complete: boolean,
  rows: readonly { id: string; employee: string; day: string; present: number; eligible: number }[] = raw,
): QuerySource {
  return {
    revision: 'attendance-source-1',
    catalogRevision: catalog.revision,
    relations: { attendance: { entity: 'attendance', complete, rows } },
  };
}

function planner() {
  const outcome = createQueryPlanner({ catalog, registry });
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostics));
  return outcome.value;
}

function attendanceTrendInput(includeCount: boolean) {
  const { clarification: unusedClarification, ...base } = twoMetricTrendFixture();
  void unusedClarification;
  const fields = [
    {
      id: 'day',
      label: 'Local day',
      type: {
        value: 'date' as const,
        nullable: false,
        temporal: { calendar: 'gregorian', timezone: 'Asia/Jakarta', grain: 'day' as const },
      },
      role: 'time' as const,
    },
    { id: 'attendance.rate', label: 'Attendance rate', type: rate.output, role: 'measure' as const },
    ...(includeCount
      ? [
          {
            id: 'attendance.present',
            label: 'Present employee-days',
            type: { value: 'integer' as const, nullable: false },
            role: 'measure' as const,
          },
        ]
      : []),
  ];
  return {
    ...base,
    context: {
      ...base.context,
      task: {
        ...base.context.task,
        goal: 'Show daily attendance rate for September 2026',
        needs: [
          {
            id: 'trend',
            operation: ref('data.analyze'),
            fields: fields.map((field) => field.id),
            outputId: 'rows',
            required: true,
          },
        ],
      },
      results: [{ ...base.context.results[0]!, fields, identity: ['day'], rowGrain: ['day'] }],
    },
    ...(includeCount
      ? {
          clarification: {
            kind: 'measure' as const,
            representation: ref('data.trend'),
            diagnostic: {
              code: 'presentation.ambiguous-measure',
              message: 'Choose an attendance metric.',
              retryable: false,
            },
            choices: [
              { id: 'attendance.rate', label: 'Attendance rate' },
              { id: 'attendance.present', label: 'Present employee-days' },
            ],
          },
        }
      : {}),
  };
}

describe('J2 synthetic attendance acceptance (A17–A19)', () => {
  it('computes the approved daily rate with the visible denominator, period and timezone', () => {
    const engine = planner();
    const planned = engine.plan(query);
    expect(planned.ok, JSON.stringify(planned)).toBe(true);
    if (!planned.ok) return;
    const result = engine.evaluate(planned.value, source(true));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(period).toMatchObject({ from: '2026-09-01T00:00:00+07:00', toExclusive: '2026-10-01T00:00:00+07:00' });
    expect(query.timeBucket?.timezone).toBe('Asia/Jakarta');
    expect(rate.explanation).toContain('eligible employee-days');
    expect(result.value.rows).toEqual(expectedDaily);
  });

  it('does not invent missing or future days, or claim a partial source is complete', () => {
    const engine = planner();
    const planned = engine.plan(query);
    expect(planned.ok, JSON.stringify(planned)).toBe(true);
    if (!planned.ok) return;
    expect(engine.evaluate(planned.value, source(false))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'query.incomplete-input' }],
    });
    const complete = engine.evaluate(planned.value, source(true));
    expect(complete.ok, JSON.stringify(complete)).toBe(true);
    if (complete.ok)
      expect(complete.value.rows.map((row) => row.day)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  it('includes the first civil day and excludes the half-open month end', () => {
    const engine = planner();
    const planned = engine.plan({
      ...query,
      where: attendanceDayFilter(period, '2026-10-01'),
    });
    expect(planned.ok, JSON.stringify(planned)).toBe(true);
    if (!planned.ok) return;
    const result = engine.evaluate(
      planned.value,
      source(true, [
        { id: 'before', employee: 'Ada', day: '2026-08-31', present: 1, eligible: 1 },
        { id: 'start', employee: 'Ada', day: '2026-09-01', present: 1, eligible: 1 },
        { id: 'last', employee: 'Ada', day: '2026-09-30', present: 1, eligible: 1 },
        { id: 'end', employee: 'Ada', day: '2026-10-01', present: 1, eligible: 1 },
      ]),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        rows: [
          { day: '2026-09-01', 'attendance.rate': 1 },
          { day: '2026-09-30', 'attendance.rate': 1 },
        ],
      },
    });
  });

  it('derives query bounds from the visible period and rejects an unsupported civil-time projection', () => {
    expect(attendanceDayFilter(period, '2026-09-06')).toEqual(query.where);
    const narrower = { ...period, from: '2026-09-02T00:00:00+07:00' };
    expect(attendanceDayFilter(narrower, '2026-09-06')).toMatchObject({
      predicates: [{ value: '2026-09-02' }, { value: '2026-09-06' }],
    });
    expect(() => attendanceDayFilter({ ...period, timezone: 'America/New_York' }, '2026-09-06')).toThrow(
      'supported Jakarta civil-day period',
    );
  });

  it('keeps New York DST transition days civil, with missing and future coverage explicit', () => {
    const newYorkCatalog: Catalog = {
      ...catalog,
      entities: catalog.entities.map((entity) => ({
        ...entity,
        fields: entity.fields.map((field) =>
          field.id === 'day'
            ? {
                ...field,
                type: {
                  ...field.type,
                  temporal: { calendar: 'gregorian', timezone: 'America/New_York', grain: 'day' },
                },
              }
            : field,
        ),
      })),
    };
    const engine = createQueryPlanner({ catalog: newYorkCatalog, registry });
    expect(engine.ok, JSON.stringify(engine)).toBe(true);
    if (!engine.ok) return;
    const newYorkQuery: QuerySpec = {
      ...query,
      timeBucket: { field: 'day', grain: 'day', calendar: 'gregorian', timezone: 'America/New_York' },
      where: {
        op: 'and',
        predicates: [
          { op: 'compare', field: 'day', comparison: 'gte', value: '2026-03-08' },
          { op: 'compare', field: 'day', comparison: 'lt', value: '2026-03-11' },
        ],
      },
    };
    const planned = engine.value.plan(newYorkQuery);
    expect(planned.ok, JSON.stringify(planned)).toBe(true);
    if (!planned.ok) return;
    const rows = [
      { id: 'before', employee: 'Ada', day: '2026-03-07', present: 1, eligible: 1 },
      { id: 'spring-forward', employee: 'Ada', day: '2026-03-08', present: 1, eligible: 1 },
      { id: 'after', employee: 'Ada', day: '2026-03-09', present: 0, eligible: 1 },
      // 10 March is missing; 11 March lies beyond the exclusive upper bound.
      { id: 'future', employee: 'Ada', day: '2026-03-11', present: 1, eligible: 1 },
    ];
    expect(engine.value.evaluate(planned.value, source(false, rows))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'query.incomplete-input' }],
    });
    expect(engine.value.evaluate(planned.value, source(true, rows))).toMatchObject({
      ok: true,
      value: {
        rows: [
          { day: '2026-03-08', 'attendance.rate': 1 },
          { day: '2026-03-09', 'attendance.rate': 0 },
        ],
      },
    });
  });

  it('requires an approved meaning and preserves structured metric clarification for an ambiguous trend', () => {
    const engine = planner();
    expect(engine.plan({ ...query, measures: [ref('present')] })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'query.meaning' }],
    });
    expect(resolvePresentation(attendanceTrendInput(true))).toMatchObject({
      status: 'needs-input',
      choices: [{ id: 'attendance.present' }, { id: 'attendance.rate' }],
    });
  });

  it('selects an eligible trend when the approved rate is the sole measure', () => {
    const decision = resolvePresentation(attendanceTrendInput(false));
    expect(decision, JSON.stringify(decision)).toMatchObject({
      status: 'ready',
      receipt: { selectedCandidate: 'trend' },
    });
  });

  it('returns explicit unsupported for a local-offset or DST period the pure evaluator cannot interpret', () => {
    const engine = planner();
    expect(engine.plan({ ...query, period })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'query.unsupported', path: ['period'] }],
    });
    expect(
      engine.plan({
        ...query,
        timeBucket: { ...query.timeBucket!, timezone: 'America/New_York' },
        period: {
          from: '2026-03-08T00:00:00-05:00',
          toExclusive: '2026-03-09T00:00:00-04:00',
          timezone: 'America/New_York',
          calendar: 'gregorian',
          interpretation: 'DST transition day',
        },
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'query.unsupported', path: ['period'] }],
    });
  });
});
