import { expect, it, vi } from 'vitest';
import type { InteractionPayload } from '../../packages/core/src/index.js';
import type {
  ActionPort,
  ActionPreview,
  ActionExecution,
  ActionReceipt,
  ActionOutcome,
} from '../../packages/runtime/src/actions/index.js';
import type { WebAppContext, WebRegion } from '../../packages/web/src/app/context.js';
import type { AeliqoAppActionEvent } from '../../packages/web/src/app/types.js';
import type { AeliqoSemanticInteractionRequest } from '../../packages/web/src/region/types.js';
import { createInteractionHandler, cancelActiveAction } from '../../packages/web/src/app/interaction.js';
import { AeliqoFieldElement } from '../../packages/web/src/input/base.js';
import { adaptRegion } from '../../packages/web/src/app/render.js';
import * as presentationPlan from '../../packages/web/src/app/presentation-plan.js';
import type { RuntimePresentationInput } from '../../packages/runtime/src/app/index.js';
import type { RegionSnapshot } from '../../packages/runtime/src/regions/index.js';
import { createRegistrationDocument } from './registration-document.js';

const draft: Extract<InteractionPayload, { kind: 'draft' }> = {
  kind: 'draft',
  entity: 'people',
  key: 'ada',
  field: 'name',
  value: 'Ada edited',
  entityRevision: '1',
};
const action = { id: 'people.save', revision: '1' };
const preview = { state: 'preview', id: 'preview-1', action } as ActionPreview;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(actionMatches = true) {
  let taskRevision = 'task-1';
  let principalKey = 'user';
  let captured: Extract<AeliqoAppActionEvent, { state: 'preview' }> | undefined;
  const execution = deferred<ActionOutcome<ActionExecution>>();
  const beforePreview = deferred<{ ok: true; value: ActionPreview }>();
  const reset = vi.fn();
  const control = Object.assign(Object.create(AeliqoFieldElement.prototype), {
    dataset: { aeliqoNodeId: 'name' },
    reset,
  });
  const binding: Record<string, unknown> = {
    entity: draft.entity,
    key: draft.key,
    field: draft.field,
    entityRevision: draft.entityRevision,
  };
  const port = {
    preview: vi.fn(() => beforePreview.promise),
    confirm: vi.fn(async () => ({ ok: true, value: { id: 'receipt-1' } as ActionReceipt })),
    execute: vi.fn(() => execution.promise),
    cancel: vi.fn(() => true),
  } as unknown as ActionPort;
  const region = {
    id: 'main',
    resourceId: 'people',
    sequence: 0,
    actionSequence: 0,
    actionPending: false,
    values: new Map(),
    drafts: new Map([['name', draft]]),
    element: {
      interaction: undefined,
      shadowRoot: { querySelectorAll: () => [control] },
      presentation: { nodes: [{ node: { id: 'name' }, config: { values: binding, ports: [{ payload: 'draft' }] } }] },
    },
  } as unknown as WebRegion;
  const context = {
    disposed: false,
    options: {
      onActionEvent: (event: AeliqoAppActionEvent) => {
        if (event.state === 'preview') captured = event;
      },
      authority: {
        read: () => ({
          ok: true,
          value: {
            principalKey,
            scopeDigest: 'scope',
            policyRevision: '1',
            experienceRevision: '1',
            grants: ['action.execute'],
          },
        }),
      },
    },
    regions: new Map([['main', region]]),
    runtime: {
      actionPort: port,
      snapshot: () => ({
        region: {
          taskRevision,
          state: { task: { kind: 'form', action: actionMatches ? action : { id: 'people.unrelated', revision: '1' } } },
        },
      }),
    },
  } as unknown as WebAppContext;
  const request = {
    nodeId: 'form',
    portId: 'submit',
    payload: { kind: 'action-request', action, input: {} },
  } as unknown as AeliqoSemanticInteractionRequest;
  const settled = vi.fn();
  const handler = createInteractionHandler(context, settled);
  return {
    region,
    context,
    port,
    reset,
    binding,
    settled,
    beforePreview,
    execution,
    start: () => handler(region, request),
    confirm: () => {
      if (!captured) throw new Error('No preview');
      return captured.confirm();
    },
    cancel: () => {
      if (!captured) throw new Error('No preview');
      return captured.cancel();
    },
    task: () => {
      taskRevision = 'new-task';
    },
    principal: () => {
      principalKey = 'another-user';
    },
    finish: (state: 'executed' | 'ambiguous' = 'executed') =>
      execution.resolve({
        ok: true,
        value:
          state === 'executed'
            ? { state, receiptId: 'receipt-1', action, output: {} }
            : { state, receiptId: 'receipt-1', action, reason: 'unknown effect' },
      }),
  };
}
async function confirmed(state: ReturnType<typeof fixture>) {
  const pending = state.start();
  state.beforePreview.resolve({ ok: true, value: preview });
  await pending;
  return { result: state.confirm() };
}

