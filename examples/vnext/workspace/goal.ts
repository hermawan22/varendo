import { z } from 'zod';
import { type PresentationPlan, type QuerySpec, type ResultRef, type Task } from '@varendo/core';
import { createIntentCompilerRegistry } from '@varendo/core/app';
import { defineDataFeature } from '@varendo/core/features';
import type { PresentationPatternManifest } from '@varendo/core/presentation';

export const REGION = 'attendance-workspace';
export const GOAL = { id: 'attendance.overview', revision: '1' } as const;
export const PATTERN = { id: 'attendance.overview-pattern', revision: '1' } as const;
export const METRIC = { id: 'attendance.present-total', revision: '1' } as const;
const ANALYZE = { id: 'data.analyze', revision: '1' } as const;
const READ = { id: 'data.read', revision: '1' } as const;
export const ROLES = ['summary', 'trend', 'breakdown'] as const;
export const REF = {
  workspace: { id: 'layout.stack', revision: '1' },
  summary: { id: 'data.metric', revision: '1' },
  trend: { id: 'data.trend', revision: '1' },
  breakdown: { id: 'data.table', revision: '1' },
} as const;

export const feature = defineDataFeature({
  id: 'attendance',
  presentation: { allowedViews: ['table', 'trend', 'data.metric'] },
  schema: z.object({
    id: z.string(),
    employee: z.string(),
    day: z.iso.date(),
    team: z.string(),
    present: z.number().int(),
  }),
  identity: ['id'],
  fields: {
    employee: { role: 'dimension' },
    day: { role: 'time' },
    team: { role: 'dimension' },
    present: { role: 'measure' },
  },
  meanings: [
    {
      ...METRIC,
      label: 'Present employees',
      explanation: 'Sum of registered present observations.',
      output: { value: 'integer', nullable: false, grain: [] },
      implementation: {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: { id: 'core.aggregate.sum', revision: '1' },
          arguments: [{ kind: 'field', ref: 'present' }],
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
  ],
});

function query(groupBy: readonly string[]): QuerySpec {
  return {
    entity: feature.entity.id,
    fields: groupBy,
    measures: [METRIC],
    relations: [],
    groupBy,
    population: { kind: 'all-authorized' },
    where: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
    order: [],
  };
}

function groupFor(role: (typeof ROLES)[number]): string {
  if (role === 'trend') return 'day';
  if (role === 'breakdown') return 'employee';
  return 'team';
}

function presentationRole(role: (typeof ROLES)[number]): 'metric' | 'trend' | 'table' {
  if (role === 'summary') return 'metric';
  if (role === 'breakdown') return 'table';
  return 'trend';
}

function configFor(role: (typeof ROLES)[number]) {
  if (role === 'summary') return { field: METRIC.id, identityValues: { team: 'Engineering' } };
  if (role === 'trend') return { labelField: 'day', series: [{ field: METRIC.id }] };
  return {};
}

export function goalRegistry() {
  const registered = createIntentCompilerRegistry([
    {
      ref: GOAL,
      schema: z.object({ team: z.literal('Engineering') }),
      capabilities: ['data.read', 'data.analyze'],
      compile(_input, context) {
        const output = (role: (typeof ROLES)[number]) => ({
          id: role,
          kind: 'query' as const,
          query: query([groupFor(role)]),
          dependsOn: [],
          delivery: 'eager' as const,
        });
        const task: Task = {
          version: '1',
          id: 'attendance-overview-task',
          revision: context.taskRevision,
          catalogRevision: context.resource.catalog.revision,
          functionRegistryDigest: context.resource.catalog.functionRegistryDigest,
          regionId: context.regionId,
          kind: 'data',
          goal: 'Engineering attendance overview',
          assumptions: [],
          outputs: [output('summary'), output('trend'), output('breakdown')],
          needs: ROLES.map((role) => ({
            id: role,
            operation: role === 'summary' ? READ : ANALYZE,
            outputId: role,
            fields: role === 'summary' ? [METRIC.id] : [role === 'trend' ? 'day' : 'employee', METRIC.id],
            required: true,
            simultaneousGroup: 'overview',
          })),
        };
        return { ok: true as const, value: task };
      },
    },
  ]);
  if (!registered.ok) throw new Error(registered.diagnostics[0].message);
  return registered.value;
}

function sameResult(actual: ResultRef | undefined, expected: ResultRef | undefined): boolean {
  if (actual === undefined || expected === undefined) return actual === expected;
  return (['id', 'revision', 'outputId', 'queryDigest', 'scopeDigest', 'sourceLineage'] as const).every(
    (key) => actual[key] === expected[key],
  );
}

function sameOverviewNode(
  actual: PresentationPlan['nodes'][number],
  expected: PresentationPlan['nodes'][number],
): boolean {
  return (
    actual.id === expected.id &&
    actual.role === expected.role &&
    actual.representation.id === expected.representation.id &&
    actual.representation.revision === expected.representation.revision &&
    actual.config.schema.id === expected.config.schema.id &&
    actual.config.schema.revision === expected.config.schema.revision &&
    actual.children.length === expected.children.length &&
    actual.children.every((child, index) => child === expected.children[index]) &&
    sameResult(actual.result, expected.result)
  );
}

export function overviewPattern(): PresentationPatternManifest {
  const pattern: PresentationPatternManifest = {
    ref: PATTERN,
    expand(request) {
      const matches = ROLES.map((role) => request.context.results.filter((result) => result.ref.outputId === role));
      if (
        request.context.task.id !== 'attendance-overview-task' ||
        !ROLES.every((role) => request.context.task.needs.some((need) => need.id === role && need.required)) ||
        matches.some((results) => results.length !== 1)
      )
        return {
          ok: false,
          diagnostics: [
            {
              code: 'attendance.pattern-input',
              message: 'The registered goal needs three exact results.',
              retryable: false,
            },
          ],
        };
      return {
        ok: true,
        value: {
          id: request.id,
          revision: request.revision,
          rootId: 'workspace',
          preconditions: request.preconditions,
          nodes: [
            {
              id: 'workspace',
              role: 'structure',
              representation: REF.workspace,
              config: { schema: { id: 'layout.stack.config', revision: '1' }, values: {} },
              children: [...ROLES],
            },
            ...ROLES.map((role, index) => ({
              id: role,
              role: presentationRole(role),
              representation: REF[role],
              result: matches[index]![0]!.ref,
              config: {
                schema: { id: `${REF[role].id}.config`, revision: '1' },
                values: configFor(role),
              },
              children: [],
            })),
          ],
          links: [],
          coverage: ROLES.map((role) => ({
            needId: role,
            nodeIds: [role],
            operations: [role === 'summary' ? READ : ANALYZE],
          })),
          stateTransfer: [],
          diagnostics: [],
        },
      };
    },
    matches(plan, context) {
      const expanded = pattern.expand({
        id: plan.id,
        revision: plan.revision,
        preconditions: plan.preconditions,
        context,
      });
      if (!expanded.ok || plan.rootId !== expanded.value.rootId || plan.nodes.length !== expanded.value.nodes.length)
        return false;
      return expanded.value.nodes.every(
        (expected) => plan.nodes.filter((actual) => sameOverviewNode(actual, expected)).length === 1,
      );
    },
  };
  return pattern;
}
