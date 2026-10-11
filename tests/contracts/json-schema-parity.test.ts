import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parseContract, type ContractKind } from '../../packages/core/src/index.js';
import * as fixtures from './fixtures.js';

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const cases: Record<ContractKind, unknown> = {
  ...fixtures.familyFixtures,
  'visualization-spec': { version: '1', view: 'matrix', result: fixtures.ref, columns: ['employee.id'] },
  'plot-spec': {
    version: '1',
    root: {
      kind: 'unit',
      mark: 'point',
      result: fixtures.ref,
      encoding: { x: { field: 'x', scale: 'linear' }, y: { field: 'y', scale: 'linear' } },
      missing: 'gap',
    },
  },
  expression: fixtures.expression,
  query: fixtures.query,
  intent: { version: '1', id: 'browse-people', resource: 'employees', kind: 'browse', fields: ['employee.id'] },
  interaction: fixtures.interaction,
  'result-event': fixtures.resultEvents.batch,
  environment: fixtures.environment,
  'presentation-plan': fixtures.presentationPlan,
  'task-proposal': fixtures.taskProposal,
  'meaning-draft': fixtures.meaningDraft,
  'binding-outcome': fixtures.bindingOutcome,
  'model-evaluation': fixtures.modelEvaluation,
  'operation-grant': 'task.propose',
  'agent-stop-reason': 'no-progress',
  'agent-loop-budget': { maxTurns: 8, maxRepairs: 2, maxMilliseconds: 1000, maxProposalBytes: 4096 },
  'narrative-claim': {
    version: '1',
    id: 'claim',
    kind: 'value',
    cell: {
      result: fixtures.ref,
      field: 'amount',
      identity: { 'employee.id': 'e1' },
      type: { value: 'decimal', nullable: false },
      populationDigest: 'cohort',
      filters: [],
    },
    value: { decimal: '1.25' },
  },
};

describe('independent JSON Schema validation parity', () => {
  for (const [kind, fixture] of Object.entries(cases) as [ContractKind, unknown][]) {
    it(`${kind}: accepts its fixture and rejects field/type mutations`, () => {
      const schema = JSON.parse(
        readFileSync(new URL(`../../packages/core/schemas/${kind}.schema.json`, import.meta.url), 'utf8'),
      );
      const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
      const variants = [fixture, null, [], 7, { ...(fixture as object), unknownField: true }];
      for (const key of Object.keys(typeof fixture === 'object' && fixture !== null ? fixture : {})) {
        variants.push({ ...(fixture as object), [key]: null });
        const absent = { ...(fixture as Record<string, unknown>) };
        delete absent[key];
        variants.push(absent);
      }
      expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
      for (const input of variants) {
        expect(Boolean(validate(input)), `${kind}: ${JSON.stringify(input)}`).toBe(
          parseContract(kind, typeof input === 'string' ? JSON.stringify(input) : input).ok,
        );
      }
      const pending: { value: unknown; path: (string | number)[] }[] = [{ value: fixture, path: [] }];
      while (pending.length) {
        const { value, path } = pending.pop()!;
        if (path.length) {
          for (const replacement of [null, false, 'wrong-shape', [], {}]) {
            const input = structuredClone(fixture) as any;
            let parent = input;
            for (const part of path.slice(0, -1)) parent = parent[part];
            parent[path.at(-1)!] = replacement;
            expect(Boolean(validate(input)), `${kind}.${path.join('.')}: ${JSON.stringify(replacement)}`).toBe(
              parseContract(kind, typeof input === 'string' ? JSON.stringify(input) : input).ok,
            );
          }
        }
        if (value !== null && typeof value === 'object') {
          for (const [key, child] of Object.entries(value)) {
            pending.push({ value: child, path: [...path, Array.isArray(value) ? Number(key) : key] });
          }
        }
      }
    });
  }
  it('enforces generic JSON key, string, array and object bounds', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../../packages/core/schemas/interaction.schema.json', import.meta.url), 'utf8'),
    );
    const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
    for (const value of [
      { ['x'.repeat(161)]: true },
      JSON.parse('{"__proto__":true}'),
      'x'.repeat(16385),
      Array(10001).fill(null),
      Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`k${i}`, null])),
    ]) {
      const input = {
        ...fixtures.interaction,
        payload: { kind: 'extension', schema: { id: 'extension', revision: '1' }, value },
      };
      expect(validate(input)).toBe(false);
      expect(parseContract('interaction', input).ok).toBe(false);
    }
  });
  it('counts Unicode field limits consistently', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../../packages/core/schemas/catalog.schema.json', import.meta.url), 'utf8'),
    );
    const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
    for (const length of [3000, 4096, 4097]) {
      const input = structuredClone(fixtures.catalog) as any;
      input.entities[0].label = '🙂'.repeat(length);
      expect(validate(input)).toBe(length <= 4096);
      expect(parseContract('catalog', input).ok).toBe(length <= 4096);
    }
  });
  it('preserves the optional entity qualifier in generated expression schemas', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../../packages/core/schemas/expression.schema.json', import.meta.url), 'utf8'),
    );
    const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
    for (const entity of ['employees', 'departments', 7, null]) {
      const input = { kind: 'field', ref: 'name', entity };
      expect(validate(input)).toBe(typeof entity === 'string');
      expect(parseContract('expression', input).ok).toBe(typeof entity === 'string');
    }
  });
  it('validates optional timestamp fields consistently without inferring an interval', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../../packages/core/schemas/query.schema.json', import.meta.url), 'utf8'),
    );
    const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
    for (const [from, valid] of [
      ['2026-01-01T12:34:56Z', true],
      ['2026-01-01T12:34:56+05:00', true],
      ['2026-01-01T12:34Z', false],
      ['2026-02-30T00:00:00Z', false],
      ['2026-01-01T12:34:56+24:00', false],
      ['2026-01-01T12:34:60Z', false],
    ] as const) {
      const input = {
        ...fixtures.query,
        period: {
          from,
          toExclusive: '2026-02-01T00:00:00Z',
          calendar: 'iso8601',
          timezone: 'UTC',
          interpretation: 'Explicit interval',
        },
      };
      expect(validate(input)).toBe(valid);
      expect(parseContract('query', input).ok).toBe(valid);
    }
  });
});