it('clears only draft objects captured before asynchronous preview', async () => {
  const state = fixture();
  const pending = state.start();
  const newer = { ...draft, value: 'Typed during preview' };
  state.region.drafts.set('name', newer);
  state.beforePreview.resolve({ ok: true, value: preview });
  await pending;
  const result = state.confirm();
  state.finish();
  await result;
  expect(state.region.drafts.get('name')).toBe(newer);
  expect(state.reset).not.toHaveBeenCalled();
});

it('clears the saved current entries and republishes retained interaction', async () => {
  const state = fixture();
  const pending = await confirmed(state);
  state.finish();
  await pending.result;
  expect(state.region.drafts.size).toBe(0);
  expect(state.region.element.interaction?.drafts).toEqual([]);
  expect(state.region.draftRevision).toBe(1);
  expect(state.reset).toHaveBeenCalledOnce();
});

it.each(['cancelled', 'disposed', 'task', 'principal', 'replacement', 'new-action', 'ambiguous'] as const)(
  'preserves drafts after %s action completion',
  async (kind) => {
    const state = fixture();
    const pending = await confirmed(state);
    // Let the confirmation continuation enter the intentionally delayed transport.
    await Promise.resolve();
    if (kind === 'cancelled') cancelActiveAction(state.region);
    if (kind === 'disposed') state.context.disposed = true;
    if (kind === 'task') state.task();
    if (kind === 'principal') state.principal();
    if (kind === 'replacement') state.context.regions.delete('main');
    if (kind === 'new-action') {
      state.region.actionSequence++;
      state.region.actionAbort = new AbortController();
      state.region.actionPending = true;
    }
    state.finish(kind === 'ambiguous' ? 'ambiguous' : 'executed');
    await pending.result;
    expect(state.region.drafts.get('name')).toBe(draft);
    expect(state.reset).not.toHaveBeenCalled();
    if (kind === 'new-action') {
      expect(state.region.actionPending).toBe(true);
      expect(state.settled).not.toHaveBeenCalled();
    }
  },
);

it('does not treat an unrelated successful action as a saved form draft', async () => {
  const state = fixture(false);
  const pending = await confirmed(state);
  state.finish();
  await pending.result;
  expect(state.region.drafts.get('name')).toBe(draft);
  expect(state.reset).not.toHaveBeenCalled();
});

it('does not reset a field whose registered entity revision differs', async () => {
  const state = fixture();
  state.binding.entityRevision = 'entity-2';
  const pending = await confirmed(state);
  state.finish();
  await pending.result;
  expect(state.reset).not.toHaveBeenCalled();
});

it('preserves both halves of a range when its other draft changes during the action', async () => {
  const state = fixture();
  const end = { ...draft, field: 'end', value: 'Saved end' };
  state.region.drafts.set('end', end);
  const startBinding = { ...state.binding };
  delete state.binding.field;
  state.binding.range = { start: startBinding, end: { ...startBinding, field: 'end' } };
  const pending = await confirmed(state);
  state.region.drafts.set('end', { ...end, value: 'New end' });
  state.finish();
  await pending.result;
  expect(state.reset).not.toHaveBeenCalled();
  expect(state.region.drafts.get('name')).toBe(draft);
  expect(state.region.drafts.get('end')?.value).toBe('New end');
});

it('resets a saved range whose unedited sibling remains at its trusted default', async () => {
  const state = fixture();
  const start = { ...state.binding };
  delete state.binding.field;
  state.binding.range = { start, end: { ...start, field: 'end' } };
  const pending = await confirmed(state);
  state.finish();
  await pending.result;
  expect(state.reset).toHaveBeenCalledOnce();
  expect(state.region.drafts.size).toBe(0);
});

it('does not reset a range when an uncaptured sibling receives a newer draft', async () => {
  const state = fixture();
  const start = { ...state.binding };
  delete state.binding.field;
  state.binding.range = { start, end: { ...start, field: 'end' } };
  const pending = await confirmed(state);
  state.region.drafts.set('end', { ...draft, field: 'end', value: 'New end' });
  state.finish();
  await pending.result;
  expect(state.reset).not.toHaveBeenCalled();
  expect(state.region.drafts.get('name')).toBe(draft);
  expect(state.region.drafts.get('end')?.value).toBe('New end');
});

it.each(['action.expired-preview', 'action.confirmation-denied'])('does not reset after %s', async (code) => {
  const state = fixture();
  vi.mocked(state.port.confirm).mockResolvedValueOnce({
    ok: false,
    diagnostics: [{ code, message: 'Confirmation unavailable', retryable: false }],
  });
  const pending = await confirmed(state);
  await pending.result;
  expect(state.port.execute).not.toHaveBeenCalled();
  expect(state.reset).not.toHaveBeenCalled();
  expect(state.region.drafts.get('name')).toBe(draft);
  expect(state.settled).toHaveBeenCalledOnce();
});

it('cancels an in-flight presentation before capturing a live action and resumes after cancellation', async () => {
  const state = fixture();
  const presentation = new AbortController();
  state.region.presentationAbort = presentation;
  const pending = state.start();
  expect(presentation.signal.aborted).toBe(true);
  expect(state.region.presentationAbort).toBeUndefined();
  expect(state.region.pendingAdapt).toBe(true);
  expect(state.region.actionPending).toBe(true);
  state.beforePreview.resolve({ ok: true, value: preview });
  await pending;
  expect(state.cancel()).toBe(true);
  expect(state.region.actionPending).toBe(false);
  expect(state.settled).toHaveBeenCalledOnce();
  expect(state.region.drafts.get('name')).toBe(draft);
});

