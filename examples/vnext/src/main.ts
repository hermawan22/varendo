import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { defineResource, type Intent } from '@varendo/core';
import { createLocalDataService, type AuthorizeRead } from '@varendo/runtime/data';
import type { VarendoAuthority } from '@varendo/runtime/app';
import { createVarendoApp, type WebRenderReceipt } from '@varendo/web/app';
import { z } from 'zod';

const PEOPLE = Object.freeze([
  { id: 'p-1', name: 'Ada Chen', team: 'Design', location: 'Jakarta' },
  { id: 'p-2', name: 'Sam Rivera', team: 'Engineering', location: 'Lisbon' },
  { id: 'p-3', name: 'Iman Putra', team: 'Engineering', location: 'Bandung' },
  { id: 'p-4', name: 'Lee Morgan', team: 'Operations', location: 'London' },
]);

const HEADCOUNT = Object.freeze([
  { id: '2026-07-design', month: '2026-07-01', team: 'Design', headcount: 38, plannedHeadcount: 40 },
  { id: '2026-07-engineering', month: '2026-07-01', team: 'Engineering', headcount: 61, plannedHeadcount: 60 },
  { id: '2026-07-operations', month: '2026-07-01', team: 'Operations', headcount: 27, plannedHeadcount: 28 },
  { id: '2026-08-design', month: '2026-08-01', team: 'Design', headcount: 39, plannedHeadcount: 41 },
  { id: '2026-08-engineering', month: '2026-08-01', team: 'Engineering', headcount: 64, plannedHeadcount: 65 },
  { id: '2026-08-operations', month: '2026-08-01', team: 'Operations', headcount: 27, plannedHeadcount: 28 },
]);

const people = defineResource({
  id: 'people',
  revision: 'vnext-people-1',
  label: 'People',
  identity: ['id'],
  schema: z.object({ id: z.string(), name: z.string(), team: z.string(), location: z.string() }),
  fields: {
    name: { label: 'Name', role: 'attribute' },
    team: { label: 'Team', role: 'dimension' },
    location: { label: 'Location', role: 'attribute' },
  },
  presentation: { allowedViews: ['table', 'cards', 'detail'] },
});

const workforce = defineResource({
  id: 'workforce',
  revision: 'vnext-workforce-1',
  label: 'Monthly workforce headcount',
  identity: ['id'],
  rowGrain: ['month', 'team'],
  schema: z.object({
    id: z.string(),
    month: z.iso.date(),
    team: z.string(),
    headcount: z.number().int(),
    plannedHeadcount: z.number().int(),
  }),
  fields: {
    id: { label: 'Snapshot ID', hidden: true },
    month: { label: 'Month', role: 'time' },
    team: { label: 'Team', role: 'dimension' },
    headcount: { label: 'Headcount', role: 'measure' },
    plannedHeadcount: { label: 'Planned headcount', role: 'measure' },
  },
  meanings: [
    {
      id: 'month-headcount',
      revision: '1',
      label: 'Month end headcount',
      explanation: 'Employees active at the end of each month.',
      output: { value: 'integer', nullable: false, grain: ['month', 'team'] },
      implementation: {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: { id: 'core.aggregate.sum', revision: '1' },
          arguments: [{ kind: 'field', ref: 'headcount' }],
        },
      },
      dependencies: [],
      functionRegistryDigest: 'core-query-2',
      origin: 'manual',
      lifecycle: 'active',
      scope: 'workspace',
      authority: 'approved',
      aggregation: 'semi-additive',
      aggregationDimensions: ['month', 'team'],
      missingPolicy: 'reject',
    },
    {
      id: 'planned-headcount',
      revision: '1',
      label: 'Planned headcount',
      explanation: 'Planned employees at the end of each month.',
      output: { value: 'integer', nullable: false, grain: ['month', 'team'] },
      implementation: {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: { id: 'core.aggregate.sum', revision: '1' },
          arguments: [{ kind: 'field', ref: 'plannedHeadcount' }],
        },
      },
      dependencies: [],
      functionRegistryDigest: 'core-query-2',
      origin: 'manual',
      lifecycle: 'active',
      scope: 'workspace',
      authority: 'approved',
      aggregation: 'semi-additive',
      aggregationDimensions: ['month', 'team'],
      missingPolicy: 'reject',
    },
  ],
  presentation: { allowedViews: ['table', 'trend', 'bar'], preferred: { analyze: 'bar' } },
});

const functions = createQueryFunctionRegistry({ version: '2' });
if (!functions.ok) throw new Error(functions.diagnostics[0]!.message);

let accessGranted = true;
let holdNextPeopleRead = false;
let releaseHeldPeopleRead: (() => void) | undefined;

