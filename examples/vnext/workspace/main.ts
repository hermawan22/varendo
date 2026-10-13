import { defineResource, type Intent, type QuerySpec, type Task } from '@varendo/core';
import { createIntentCompilerRegistry } from '@varendo/core/app';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createLocalDataService, type AuthorizeRead } from '@varendo/runtime/data';
import { createVarendoApp, type WebRenderReceipt } from '@varendo/web/app';
import { defineRecipe } from '@varendo/web/recipes';
import { z } from 'zod';

const METRIC = { id: 'attendance.present-total', revision: '1' } as const;
const GOAL = { id: 'attendance.workspace-child', revision: '1' } as const;
const rows = [
  { id: 'a', employee: 'Ada', day: '2026-09-01', team: 'Engineering', present: 1 },
  { id: 'b', employee: 'Sam', day: '2026-09-02', team: 'Engineering', present: 1 },
  { id: 'c', employee: 'Lee', day: '2026-09-02', team: 'Design', present: 1 },
] as const;
const functions = createQueryFunctionRegistry({ version: '2' });
if (!functions.ok) throw new Error(functions.diagnostics[0]!.message);
const resource = defineResource({
  id: 'attendance',
  revision: 'workspace-attendance-1',
  label: 'Synthetic attendance',
  identity: ['id'],
  schema: z.object({
    id: z.string(),
    employee: z.string(),
    day: z.iso.date(),
    team: z.string(),
    present: z.number().int(),
  }),
  fields: {
    id: { label: 'Observation', hidden: true },
    employee: { label: 'Employee', role: 'dimension' },
    day: { label: 'Day', role: 'time' },
    team: { label: 'Team', role: 'dimension' },
    present: { label: 'Present employee-day', role: 'measure' },
  },
  meanings: [
    {
      ...METRIC,
      label: 'Present employees',
      explanation: 'Sum of registered present observations.',
      output: { value: 'integer', nullable: true },
      implementation: {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: { id: 'core.aggregate.sum', revision: '1' },
          arguments: [{ kind: 'field', ref: 'present' }],
        },
      },
      dependencies: [],
      functionRegistryDigest: functions.value.digest,
      origin: 'manual',
      lifecycle: 'active',
      scope: 'workspace',
      authority: 'approved',
      aggregation: 'additive',
      aggregationDimensions: [],
      missingPolicy: 'reject',
    },
  ],
  presentation: { allowedViews: ['data.metric', 'trend', 'table'] },
});

const authorize: AuthorizeRead = async ({ context }) =>
  context.principal === 'workspace-user'
    ? { ok: true, value: { scopeDigest: 'workspace-scope', policyRevision: 'workspace-policy-1' } }
    : { ok: false, diagnostics: [{ code: 'workspace.denied', message: 'Read denied.', retryable: false }] };

type Role = 'summary' | 'trend' | 'breakdown';
const groupingByRole: Record<Role, readonly string[]> = {
  summary: ['team'],
  trend: ['day'],
  breakdown: ['employee'],
};
const defaultViewByRole: Record<Role, string> = {
  summary: 'data.metric',
  trend: 'trend',
  breakdown: 'table',
};
function isRole(value: string): value is Role {
  return value === 'summary' || value === 'trend' || value === 'breakdown';
}
function valuesForRole(role: Role) {
  if (role === 'summary') return { field: METRIC.id, identityValues: { team: 'Engineering' } };
  if (role === 'trend') return { labelField: 'day', series: [{ field: METRIC.id }] };
  return {
    columns: [
      { key: 'employee', label: 'Employee' },
      { key: METRIC.id, label: 'Present employees' },
    ],
    selection: 'none',
  };
}
const views = {
  summary: { id: 'data.metric', revision: '1', role: 'metric' },
  trend: { id: 'data.trend', revision: '1', role: 'trend' },
  breakdown: { id: 'data.table', revision: '1', role: 'table' },
} as const;
const registered = createIntentCompilerRegistry([
  {
    ref: GOAL,
    schema: z.object({ role: z.enum(['summary', 'trend', 'breakdown']) }),
    capabilities: ['data.read', 'data.analyze'],
    compile(input, context) {
      const role = input.role;
      const grouping = groupingByRole[role];
      const query: QuerySpec = {
        entity: resource.id,
        fields: grouping,
        measures: [METRIC],
        relations: [],
        groupBy: grouping,
        population: { kind: 'all-authorized' },
        where: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
        order: [],
      };
      const operation = role === 'summary' ? { id: 'data.read', revision: '1' } : { id: 'data.analyze', revision: '1' };
      const task: Task = {
        version: '1',
        id: `workspace-${role}-task`,
        revision: context.taskRevision,
        catalogRevision: context.resource.catalog.revision,
        functionRegistryDigest: context.resource.catalog.functionRegistryDigest,
        regionId: context.regionId,
        kind: 'data',
        goal: `Engineering attendance ${role}`,
        assumptions: [],
        outputs: [{ id: role, kind: 'query', query, dependsOn: [], delivery: 'eager' }],
        needs: [
          {
            id: role,
            operation,
            outputId: role,
            fields: role === 'summary' ? [METRIC.id] : [grouping[0]!, METRIC.id],
            required: true,
          },
        ],
      };
      return { ok: true as const, value: task };
    },
  },
]);
if (!registered.ok) throw new Error(registered.diagnostics[0]!.message);
function childStateTransfers(role: Role, existing: boolean) {
  return existing ? [{ fromNode: role, toNode: role, mapping: { id: 'varendo.state.identity', revision: '1' } }] : [];
}