it('does not requeue an explicit render as an interrupted adaptation', async () => {
  const state = fixture();
  state.region.presentationAbort = new AbortController();
  state.region.renderAbort = new AbortController();
  const pending = state.start();
  expect(state.region.pendingAdapt).not.toBe(true);
  state.beforePreview.resolve({ ok: true, value: preview });
  await pending;
  state.cancel();
});

it.each(['cancelled', 'executed'] as const)(
  'retries interrupted in-flight adaptation with latest bounds after the action is %s',
  async (outcome) => {
    const state = fixture();
    const gate = deferred<void>();
    const began = deferred<void>();
    let width = 800;
    let held = true;
    const measured: number[] = [];
    const previous = state.region.element.presentation!;
    const presentation = {
      ...previous,
      plan: { ...previous.plan, id: 'draft-form', revision: '1' },
      nodes: previous.nodes.map((node) => ({ ...node, manifest: { id: 'input.text-field', revision: '1' } })),
    };
    const prepare = vi.spyOn(presentationPlan, 'preparePresentation').mockImplementation(() => {
      measured.push(width);
      return {
        ok: true,
        value: {
          presentation,
          interaction: undefined,
          environment: {
            inlineSize: { state: 'known', value: width },
            blockSize: { state: 'unknown' },
            textScale: { state: 'unknown' },
            pointer: 'unknown',
            hover: 'unknown',
            keyboard: 'unknown',
            locale: 'en-US',
            direction: 'ltr',
            reducedMotion: false,
            forcedColors: false,
          },
        },
      } as ReturnType<typeof presentationPlan.preparePresentation>;
    });
    const publication = { apply: vi.fn(), rollback: vi.fn(), complete: vi.fn() };
    Object.assign(state.region.element, {
      ownerDocument: createRegistrationDocument(),
      preparePublication: () => publication,
    });
    Object.assign(state.context, { views: [] });
    const commit = vi.fn(async (request: RuntimePresentationInput) => {
      if (held) {
        began.resolve();
        await gate.promise;
      }
      if (request.signal?.aborted)
        return { ok: false as const, diagnostics: [{ code: 'cancelled', message: 'Interrupted', retryable: false }] };
      const next = { state: { task: request.task, presentation: request.presentation } } as RegionSnapshot;
      const applied = request.projection?.apply(next);
      if (applied !== undefined && !applied.ok) {
        request.projection?.rollback();
        return applied;
      }
      return { ok: true as const, value: next };
    });
    Object.assign(state.context.runtime, { commitPresentation: commit });
    Object.assign(state.region, {
      target: { ownerDocument: { activeElement: null } },
      last: { receipt: { task: { kind: 'form', action } }, results: [], descriptors: [] },
    });
    try {
      const adapting = adaptRegion(state.context, state.region);
      await began.promise;
      expect(state.region.pendingAdapt).toBe(false);
      width = 360;
      const pending = state.start();
      expect(state.region.pendingAdapt).toBe(true);
      gate.resolve();
      expect((await adapting)?.status).toBe('cancelled');
      state.beforePreview.resolve({ ok: true, value: preview });
      await pending;
      held = false;
      state.settled.mockImplementation((region: WebRegion) => {
        if (region.pendingAdapt) void adaptRegion(state.context, region);
      });
      if (outcome === 'cancelled') state.cancel();
      else {
        const pending = state.confirm();
        state.finish();
        await pending;
      }
      await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
      expect(measured).toEqual([800, 360]);
      expect(state.region.pendingAdapt).toBe(false);
      expect(state.region.drafts.get('name')).toBe(outcome === 'cancelled' ? draft : undefined);
      expect(state.reset).toHaveBeenCalledTimes(outcome === 'cancelled' ? 0 : 1);
      await vi.waitFor(() => expect(publication.apply).toHaveBeenCalledOnce());
      expect(state.region.element.ownerDocument.defaultView?.customElements.get('aeliqo-text-field')).toBeDefined();
    } finally {
      prepare.mockRestore();
    }
  },
);

it('resumes after a rejected action preview', async () => {
  const state = fixture();
  vi.mocked(state.port.preview).mockResolvedValueOnce({
    ok: false,
    diagnostics: [{ code: 'action.preview-denied', message: 'Preview unavailable', retryable: false }],
  });
  await state.start();
  expect(state.region.actionPending).toBe(false);
  expect(state.settled).toHaveBeenCalledOnce();
});

it('does not reset after a rejected execution', async () => {
  const state = fixture();
  const pending = await confirmed(state);
  state.execution.resolve({
    ok: false,
    diagnostics: [{ code: 'action.rejected', message: 'Rejected before write', retryable: false }],
  });
  await pending.result;
  expect(state.reset).not.toHaveBeenCalled();
  expect(state.region.drafts.get('name')).toBe(draft);
});
