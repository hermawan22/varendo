import { describe, expect, it, vi } from 'vitest';
import { createLocalDataService } from '../../packages/runtime/src/data/local.js';
import type { Catalog, QuerySpec } from '../../packages/core/src/index.js';
import type { DataRecord, QueryBudget } from '../../packages/runtime/src/data/types.js';

const budget: QueryBudget = { maxRows: 100, maxBytes: 100_000, maxColumns: 10, maxMessages: 10, maxMilliseconds: 2000 };
function catalog(identityType: 'text' | 'float' | 'instant' = 'text'): Catalog {
  return {
    version: '1',
    revision: 'catalog-1',
    functionRegistryDigest: 'core-standard-1',
    entities: [
      {
        id: 'events',
        label: 'Events',
        identity: ['id'],
        rowGrain: ['id'],
        fields: [
          { id: 'id', label: 'ID', type: { value: identityType, nullable: false }, role: 'identity' },
          { id: 'at', label: 'Time', type: { value: 'instant', nullable: false }, role: 'time' },
        ],
      },
    ],
    relationships: [],
    capabilities: [],
    meanings: [],
  };
}
const snapshot = (records: readonly DataRecord[], identityType: 'text' | 'float' | 'instant' = 'text') => ({
  catalog: catalog(identityType),
  sourceRevision: 'source-1',
  records: { events: records },
});
async function resultRows(records: readonly DataRecord[], where?: QuerySpec['where']) {
  const service = createLocalDataService({ snapshot: snapshot(records) });
  const query: QuerySpec = {
    entity: 'events',
    fields: ['id', 'at'],
    measures: [],
    relations: [],
    groupBy: [],
    population: { kind: 'all-authorized' },
    order: [{ field: 'at', direction: 'asc', nulls: 'last' }],
    ...(where ? { where } : {}),
  };
  const planned = await service.plan({
    version: '1',
    requestId: 'request-1',
    target: { taskId: 'request-1', outputId: 'events' },
    catalogRevision: 'catalog-1',
    query,
    budget,
  });
  expect(planned.ok).toBe(true);
  if (!planned.ok) throw new Error(planned.diagnostics[0].code);
  const ids: unknown[] = [];
  const kinds: string[] = [];
  for await (const event of service.execute(planned.value)) {
    kinds.push(event.kind);
    if (event.kind === 'batch') ids.push(...event.rows.map((row) => row.id));
  }
  expect(kinds.at(-1)).toBe('complete');
  return ids;
}

