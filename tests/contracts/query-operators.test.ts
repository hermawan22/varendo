import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parseContract, serializeContract, type QuerySpec } from '../../packages/core/src/index.js';
import { query } from './fixtures.js';

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(readFileSync(new URL('../../packages/core/schemas/query.schema.json', import.meta.url), 'utf8')),
);
const relation = { id: 'orders.tags', revision: '1' };

describe('explicit relation usage wire boundary', () => {
  it('roundtrips each explicit join kind and preserves opaque IDs and target predicates', () => {
    for (const kind of ['inner', 'left', 'semi'] as const) {
      const value: QuerySpec = {
        ...query,
        relations: [relation],
        relationUsage: [
          {
            relation,
            kind,
            where: { op: 'compare', field: 'target.field.with.dots', comparison: 'eq', value: 'eligible' },
          },
        ],
      };
      expect(validate(value)).toBe(true);
      const parsed = parseContract('query', value);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error('query failed');
      const serialized = serializeContract('query', parsed.value);
      expect(serialized.ok).toBe(true);
      if (!serialized.ok) throw new Error('serialization failed');
      expect(parseContract('query', serialized.value)).toEqual(parsed);
    }
    expect(parseContract('query', query).ok).toBe(true);
  });
  it('rejects missing semantics, authority injection and raw query text in both validators', () => {
    for (const usage of [
      { relation },
      { relation, kind: 'cross' },
      { relation, kind: 'semi', approved: true },
      { relation, kind: 'inner', where: 'SELECT * FROM tags' },
      { relation: { ...relation, actor: 'admin' }, kind: 'left' },
    ]) {
      const value = { ...query, relationUsage: [usage] };
      expect(parseContract('query', value).ok).toBe(false);
      expect(validate(value)).toBe(false);
    }
  });
});

it('accepts bounded window specifications and rejects unbounded or executable frames', () => {
  const window = {
    id: 'running-total',
    function: { id: 'core.window.sum', revision: '1' },
    arguments: [{ kind: 'field', entity: 'orders', ref: 'amount' }],
    partitionBy: [],
    orderBy: [],
    frame: { preceding: 2, following: 0 },
  };
  const value = { ...query, windows: [window] };
  expect(parseContract('query', value).ok).toBe(true);
  expect(validate(value)).toBe(true);
  for (const frame of [
    { preceding: -1, following: 0 },
    { preceding: 1.5, following: 0 },
    { preceding: 10001, following: 0 },
    { preceding: 'unbounded', following: 0 },
    { preceding: 1, following: 0, evaluate: 'return rows' },
  ]) {
    const bad = { ...value, windows: [{ ...window, frame }] };
    expect(parseContract('query', bad).ok).toBe(false);
    expect(validate(bad)).toBe(false);
  }
});

it('roundtrips semantic top-K separately from delivery paging and rejects malformed limits', () => {
  const input: QuerySpec = { ...query, topK: 5, page: { size: 2 } };
  expect(validate(input)).toBe(true);
  const parsed = parseContract('query', input);
  expect(parsed).toMatchObject({ ok: true, value: { topK: 5, page: { size: 2 } } });
  if (!parsed.ok) return;
  const serialized = serializeContract('query', parsed.value);
  expect(serialized.ok).toBe(true);
  if (serialized.ok) expect(parseContract('query', serialized.value)).toEqual(parsed);
  for (const topK of [0, -1, 1.5, 10001, '5', { count: 5 }, undefined]) {
    expect(parseContract('query', { ...query, topK }).ok).toBe(false);
    if (topK !== undefined) expect(validate({ ...query, topK })).toBe(false);
  }
});

it('roundtrips an explicit weekly policy and bounds week start before planning', () => {
  const input = {
    ...query,
    timeBucket: { field: 'day', grain: 'week', calendar: 'iso8601', timezone: 'Asia/Jakarta', weekStartsOn: 1 },
  };
  expect(validate(input)).toBe(true);
  expect(parseContract('query', input)).toMatchObject({ ok: true, value: { timeBucket: input.timeBucket } });
  for (const weekStartsOn of [-1, 7, 0.5, 'Monday', undefined]) {
    expect(parseContract('query', { ...input, timeBucket: { ...input.timeBucket, weekStartsOn } }).ok).toBe(false);
  }
});