const recipe = defineRecipe({
  ref: { id: 'attendance.workspace-region', revision: '1' },
  intents: [GOAL],
  build(context) {
    const role = context.task.regionId;
    const need = context.task.needs[0];
    if (!isRole(role) || need === undefined || context.result === undefined)
      return {
        ok: false,
        diagnostics: [
          { code: 'workspace.result-missing', message: 'An authorized child result is required.', retryable: false },
        ],
      };
    const view = views[role];
    const requested = context.task.viewPreference?.representation;
    if (
      requested !== undefined &&
      requested !== view.id &&
      requested !== role &&
      !(role === 'summary' && requested === 'metric') &&
      !(role === 'breakdown' && requested === 'table')
    )
      return {
        ok: false,
        diagnostics: [
          { code: 'workspace.view-unsupported', message: 'This child view is not registered.', retryable: false },
        ],
      };
    const values = valuesForRole(role);
    return {
      ok: true,
      value: {
        id: `workspace-${role}-presentation`,
        revision: context.task.revision,
        rootId: role,
        preconditions: context.current,
        nodes: [
          {
            id: role,
            role: view.role,
            representation: { id: view.id, revision: view.revision },
            result: context.result.ref,
            config: { schema: { id: `${view.id}.config`, revision: '1' }, values },
            children: [],
          },
        ],
        links: [],
        coverage: [{ needId: need.id, nodeIds: [role], operations: [need.operation] }],
        stateTransfer: childStateTransfers(role, context.incumbent !== undefined),
        diagnostics: [],
      },
    };
  },
});
const app = createVarendoApp({
  intents: registered.value,
  recipes: [recipe],
  resources: [
    {
      resource,
      data: createLocalDataService({
        snapshot: { catalog: resource.catalog, sourceRevision: 'workspace-source-1', records: { attendance: rows } },
        functionRegistry: functions.value,
        sourceLimits: { rows: 100, bytes: 100_000 },
        authorize,
      }),
    },
  ],
  authority: {
    read: () => ({
      ok: true,
      value: {
        principalKey: 'workspace-user',
        scopeDigest: 'workspace-scope',
        policyRevision: 'workspace-policy-1',
        experienceRevision: 'workspace-experience-1',
        grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
        readContext: { principal: 'workspace-user' },
      },
    }),
  },
});

for (const role of ['summary', 'trend', 'breakdown'] as const) {
  const mounted = app.mount({
    target: document.querySelector<HTMLElement>(`#${role}-host`)!,
    regionId: role,
    resourceId: resource.id,
  });
  if (!mounted.ok) throw new Error(mounted.diagnostics[0]!.message);
}

let sequence = 0;
const latest: Record<Role, number> = { summary: 0, trend: 0, breakdown: 0 };
function intent(role: Role, preferredView?: string): Intent {
  return {
    version: '1',
    id: `workspace-${role}-${++sequence}`,
    kind: 'custom',
    resource: resource.id,
    intent: GOAL,
    input: { role },
    preferredView: preferredView ?? defaultViewByRole[role],
  };
}

function showValues(role: Role, receipt: Extract<WebRenderReceipt, { status: 'renderer-ready' }>): void {
  const resultRows = receipt.runtime.outputs[0]?.handle.snapshot().batches.flatMap((batch) => batch.rows) ?? [];
  const target = document.querySelector<HTMLElement>(
    `[data-testid="${role === 'summary' ? 'summary-value' : `${role}-values`}"]`,
  )!;
  if (role === 'summary') {
    target.textContent = String(resultRows[0]?.[METRIC.id] ?? '');
    return;
  }
  target.replaceChildren();
  for (const row of resultRows) {
    const item = document.createElement('li');
    item.textContent = `${row[role === 'trend' ? 'day' : 'employee']}: ${row[METRIC.id]}`;
    target.append(item);
  }
}

async function show(role: Role, preferredView?: string): Promise<void> {
  const ticket = ++latest[role];
  const receipt = await app.render({ regionId: role, intent: intent(role, preferredView) });
  if (ticket !== latest[role]) return;
  const status = document.querySelector<HTMLElement>(`[data-testid="${role}-status"]`)!;
  status.textContent =
    receipt.status === 'renderer-ready'
      ? `renderer-ready:${receipt.presentation.plan.nodes.find((node) => node.id === receipt.presentation.plan.rootId)?.representation.id}`
      : `${receipt.status}:${receipt.diagnostics[0]?.code ?? 'unknown'}`;
  status.dataset.diagnostic = JSON.stringify(receipt.diagnostics);
  if (receipt.status === 'renderer-ready') showValues(role, receipt);
}

document.querySelector('#narrow-workspace')!.addEventListener('click', () => {
  document.querySelector<HTMLElement>('#workspace')!.dataset.width = 'narrow';
});
document
  .querySelector('#unsupported-breakdown')!
  .addEventListener('click', () => void show('breakdown', 'missing.view'));
document.querySelector('#restore-breakdown')!.addEventListener('click', () => void show('breakdown'));
void Promise.all([show('summary'), show('trend'), show('breakdown')]);