describe('local source bounds and exact instant comparisons', () => {
  it('orders sub-millisecond values without converting their fractions to floating point', async () => {
    const values = [
      { id: 'later', at: '1970-01-01T00:00:00.0000000000000000002Z' },
      { id: 'earlier', at: '1970-01-01T00:00:00.0000000000000000001Z' },
      { id: 'previous-second', at: '1969-12-31T23:59:59.9999999999999999999Z' },
      { id: 'one-hundredth', at: '1970-01-01T00:00:00.01Z' },
      { id: 'one-tenth', at: '1970-01-01T00:00:00.1Z' },
    ];
    expect(await resultRows(values)).toEqual(['previous-second', 'earlier', 'later', 'one-hundredth', 'one-tenth']);
    expect(
      await resultRows(values, { op: 'compare', field: 'at', comparison: 'eq', value: '1970-01-01T00:00:00.10Z' }),
    ).toEqual(['one-tenth']);
    expect(
      await resultRows(values, {
        op: 'compare',
        field: 'at',
        comparison: 'lt',
        value: '1970-01-01T00:00:00.0000000000000000002Z',
      }),
    ).toEqual(['previous-second', 'earlier']);
  });
  it('handles offset/year boundaries without the Date.UTC 0-99 year remapping', async () => {
    const values = [
      { id: 'ninety-nine', at: '0099-01-01T00:00:00Z' },
      { id: 'zero', at: '0000-01-01T00:00:00Z' },
      { id: 'modern', at: '2000-01-01T00:00:00.10Z' },
    ];
    expect(await resultRows(values)).toEqual(['zero', 'ninety-nine', 'modern']);
    expect(
      await resultRows(values, { op: 'compare', field: 'at', comparison: 'eq', value: '1999-12-31T19:00:00.1-05:00' }),
    ).toEqual(['modern']);
  });
  it.each([
    '2023-02-30T00:00:00Z',
    '2023-02-29T00:00:00Z',
    '2024-01-01T24:00:00Z',
    '2024-01-01T00:00:00+24:00',
    '2024-01-01T00:00:60Z',
  ])('rejects invalid instant %s', (value) => {
    expect(() => createLocalDataService({ snapshot: snapshot([{ id: 'one', at: value }]) })).toThrow();
  });
  it('treats equivalent instant and zero identities as duplicates', () => {
    const at = '2000-01-01T00:00:00Z';
    expect(() =>
      createLocalDataService({
        snapshot: snapshot(
          [
            { id: '2000-01-01T00:00:00.10Z', at },
            { id: '1999-12-31T19:00:00.1-05:00', at },
          ],
          'instant',
        ),
      }),
    ).toThrow(/duplicate identity/);
    expect(() =>
      createLocalDataService({
        snapshot: snapshot(
          [
            { id: -0, at },
            { id: 0, at },
          ],
          'float',
        ),
      }),
    ).toThrow(/duplicate identity/);
  });
  it('enforces exact UTF-8 JSON source bytes including punctuation and escapes', () => {
    const input = snapshot([{ id: '河"', at: '2000-01-01T00:00:00Z' }]);
    const bytes = new TextEncoder().encode(JSON.stringify(input.records)).byteLength;
    expect(() => createLocalDataService({ snapshot: input, sourceLimits: { rows: 1, bytes } })).not.toThrow();
    expect(() => createLocalDataService({ snapshot: input, sourceLimits: { rows: 1, bytes: bytes - 1 } })).toThrow(
      /byte limit/,
    );
    expect(() =>
      createLocalDataService({ snapshot: { ...input, records: {} }, sourceLimits: { rows: 1, bytes: 1 } }),
    ).toThrow(/byte limit/);
  });
  it('does not serialize whole source rows or invoke their toJSON hooks', () => {
    const row = { id: 'one', at: '2000-01-01T00:00:00Z' };
    const hook = vi.fn(() => {
      throw new Error('Whole-row serialization invoked');
    });
    Object.defineProperty(row, 'toJSON', { value: hook });
    expect(() => createLocalDataService({ snapshot: snapshot([row]) })).not.toThrow();
    expect(hook).not.toHaveBeenCalled();
  });
  it('rejects sparse source arrays and identifiers that cannot appear in wire records', () => {
    const sparse: DataRecord[] = new Array(1);
    expect(() => createLocalDataService({ snapshot: snapshot(sparse) })).toThrow(/plain object/);
    const unsupported = catalog();
    const entity = unsupported.entities[0]!;
    const prototypeCatalog: Catalog = { ...unsupported, entities: [{ ...entity, id: '__proto__' }] };
    expect(() =>
      createLocalDataService({ snapshot: { catalog: prototypeCatalog, sourceRevision: 'source-1', records: {} } }),
    ).toThrow(/wire record keys/);
  });
  it('allows explicit larger host limits while retaining the conservative defaults', () => {
    const records = Array.from({ length: 10_001 }, (_, index) => ({ id: String(index), at: '2000-01-01T00:00:00Z' }));
    expect(() => createLocalDataService({ snapshot: snapshot(records) })).toThrow(/row limit/);
    expect(() =>
      createLocalDataService({ snapshot: snapshot(records), sourceLimits: { rows: 10_001, bytes: 1_000_000 } }),
    ).not.toThrow();
  });
});
