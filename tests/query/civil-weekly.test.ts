import { describe, expect, it } from 'vitest';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import { createQueryPlanner } from '../../packages/core/src/query/index.js';
import type { Catalog, QuerySpec, SemanticType } from '../../packages/core/src/contracts/types.js';
import type { QuerySource } from '../../packages/core/src/query/types.js';

function fixture(timezone = 'Asia/Jakarta', value: SemanticType['value'] = 'date') {
  const registry = createQueryFunctionRegistry({ version: '2' });
  if (!registry.ok) throw new Error('Missing registry');
  const calendar = value === 'date' ? 'iso8601' : 'gregorian';
  const catalog: Catalog = {
    version: '1',
    revision: 'civil-weeks',
    functionRegistryDigest: registry.value.digest,
    entities: [
      {
        id: 'events',
        label: 'Events',
        identity: ['id'],
        rowGrain: ['id'],
        fields: [
          { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
          {
            id: 'day',
            label: 'Day',
            role: 'time',
            type: { value, nullable: false, temporal: { calendar, timezone, grain: 'day' } },
          },
        ],
      },
    ],
    meanings: [],
    relationships: [],
    capabilities: [],
  };
  const planner = createQueryPlanner({ catalog, registry: registry.value });
  if (!planner.ok) throw new Error(JSON.stringify(planner.diagnostics));
  const query: QuerySpec = {
    entity: 'events',
    fields: ['day'],
    measures: [],
    relations: [],
    groupBy: ['day'],
    population: { kind: 'all-authorized' },
    order: [{ field: 'day', direction: 'asc', nulls: 'last' }],
    timeBucket: { field: 'day', grain: 'week', calendar, timezone, weekStartsOn: 1 },
  };
  const source: QuerySource = {
    revision: 'source-1',
    relations: {
      events: {
        entity: 'events',
        complete: true,
        rows: [
          { id: 'a', day: value === 'date' ? '2026-01-04' : '2026-01-04T23:30:00Z' },
          { id: 'b', day: value === 'date' ? '2026-01-05' : '2026-01-05T00:30:00Z' },
          { id: 'c', day: value === 'date' ? '2026-01-11' : '2026-01-11T10:00:00Z' },
        ],
      },
    },
  };
  return { planner: planner.value, query, source };
}

describe('explicit civil weekly query policy', () => {
  it.each(['Asia/Jakarta', 'America/New_York'])(
    'buckets local calendar dates without treating them as instants in %s',
    (timezone) => {
      const { planner, query, source } = fixture(timezone);
      const plan = planner.plan(query);
      expect(plan.ok, JSON.stringify(plan)).toBe(true);
      if (!plan.ok) throw new Error(JSON.stringify(plan.diagnostics));
      const result = planner.evaluate(plan.value, source);
      expect(result).toMatchObject({
        ok: true,
        value: {
          rows: [{ day: '2025-12-29' }, { day: '2026-01-05' }],
          schema: {
            grain: ['day'],
            fields: [
              { id: 'day', type: { value: 'date', temporal: { calendar: 'iso8601', timezone, grain: 'week' } } },
            ],
          },
        },
      });
    },
  );
  it('filters ISO8601 civil dates using the source calendar before bucketing', () => {
    const { planner, query, source } = fixture();
    const plan = planner.plan({
      ...query,
      where: { op: 'compare', field: 'day', comparison: 'gte', value: '2026-01-05' },
    });
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    expect(planner.evaluate(plan.value, source)).toMatchObject({ ok: true, value: { rows: [{ day: '2026-01-05' }] } });
    expect(
      planner.plan({ ...query, where: { op: 'compare', field: 'day', comparison: 'gte', value: '2026-02-30' } }).ok,
    ).toBe(false);
  });
  it('requires explicit week start and coherent source/calendar/timezone policy', () => {
    const { planner, query } = fixture();
    expect(
      planner.plan({
        ...query,
        timeBucket: { field: 'day', grain: 'week', calendar: 'iso8601', timezone: 'Asia/Jakarta' },
      }).ok,
    ).toBe(false);
    for (const patch of [
      { weekStartsOn: 0 as const },
      { timezone: 'Not/AZone' },
      { calendar: 'buddhist' },
      { timezone: 'UTC' },
      { calendar: 'gregorian' },
    ])
      expect(planner.plan({ ...query, timeBucket: { ...query.timeBucket!, ...patch } }).ok).toBe(false);
    expect(planner.plan({ ...query, timeBucket: { field: 'day', grain: 'week' } }).ok).toBe(false);
  });
  it('keeps instant conversion bounded to the implemented Gregorian UTC path', () => {
    const { planner, query, source } = fixture('UTC', 'instant');
    const plan = planner.plan(query);
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok) return;
    expect(planner.evaluate(plan.value, source)).toMatchObject({
      ok: true,
      value: { rows: [{ day: '2025-12-29' }, { day: '2026-01-05' }] },
    });
    expect(
      planner.plan({ ...query, timeBucket: { ...query.timeBucket!, timezone: 'America/New_York' } }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'query.unsupported' }] });
  });
  it('reports an unsupported New York instant period across the spring DST boundary', () => {
    const { planner, query } = fixture('America/New_York', 'instant');
    expect(
      planner.plan({
        ...query,
        period: {
          from: '2026-03-08T00:00:00-05:00',
          toExclusive: '2026-03-09T00:00:00-04:00',
          calendar: 'gregorian',
          timezone: 'America/New_York',
          interpretation: 'New York spring transition day',
        },
      }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'query.unsupported', path: ['period'] }] });
  });
});
