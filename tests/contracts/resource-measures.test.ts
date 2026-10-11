import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { compileIntent, defineResource, validateResource } from '../../packages/core/src/app/index.js';

const schema = z.object({
  id: z.string(),
  team: z.string(),
  month: z.iso.date(),
  salary: z.number(),
  headcount: z.number().int(),
});

function people(measures: Parameters<typeof defineResource<typeof schema>>[0]['measures']) {
  return validateResource({
    id: 'people',
    revision: 'people-1',
    label: 'People',
    identity: ['id'],
    schema,
    fields: { team: { role: 'dimension' }, month: { role: 'time' } },
    ...(measures === undefined ? {} : { measures }),
    presentation: { allowedViews: ['table', 'trend'] },
  });
}

describe('resource measures', () => {
  it('expands a count measure into a reviewed, additive meaning over the identity field', () => {
    const resource = defineResource({
      id: 'people',
      revision: 'people-1',
      label: 'People',
      identity: ['id'],
      schema,
      measures: { hires: { label: 'New hires', aggregate: 'count' } },
      presentation: { allowedViews: ['table'] },
    });
    expect(resource.catalog.meanings).toEqual([
      {
        id: 'hires',
        revision: '1',
        label: 'New hires',
        explanation: 'New hires',
        output: { value: 'integer', nullable: false },
        implementation: {
          kind: 'expression',
          expression: {
            kind: 'call',
            function: { id: 'core.aggregate.count', revision: '1' },
            arguments: [{ kind: 'field', ref: 'id' }],
          },
        },
        dependencies: [],
        functionRegistryDigest: 'core-query-2',
        origin: 'manual',
        lifecycle: 'active',
        scope: 'workspace',
        authority: 'approved',
        aggregation: 'additive',
        aggregationDimensions: [],
        missingPolicy: 'reject',
      },
    ]);
  });

  it('derives a sum output type from the schema and records semi-additive dimensions', () => {
    const outcome = people({
      payroll: { label: 'Payroll', aggregate: 'sum', field: 'salary', goal: 'minimize', explanation: 'Total salary.' },
      headcount: { label: 'Headcount', aggregate: 'sum', field: 'headcount', semiAdditiveOver: ['month'] },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const [payroll, headcount] = outcome.value.catalog.meanings;
    expect(payroll).toMatchObject({
      output: { value: 'float', nullable: false },
      aggregation: 'additive',
      goal: 'minimize',
      explanation: 'Total salary.',
    });
    expect(headcount).toMatchObject({
      output: { value: 'integer', nullable: false },
      aggregation: 'semi-additive',
      aggregationDimensions: ['month'],
    });
  });

  it('compiles an analyze intent that references a declared measure', () => {
    const outcome = people({ hires: { label: 'New hires', aggregate: 'count-distinct', field: 'id' } });
    if (!outcome.ok) throw new Error(outcome.diagnostics[0].message);
    expect(outcome.value.catalog.meanings[0]?.aggregation).toBe('non-additive');
    const task = compileIntent(
      {
        version: '1',
        id: 'hires-by-team',
        kind: 'analyze',
        resource: 'people',
        dimensions: ['team'],
        measures: [{ id: 'hires', revision: '1' }],
      },
      { resource: outcome.value, regionId: 'main' },
    );
    expect(task.ok).toBe(true);
  });

  it.each([
    [{ total: { label: 'Total', aggregate: 'sum' } }, ['measures', 'total', 'field']],
    [{ total: { label: 'Total', aggregate: 'sum', field: 'team' } }, ['measures', 'total', 'field']],
    [{ total: { label: 'Total', aggregate: 'count', field: 'missing' } }, ['measures', 'total', 'field']],
    [
      { total: { label: 'Total', aggregate: 'count', semiAdditiveOver: ['month'] } },
      ['measures', 'total', 'semiAdditiveOver'],
    ],
    [
      { total: { label: 'Total', aggregate: 'sum', field: 'headcount', semiAdditiveOver: ['nope'] } },
      ['measures', 'total', 'semiAdditiveOver', 0],
    ],
    [{ 'not an id': { label: 'Total', aggregate: 'count' } }, ['measures', 'not an id']],
  ] as const)('rejects an invalid measure %j', (measures, path) => {
    const outcome = people(measures as never);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.diagnostics[0]?.code).toBe('resource.measure');
    expect(outcome.diagnostics[0]?.path).toEqual(path);
  });

  it('rejects a measure whose ID collides with a declared meaning', () => {
    const base = defineResource({
      id: 'people',
      revision: 'people-1',
      label: 'People',
      identity: ['id'],
      schema,
      measures: { hires: { label: 'New hires', aggregate: 'count' } },
      presentation: { allowedViews: ['table'] },
    });
    const outcome = validateResource({
      id: 'people',
      revision: 'people-1',
      label: 'People',
      identity: ['id'],
      schema,
      meanings: base.catalog.meanings,
      measures: { hires: { label: 'Again', aggregate: 'count' } },
      presentation: { allowedViews: ['table'] },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.diagnostics[0]?.path).toEqual(['measures', 'hires']);
  });
});
