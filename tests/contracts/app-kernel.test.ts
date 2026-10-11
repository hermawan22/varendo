import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { compileIntent, defineResource, parseIntent, type Task } from '../../packages/core/src/index.js';
import { createIntentCompilerRegistry, ResourceDefinitionError } from '../../packages/core/src/app/index.js';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import { createQueryPlanner } from '../../packages/core/src/query/index.js';

const people = defineResource({
  id: 'people',
  label: 'People',
  revision: 'people-1',
  identity: ['id'],
  schema: z.object({
    id: z.string(),
    name: z.string(),
    team: z.enum(['Platform', 'Research']),
    joinedAt: z.iso.date().nullable(),
  }),
  fields: {
    name: { label: 'Name' },
    team: { label: 'Team', role: 'dimension' },
    joinedAt: { label: 'Joined', role: 'time' },
  },
  presentation: {
    allowedViews: ['table', 'cards', 'detail'],
    preferred: { browse: 'table', detail: 'detail' },
  },
});

const absences = defineResource({
  id: 'absences',
  label: 'Absence history',
  revision: 'absences-1',
  identity: ['id'],
  rowGrain: ['person', 'week'],
  schema: z.object({ id: z.string(), person: z.string(), week: z.iso.date(), absenceDays: z.number().int() }),
  fields: { person: { role: 'dimension' }, week: { role: 'time' }, absenceDays: { role: 'measure' } },
  meanings: [
    {
      id: 'absence-days-total',
      revision: '1',
      label: 'Total absence days',
      explanation: 'Sum of absence days.',
      output: { value: 'integer', nullable: true },
      implementation: {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: { id: 'core.aggregate.sum', revision: '1' },
          arguments: [{ kind: 'field', ref: 'absenceDays' }],
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
      missingPolicy: 'exclude-pair',
    },
  ],
  presentation: { allowedViews: ['table', 'trend'] },
});

describe('0.3 resource definitions', () => {
  it('derives a Catalog and retains semantic metadata without treating numbers as measures', () => {
    expect(people.catalog.entities).toHaveLength(1);
    expect(people.entity.identity).toEqual(['id']);
    expect(people.entity.fields.find((field) => field.id === 'team')).toMatchObject({ role: 'dimension' });
    expect(people.entity.fields.find((field) => field.id === 'joinedAt')).toMatchObject({
      role: 'time',
      type: { value: 'date', nullable: true, temporal: { calendar: 'gregorian', timezone: 'UTC', grain: 'day' } },
    });
    expect(people.fieldMetadata.team?.values).toEqual(['Platform', 'Research']);
    expect(people.parseRecord({ id: 'p1', name: 'Ada', team: 'Platform', joinedAt: null }).ok).toBe(true);
    expect(people.parseRecord({ id: 'p1', name: 7, team: 'Platform', joinedAt: null }).ok).toBe(false);
  });

  it('rejects optional/missing row fields instead of pretending they are nullable', () => {
    expect(() =>
      defineResource({
        id: 'bad',
        label: 'Bad',
        revision: '1',
        identity: ['id'],
        schema: z.object({ id: z.string(), name: z.string().optional() }),
        presentation: { allowedViews: ['table'] },
      }),
    ).toThrow(ResourceDefinitionError);
    try {
      defineResource({
        id: 'bad',
        label: 'Bad',
        revision: '1',
        identity: ['id'],
        schema: z.object({ id: z.string(), name: z.string().optional() }),
        presentation: { allowedViews: ['table'] },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceDefinitionError);
      expect((error as ResourceDefinitionError).diagnostics[0].code).toBe('resource.optional-field');
    }
  });

  it('rejects malformed closed values without throwing across the authoring boundary', () => {
    expect(() =>
      defineResource({
        id: 'unsafe-values',
        label: 'Unsafe values',
        revision: '1',
        identity: ['id'],
        schema: z.object({ id: z.string(), state: z.string() }),
        fields: { state: { values: [1n] as never } },
        presentation: { allowedViews: ['table'] },
      }),
    ).toThrowError(
      expect.objectContaining({ diagnostics: [expect.objectContaining({ code: 'resource.field-values' })] }),
    );
  });
});

describe('0.3 intent compiler', () => {
  it('parses and compiles browse with bounded search into one ordinary Task', () => {
    const intent = {
      version: '1',
      id: 'browse-people',
      resource: 'people',
      kind: 'browse',
      fields: ['id', 'name', 'team'],
      search: { text: 'platform', fields: ['name', 'team'] },
      sort: [{ field: 'name', direction: 'asc' }],
    } as const;
    expect(parseIntent(intent).ok).toBe(true);
    const compiled = compileIntent(intent, { resource: people, regionId: 'main' });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok || compiled.value.kind !== 'data') return;
    expect(compiled.value.viewPreference).toEqual({ representation: 'table', strength: 'preferred' });
    expect(compiled.value.outputs[0]?.kind).toBe('query');
    if (compiled.value.outputs[0]?.kind !== 'query') return;
    expect(compiled.value.outputs[0].query.search).toEqual({ text: 'platform', fields: ['name', 'team'] });
  });

  it('lowers search through the normal query planner and evaluates case-insensitively', () => {
    const registry = createQueryFunctionRegistry({ version: '2' });
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const planner = createQueryPlanner({ catalog: people.catalog, registry: registry.value });
    expect(planner.ok).toBe(true);
    if (!planner.ok) return;
    const plan = planner.value.plan({
      entity: 'people',
      fields: ['id', 'name', 'team'],
      measures: [],
      relations: [],
      groupBy: [],
      search: { text: 'PLATFORM', fields: ['team'] },
      population: { kind: 'all-authorized' },
      order: [],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const result = planner.value.evaluate(plan.value, {
      revision: 'rows-1',
      relations: {
        people: {
          entity: 'people',
          complete: true,
          rows: [
            { id: 'p1', name: 'Ada', team: 'Platform', joinedAt: null },
            { id: 'p2', name: 'Grace', team: 'Research', joinedAt: null },
          ],
        },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rows).toEqual([{ id: 'p1', name: 'Ada', team: 'Platform' }]);
  });

  it('rejects unknown resource, identity, view, and custom compiler output pins', () => {
    expect(
      compileIntent(
        { version: '1', id: 'x', resource: 'other', kind: 'browse' },
        { resource: people, regionId: 'main' },
      ),
    ).toMatchObject({ ok: false });
    expect(
      compileIntent(
        { version: '1', id: 'x', resource: 'people', kind: 'detail', identity: { wrong: 'p1' } },
        { resource: people, regionId: 'main' },
      ),
    ).toMatchObject({ ok: false });
    expect(
      compileIntent(
        { version: '1', id: 'x', resource: 'people', kind: 'browse', preferredView: 'raw-html' },
        { resource: people, regionId: 'main' },
      ),
    ).toMatchObject({ ok: false });

    const registry = createIntentCompilerRegistry([
      {
        ref: { id: 'example.board', revision: '1' },
        schema: z.object({ group: z.string() }),
        capabilities: ['data.browse'],
        compile: (_input, context) => ({
          ok: true,
          value: {
            version: '1',
            id: 'custom',
            revision: '1',
            catalogRevision: 'wrong',
            functionRegistryDigest: context.resource.catalog.functionRegistryDigest,
            regionId: context.regionId,
            kind: 'presentation',
            goal: 'Board',
            needs: [],
            assumptions: [],
            inputs: [],
          } satisfies Task,
        }),
      },
    ]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    expect(
      compileIntent(
        {
          version: '1',
          id: 'x',
          resource: 'people',
          kind: 'custom',
          intent: { id: 'example.board', revision: '1' },
          input: { group: 'team' },
        },
        { resource: people, regionId: 'main', customIntents: registry.value },
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'intent.compiler-stale' }] });
  });

  it('rejects filter values outside a declared closed domain before data evaluation', () => {
    const rejected = compileIntent(
      {
        version: '1',
        id: 'browse-team',
        resource: 'people',
        kind: 'browse',
        filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'platform' },
      },
      { resource: people, regionId: 'main' },
    );
    expect(rejected).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'intent.unknown-filter-value', path: ['filter', 'value'] }],
    });

    const accepted = compileIntent(
      {
        version: '1',
        id: 'browse-team',
        resource: 'people',
        kind: 'browse',
        filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Platform' },
      },
      { resource: people, regionId: 'main' },
    );
    expect(accepted.ok).toBe(true);
  });

  it('adds the requested temporal field to analyze dimensions without duplicate intent wiring', () => {
    const compiled = compileIntent(
      {
        version: '1',
        id: 'absence-trend',
        resource: 'absences',
        kind: 'analyze',
        measures: [{ id: 'absence-days-total', revision: '1' }],
        time: { field: 'week', grain: 'week' },
        preferredView: 'trend',
      },
      { resource: absences, regionId: 'main' },
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok || compiled.value.kind !== 'data' || compiled.value.outputs[0]?.kind !== 'query') return;
    expect(compiled.value.outputs[0].query).toMatchObject({
      fields: ['week'],
      groupBy: ['week'],
      timeBucket: { field: 'week', grain: 'week' },
    });
  });
});
