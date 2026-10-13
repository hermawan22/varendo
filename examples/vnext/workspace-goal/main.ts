import type { Intent } from '@varendo/core';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createLocalDataBinding } from '@varendo/runtime';
import { registerVarendoElements } from '@varendo/web';
import { createVarendoApp } from '@varendo/web/app';
import { REGION, GOAL, METRIC, feature, goalRegistry, overviewPattern } from '../workspace/goal.js';

const functions = createQueryFunctionRegistry({ version: '2' });
if (!functions.ok) throw new Error(functions.diagnostics[0]!.message);
let failBreakdown = false;
const binding = createLocalDataBinding({
  feature,
  snapshot: {
    catalog: feature.catalog,
    sourceRevision: 'attendance-1',
    records: {
      attendance: [
        { id: 'a', employee: 'Ada', day: '2026-09-01', team: 'Engineering', present: 1 },
        { id: 'b', employee: 'Sam', day: '2026-09-02', team: 'Engineering', present: 1 },
        { id: 'c', employee: 'Lee', day: '2026-09-02', team: 'Design', present: 1 },
      ],
    },
  },
  initialState: { rows: [] },
  coverage: {
    fields: ['id', 'employee', 'day', 'team', 'present'],
    metrics: [METRIC],
    operators: ['eq'],
    pagination: 'snapshot',
    stableOrder: ['id'],
    sorting: 'stable-fields-only',
    aggregation: 'registered-only',
    streaming: 'finite',
    updates: 'snapshot-replace',
    unsupported: ['streaming', 'live-updates'],
  },
  normalize: async () => ({ rows: [] }),
  serviceOptions: {
    functionRegistry: functions.value,
    authorize: () => ({ ok: true, value: { scopeDigest: 'attendance-scope', policyRevision: '1' } }),
  },
});
const execute = binding.service.execute;
binding.service.execute = (request, context) =>
  failBreakdown && request.target.outputId === 'breakdown'
    ? (async function* () {
        yield {
          kind: 'error' as const,
          requestId: request.requestId,
          error: {
            code: 'attendance.breakdown-failed',
            message: 'Synthetic breakdown execution failed.',
            retryable: false,
          },
        };
      })()
    : execute(request, context);
const app = createVarendoApp({
  patterns: [overviewPattern()],
  runtimeId: 'attendance-runtime',
  resources: [{ resource: feature.resource, data: binding.service }],
  intents: goalRegistry(),
  authority: {
    read: () => ({
      ok: true,
      value: {
        principalKey: 'attendance-user',
        scopeDigest: 'attendance-scope',
        policyRevision: '1',
        experienceRevision: '1',
        grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
        readContext: { principal: 'attendance-user' },
      },
    }),
  },
});
registerVarendoElements();
const workspace = document.querySelector<HTMLElement>('#workspace')!;
const status = document.querySelector<HTMLElement>('[data-testid="goal-status"]')!;
const mounted = app.mount({ target: workspace, regionId: REGION, resourceId: feature.id });
if (!mounted.ok) throw new Error(mounted.diagnostics[0]!.message);

const intent: Intent = {
  version: '1',
  id: 'attendance-overview',
  resource: feature.id,
  kind: 'custom',
  intent: GOAL,
  input: { team: 'Engineering' },
};

async function showOverview(): Promise<void> {
  const receipt = await app.render({ regionId: REGION, intent });
  if (receipt.status !== 'renderer-ready') throw new Error(receipt.diagnostics[0]?.code ?? receipt.status);
  const { runtime, presentation } = receipt;
  workspace.dataset.taskId = runtime.task.id;
  workspace.dataset.needs = runtime.task.needs.map((need) => need.id).join(',');
  workspace.dataset.outputs = runtime.outputs.map((output) => output.outputId).join(',');
  workspace.dataset.facade = 'app.render';
  workspace.dataset.planNodes = presentation.plan.nodes.map((node) => node.id).join(',');
  workspace.dataset.nodeResults = presentation.plan.nodes
    .filter((node) => node.result !== undefined)
    .map((node) => `${node.id}:${node.result!.outputId}`)
    .join(',');
  workspace.dataset.scope = presentation.plan.preconditions.scopeDigest;
  status.textContent = receipt.status;
}

document.querySelector('#request-anomaly')!.addEventListener('click', () => {
  void app
    .render({
      regionId: REGION,
      intent: { ...intent, id: 'attendance-anomaly', intent: { id: 'attendance.anomaly', revision: '1' } },
    })
    .then((receipt) => {
      status.textContent = `${receipt.status}:${receipt.diagnostics[0]?.code ?? 'unknown'}`;
    });
});
document.querySelector('#fail-breakdown')!.addEventListener('click', () => {
  failBreakdown = true;
  void app
    .render({ regionId: REGION, intent: { ...intent, id: 'attendance-overview-failing-update' } })
    .then((receipt) => {
      status.textContent = `${receipt.status}:${receipt.diagnostics[0]?.code ?? 'unknown'}`;
    })
    .finally(() => {
      failBreakdown = false;
    });
});
export function restartWorkspaceGoalJourney(): void {
  status.textContent = 'Loading';
  void showOverview().catch((error: unknown) => {
    status.textContent = `failed:${error instanceof Error ? error.message : String(error)}`;
  });
}
restartWorkspaceGoalJourney();
