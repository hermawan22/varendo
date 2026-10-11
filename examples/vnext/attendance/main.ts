import { createLocalDataService, type AuthorizeRead } from '@varendo/runtime/data';
import { createAeliqoApp, type WebRenderReceipt } from '@varendo/web/app';
import { records, resource, functionRegistry, dailyAttendanceIntent } from './data.js';
const ref = (id: string) => ({ id, revision: '1' }) as const;

const authorize: AuthorizeRead = async ({ context }) =>
  context.principal === 'attendance-host'
    ? { ok: true, value: { scopeDigest: 'attendance-scope', policyRevision: 'attendance-policy-1' } }
    : {
        ok: false,
        diagnostics: [{ code: 'attendance.denied', message: 'The host denied this read.', retryable: false }],
      };

const app = createAeliqoApp({
  resources: [
    {
      resource,
      data: createLocalDataService({
        snapshot: {
          catalog: resource.catalog,
          sourceRevision: 'attendance-source-1',
          records: { [resource.entity.id]: records },
        },
        functionRegistry,
        sourceLimits: { rows: 100, bytes: 100_000 },
        authorize,
      }),
    },
  ],
  authority: {
    read: () => ({
      ok: true,
      value: {
        principalKey: 'attendance-host',
        scopeDigest: 'attendance-scope',
        policyRevision: 'attendance-policy-1',
        experienceRevision: 'attendance-experience-1',
        grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
        readContext: { principal: 'attendance-host' },
      },
    }),
  },
});

const mounted = app.mount({
  target: document.querySelector<HTMLElement>('#attendance-host')!,
  regionId: 'attendance',
  resourceId: resource.id,
});
if (!mounted.ok) throw new Error(mounted.diagnostics[0]!.message);
const status = document.querySelector<HTMLElement>('[data-testid="attendance-status"]')!;
const values = document.querySelector<HTMLElement>('[data-testid="daily-values"]')!;
const choice = document.querySelector<HTMLElement>('#metric-choice')!;
let sequence = 0;

async function show(
  measures: readonly [
    { readonly id: string; readonly revision: string },
    ...{ readonly id: string; readonly revision: string }[],
  ],
): Promise<void> {
  const requestSequence = ++sequence;
  const intent = dailyAttendanceIntent(measures, `attendance-${requestSequence}`);
  const receipt: WebRenderReceipt = await app.render({ regionId: 'attendance', intent });
  if (requestSequence !== sequence) return;
  status.textContent =
    receipt.status === 'renderer-ready'
      ? `renderer-ready:${receipt.presentation.plan.nodes.find((node) => node.id === receipt.presentation.plan.rootId)?.representation.id}`
      : `${receipt.status}:${receipt.diagnostics[0]?.code ?? 'unknown'}`;
  status.dataset.diagnostic = JSON.stringify(receipt.diagnostics);
  choice.hidden = receipt.status !== 'needs-input';
  if (receipt.status !== 'renderer-ready') return;
  values.replaceChildren();
  const rows = receipt.runtime.outputs[0]?.handle.snapshot().batches.flatMap((batch) => batch.rows) ?? [];
  for (const row of rows) {
    const item = document.createElement('li');
    item.textContent = `${row.day}: ${row[measures[0].id]}`;
    values.append(item);
  }
}

document
  .querySelector('#compare-metrics')!
  .addEventListener('click', () => void show([ref('attendance.rate'), ref('attendance.present')]));
document.querySelector('#apply-metric')!.addEventListener('click', () => {
  const selected = document.querySelector<HTMLSelectElement>('#attendance-metric')!.value;
  if (selected === 'attendance.rate' || selected === 'attendance.present') void show([ref(selected)]);
});
export function restartAttendanceJourney(): void {
  choice.hidden = true;
  status.textContent = 'Loading';
  void show([ref('attendance.rate')]);
}
restartAttendanceJourney();