const authority: VarendoAuthority['read'] = () => {
  if (!accessGranted)
    return {
      ok: false as const,
      diagnostics: [
        { code: 'vnext.denied', message: 'Browser fixture access was revoked.', retryable: false },
      ] as const,
    };
  return {
    ok: true as const,
    value: {
      principalKey: 'vnext-browser',
      scopeDigest: 'vnext-scope',
      policyRevision: 'vnext-policy-1',
      experienceRevision: 'vnext-experience-1',
      grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
      readContext: { principal: 'vnext-browser' },
    },
  };
};

const authorize: AuthorizeRead = async ({ context }) => {
  if (context.principal !== 'vnext-browser')
    return {
      ok: false as const,
      diagnostics: [{ code: 'vnext.denied', message: 'Browser fixture access denied.', retryable: false }] as const,
    };
  if (holdNextPeopleRead) {
    holdNextPeopleRead = false;
    await new Promise<void>((resolve) => {
      const finish = () => {
        context.signal?.removeEventListener('abort', finish);
        releaseHeldPeopleRead = undefined;
        document.body.dataset.peopleReadHeld = 'false';
        resolve();
      };
      releaseHeldPeopleRead = finish;
      document.body.dataset.peopleReadHeld = 'true';
      if (context.signal?.aborted) finish();
      else context.signal?.addEventListener('abort', finish, { once: true });
    });
  }
  return { ok: true as const, value: { scopeDigest: 'vnext-scope', policyRevision: 'vnext-policy-1' } };
};

const app = createVarendoApp({
  resources: [
    {
      resource: people,
      data: createLocalDataService({
        snapshot: { catalog: people.catalog, sourceRevision: 'vnext-people-data-1', records: { people: PEOPLE } },
        functionRegistry: functions.value,
        sourceLimits: { rows: 100, bytes: 250_000 },
        authorize,
      }),
    },
    {
      resource: workforce,
      data: createLocalDataService({
        snapshot: {
          catalog: workforce.catalog,
          sourceRevision: 'vnext-workforce-data-1',
          records: { workforce: HEADCOUNT },
        },
        functionRegistry: functions.value,
        sourceLimits: { rows: 100, bytes: 250_000 },
        authorize,
      }),
    },
  ],
  authority: { read: authority },
});

const peopleMount = app.mount({
  target: document.querySelector<HTMLElement>('#people-host')!,
  regionId: 'people',
  resourceId: 'people',
});
const analysisMount = app.mount({
  target: document.querySelector<HTMLElement>('#analysis-host')!,
  regionId: 'analysis',
  resourceId: 'workforce',
});
const compareMount = app.mount({
  target: document.querySelector<HTMLElement>('#compare-host')!,
  regionId: 'compare',
  resourceId: 'people',
});
if (!peopleMount.ok || !analysisMount.ok || !compareMount.ok)
  throw new Error('The vNext example regions could not be mounted.');

const draft = document.querySelector<HTMLInputElement>('#people-draft')!;

const statusFor = (id: string): HTMLElement => document.querySelector<HTMLElement>(`#${id}-status`)!;
const clarification = document.querySelector<HTMLElement>('#analysis-clarification')!;
const statusText = (receipt: WebRenderReceipt): string => {
  if (receipt.status !== 'renderer-ready') return `${receipt.status}:${receipt.diagnostics[0]?.code ?? 'unknown'}`;
  const root = receipt.presentation.plan.nodes.find((node) => node.id === receipt.presentation.plan.rootId);
  return `renderer-ready:${root?.representation.id ?? 'unknown'}`;
};

function reportReceipt(statusId: string, receipt: WebRenderReceipt): void {
  const status = statusFor(statusId);
  status.textContent = statusText(receipt);
  status.dataset.state = receipt.status;
  status.setAttribute('role', receipt.status === 'denied' || receipt.status === 'failed' ? 'alert' : 'status');
  if (statusId !== 'analysis') return;
  clarification.hidden = receipt.status !== 'needs-input';
}

const latestRenderByRegion = new Map<string, number>();
let renderGeneration = 0;
async function render(
  regionId: string,
  statusId: string,
  intent: Intent,
  signal?: AbortSignal,
): Promise<WebRenderReceipt> {
  const generation = ++renderGeneration;
  latestRenderByRegion.set(regionId, generation);
  const receipt = await app.render({ regionId, intent, ...(signal === undefined ? {} : { signal }) });
  if (latestRenderByRegion.get(regionId) === generation) reportReceipt(statusId, receipt);
  return receipt;
}

let sequence = 0;
let latestPeopleRequestId = '';
const renderPeople = async (
  preferredView?: string,
  page?: { readonly size: number },
  signal?: AbortSignal,
  location?: string,
): Promise<WebRenderReceipt> => {
  const requestId = `browse-people-${++sequence}`;
  latestPeopleRequestId = requestId;
  const receipt = await render(
    'people',
    'people',
    {
      version: '1',
      id: requestId,
      kind: 'browse',
      resource: 'people',
      fields: ['id', 'name', 'team', 'location'],
      ...(preferredView === undefined ? {} : { preferredView }),
      ...(page === undefined ? {} : { page }),
      ...(location === undefined
        ? {}
        : { filter: { op: 'compare' as const, field: 'location', comparison: 'eq' as const, value: location } }),
    },
    signal,
  );
  if (requestId === latestPeopleRequestId && receipt.status === 'renderer-ready')
    document.querySelector<HTMLElement>('#people-filter')!.textContent =
      location === undefined
        ? 'All authorized people · scope vnext-scope'
        : `People with location ${location} · scope vnext-scope`;
  return receipt;
};

const renderAnalysis = (
  preferredView: 'bar' | 'trend',
  measures: readonly [
    { readonly id: 'month-headcount' | 'planned-headcount'; readonly revision: '1' },
    ...{ readonly id: 'month-headcount' | 'planned-headcount'; readonly revision: '1' }[],
  ] = [{ id: 'month-headcount', revision: '1' }],
) => {
  const grouping =
    preferredView === 'bar'
      ? {
          dimensions: ['team'],
          time: { field: 'month', grain: 'month' as const, calendar: 'gregorian', timezone: 'UTC' },
          filter: { op: 'compare' as const, field: 'month', comparison: 'eq' as const, value: '2026-08-01' },
        }
      : {
          dimensions: ['team'],
          time: { field: 'month', grain: 'month' as const, calendar: 'gregorian', timezone: 'UTC' },
        };
  return render('analysis', 'analysis', {
    version: '1',
    id: `analyze-workforce-${++sequence}`,
    kind: 'analyze',
    resource: 'workforce',
    measures,
    ...grouping,
    preferredView,
  });
};

const renderCompare = () =>
  render('compare', 'compare', {
    version: '1',
    id: `compare-people-${++sequence}`,
    kind: 'compare',
    resource: 'people',
    identities: [{ id: 'p-1' }, { id: 'p-2' }],
    fields: ['id', 'name', 'team', 'location'],
  });

document.querySelector('[data-action="people-adaptive"]')!.addEventListener('click', () => void renderPeople());
document
  .querySelector('[data-action="people-jakarta"]')!
  .addEventListener('click', () => void renderPeople(undefined, undefined, undefined, 'Jakarta'));
document.querySelector('[data-action="people-table"]')!.addEventListener('click', () => void renderPeople('table'));
document.querySelector('[data-action="people-cards"]')!.addEventListener('click', () => void renderPeople('cards'));
document
  .querySelector('[data-action="people-partial"]')!
  .addEventListener('click', () => void renderPeople('table', { size: 2 }));
const startCancellable = document.querySelector<HTMLButtonElement>('[data-action="people-start-cancellable"]')!;
const cancelCancellable = document.querySelector<HTMLButtonElement>('[data-action="people-cancel"]')!;
let cancellableRender: AbortController | undefined;
startCancellable.addEventListener('click', () => {
  if (cancellableRender !== undefined) return;
  holdNextPeopleRead = true;
  const controller = new AbortController();
  cancellableRender = controller;
  startCancellable.disabled = true;
  cancelCancellable.disabled = false;
  const status = statusFor('people');
  status.dataset.state = 'loading';
  status.setAttribute('role', 'status');
  status.textContent = 'loading:waiting-for-authorized-read';
  void renderPeople('table', undefined, controller.signal).finally(() => {
    if (cancellableRender !== controller) return;
    cancellableRender = undefined;
    startCancellable.disabled = false;
    cancelCancellable.disabled = true;
  });
});
cancelCancellable.addEventListener('click', () => {
  cancellableRender?.abort();
  releaseHeldPeopleRead?.();
});
document.querySelector('[data-action="people-invalid"]')!.addEventListener('click', () => void renderPeople('trend'));
document.querySelector('[data-action="people-denied"]')!.addEventListener('click', () => {
  accessGranted = false;
  void renderPeople('table');
});
document.querySelector('[data-action="analysis-bar"]')!.addEventListener('click', () => void renderAnalysis('bar'));
document.querySelector('[data-action="analysis-trend"]')!.addEventListener('click', () => void renderAnalysis('trend'));
document.querySelector('[data-action="analysis-clarify"]')!.addEventListener(
  'click',
  () =>
    void renderAnalysis('trend', [
      { id: 'month-headcount', revision: '1' },
      { id: 'planned-headcount', revision: '1' },
    ]),
);
document.querySelector('[data-action="analysis-apply-clarification"]')!.addEventListener('click', () => {
  const measure = document.querySelector<HTMLSelectElement>('#analysis-measure')!.value;
  if (measure === 'month-headcount' || measure === 'planned-headcount')
    void renderAnalysis('trend', [{ id: measure, revision: '1' }]);
});
document.querySelector('[data-action="compare"]')!.addEventListener('click', () => void renderCompare());

void Promise.all([renderPeople('table'), renderAnalysis('trend')]).then(() => {
  const pageStatus = document.querySelector<HTMLElement>('#page-status');
  if (pageStatus !== null) pageStatus.textContent = 'Ready';
});

Object.assign(window, { app, renderPeople, renderAnalysis, renderCompare, draft });
