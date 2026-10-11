import { describe, expect, it, vi } from 'vitest';
import type { InteractionPayload } from '../../packages/core/src/index.js';
import type { RuntimeRenderInput, RuntimeRenderReceipt } from '../../packages/runtime/src/app/types.js';
import type { AeliqoAppOptions } from '../../packages/web/src/app/types.js';
import type { WebAppContext, WebRegion } from '../../packages/web/src/app/context.js';
import { renderRequest } from '../../packages/web/src/app/render.js';

const intent = { version: '1', id: 'next', kind: 'browse', resource: 'people', fields: ['name'] };
const draft: Extract<InteractionPayload, { kind: 'draft' }> = {
  kind: 'draft',
  entity: 'people',
  key: 'ada',
  field: 'name',
  value: 'Edited Ada',
  entityRevision: 'entity-1',
};
const authority = {
  principalKey: 'user',
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1',
  experienceRevision: 'web-1',
  grants: ['task.evaluate', 'experience.commit'],
  readContext: {},
};

function fixture(onDraftExit?: AeliqoAppOptions['onDraftExit']) {
  const previous = { marker: 'previous presentation' };
  const element = { presentation: previous, revoke: vi.fn(), interaction: { marker: 'dirty state' } };
  const region = {
    id: 'main',
    resourceId: 'people',
    sequence: 0,
    draftRevision: 1,
    values: new Map(),
    drafts: new Map([['name', draft]]),
    element,
  } as unknown as WebRegion;
  const render = vi.fn(async (_input: RuntimeRenderInput): Promise<RuntimeRenderReceipt> => ({
    status: 'failed' as const,
    regionId: 'main',
    requestId: 'target',
    diagnostics: [{ code: 'fixture.target-failed', message: 'Target failure', retryable: false }],
  }));
  const read = vi.fn<AeliqoAppOptions['authority']['read']>(() => ({ ok: true, value: authority }));
  const context = {
    options: { authority: { read }, ...(onDraftExit ? { onDraftExit } : {}) },
    runtime: { render, snapshot: () => undefined },
    regions: new Map([['main', region]]),
    disposed: false,
  } as unknown as WebAppContext;
  return { context, region, render, read, element, previous };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('app draft exit', () => {
  it('asks for input before evaluating a new intent when a blurred draft remains', async () => {
    const state = fixture();
    const result = await renderRequest(state.context, { regionId: 'main', intent });
    expect(result.status).toBe('needs-input');
    expect(state.render).not.toHaveBeenCalled();
    expect(state.region.drafts.get('name')).toBe(draft);
    expect(state.element.presentation).toBe(state.previous);
  });

  it.each(['stay', 'clean', 'needs-input'] as const)('retains owned drafts on %s', async (status) => {
    const state = fixture(() => ({ status }));
    const result = await renderRequest(state.context, { regionId: 'main', intent });
    expect(result.status).toBe('needs-input');
    expect(state.render).not.toHaveBeenCalled();
    expect(state.region.drafts.size).toBe(1);
  });

  it('allows explicit discard but retains drafts and UI if the target fails', async () => {
    const state = fixture(() => ({ status: 'discard' }));
    const result = await renderRequest(state.context, { regionId: 'main', intent });
    expect(state.render).toHaveBeenCalledOnce();
    expect(result.status).toBe('failed');
    expect(state.region.drafts.get('name')).toBe(draft);
    expect(state.element.presentation).toBe(state.previous);
  });

  it('saves before evaluation and retains drafts if target presentation fails', async () => {
    const order: string[] = [];
    const save = vi.fn(() => {
      order.push('save');
      return { ok: true as const, value: undefined };
    });
    const state = fixture(() => ({ status: 'save', save }));
    state.render.mockImplementation(async () => {
      order.push('render');
      return { status: 'failed', regionId: 'main', requestId: 'target', diagnostics: [] };
    });
    await renderRequest(state.context, { regionId: 'main', intent });
    expect(order).toEqual(['save', 'render']);
    expect(state.read.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(state.region.drafts.get('name')).toBe(draft);
  });

  it('keeps the current UI and draft after a failed or thrown save', async () => {
    for (const save of [
      () => ({
        ok: false as const,
        diagnostics: [{ code: 'save.conflict', message: 'Conflict', retryable: false }] as const,
      }),
      () => {
        throw new Error('save failed');
      },
    ]) {
      const state = fixture(() => ({ status: 'save', save }));
      const result = await renderRequest(state.context, { regionId: 'main', intent });
      expect(result.status).toBe('failed');
      expect(state.render).not.toHaveBeenCalled();
      expect(state.region.drafts.get('name')).toBe(draft);
      expect(state.element.presentation).toBe(state.previous);
    }
  });

  it('fences a newer draft even when the host decision ignores cancellation', async () => {
    const decision = deferred<{ status: 'discard' }>();
    const state = fixture(() => decision.promise);
    const request = renderRequest(state.context, { regionId: 'main', intent });
    state.region.drafts.set('name', { ...draft, value: 'New edit' });
    state.region.draftRevision = 2;
    decision.resolve({ status: 'discard' });
    expect((await request).status).toBe('cancelled');
    expect(state.render).not.toHaveBeenCalled();
    expect(state.region.drafts.get('name')?.value).toBe('New edit');
  });

  it('cancels a pending guard promptly when the caller aborts', async () => {
    const state = fixture(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = renderRequest(state.context, { regionId: 'main', intent, signal: controller.signal });
    controller.abort();
    expect((await pending).status).toBe('cancelled');
    expect(state.render).not.toHaveBeenCalled();
  });

  it('replaces a pending guard with a newer render request', async () => {
    let firstSignal: AbortSignal | undefined;
    let calls = 0;
    const state = fixture((request) => {
      calls++;
      if (calls === 1) {
        firstSignal = request.signal;
        return new Promise(() => {});
      }
      return { status: 'stay' };
    });
    const first = renderRequest(state.context, { regionId: 'main', intent });
    const second = renderRequest(state.context, { regionId: 'main', intent: { ...intent, id: 'newer' } });
    expect((await first).status).toBe('cancelled');
    expect((await second).status).toBe('needs-input');
    expect(firstSignal?.aborted).toBe(true);
    expect(state.render).not.toHaveBeenCalled();
  });

  it('does not execute a save after authority changes during the host decision', async () => {
    const decision = deferred<{ status: 'save'; save: () => { ok: true; value: undefined } }>();
    const save = vi.fn(() => ({ ok: true as const, value: undefined }));
    const state = fixture(() => decision.promise);
    const pending = renderRequest(state.context, { regionId: 'main', intent });
    state.read.mockReturnValue({ ok: true, value: { ...authority, scopeDigest: 'another-scope' } });
    decision.resolve({ status: 'save', save });
    expect((await pending).status).toBe('denied');
    expect(save).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
    expect(state.element.revoke).toHaveBeenCalled();
    expect(state.region.drafts.size).toBe(0);
  });

  it('passes detached immutable intent and draft snapshots to the host', async () => {
    const source = { ...intent, fields: ['name'] };
    let observed = false;
    const state = fixture((request) => {
      observed = true;
      expect(Object.isFrozen(request.intent)).toBe(true);
      expect(Object.isFrozen(request.drafts)).toBe(true);
      expect(Object.isFrozen(request.drafts[0])).toBe(true);
      source.fields.push('unexpected');
      return { status: 'discard' };
    });
    await renderRequest(state.context, { regionId: 'main', intent: source });
    expect(state.render.mock.calls[0]?.[0]).toMatchObject({ intent: { fields: ['name'] } });
    expect(Object.isFrozen(draft)).toBe(false);
    expect(observed).toBe(true);
  });
  it('does not save when permission is revoked before a dirty exit begins', async () => {
    const onExit = vi.fn(() => ({ status: 'discard' as const }));
    const state = fixture(onExit);
    state.read.mockImplementation(() => {
      throw new Error('Revoked');
    });
    expect((await renderRequest(state.context, { regionId: 'main', intent })).status).toBe('denied');
    expect(onExit).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
    expect(state.region.drafts.size).toBe(0);
    expect(state.element.revoke).toHaveBeenCalledOnce();
  });

  it('rechecks authorization after a delayed successful save', async () => {
    const saved = deferred<{ ok: true; value: undefined }>();
    const saveStarted = deferred<void>();
    const state = fixture(() => ({
      status: 'save',
      save: () => {
        saveStarted.resolve();
        return saved.promise;
      },
    }));
    const pending = renderRequest(state.context, { regionId: 'main', intent });
    await saveStarted.promise;
    state.read.mockReturnValue({ ok: true, value: { ...authority, grants: [] } });
    saved.resolve({ ok: true, value: undefined });
    expect((await pending).status).toBe('denied');
    expect(state.render).not.toHaveBeenCalled();
    expect(state.element.revoke).toHaveBeenCalled();
  });

  it('retains a newer draft after the old draft save finishes', async () => {
    const saved = deferred<{ ok: true; value: undefined }>();
    const saveStarted = deferred<void>();
    const state = fixture(() => ({
      status: 'save',
      save: () => {
        saveStarted.resolve();
        return saved.promise;
      },
    }));
    const pending = renderRequest(state.context, { regionId: 'main', intent });
    await saveStarted.promise;
    state.region.drafts.set('name', { ...draft, value: 'Typed during save' });
    state.region.draftRevision = 2;
    saved.resolve({ ok: true, value: undefined });
    expect((await pending).status).toBe('cancelled');
    expect(state.render).not.toHaveBeenCalled();
    expect(state.region.drafts.get('name')?.value).toBe('Typed during save');
  });

  it('stops a pending host callback on disposal without waiting for it', async () => {
    const started = deferred<void>();
    const state = fixture(() => {
      started.resolve();
      return new Promise(() => {});
    });
    const pending = renderRequest(state.context, { regionId: 'main', intent });
    await started.promise;
    state.context.disposed = true;
    state.region.renderAbort?.abort();
    expect((await pending).status).toBe('cancelled');
    expect(state.render).not.toHaveBeenCalled();
  });

  it('preserves denied status when runtime revocation aborts a host callback', async () => {
    const started = deferred<void>();
    const state = fixture(() => {
      started.resolve();
      return new Promise(() => {});
    });
    const pending = renderRequest(state.context, { regionId: 'main', intent });
    await started.promise;
    state.context.runtime.snapshot = () => ({
      regionId: 'main',
      resourceId: 'people',
      phase: 'denied',
      results: [],
      diagnostics: [],
    });
    state.region.renderAbort?.abort();
    expect((await pending).status).toBe('denied');
    expect(state.render).not.toHaveBeenCalled();
  });
  it('denies an old draft owner even when the new principal reuses scope and policy revisions', async () => {
    const onExit = vi.fn(() => ({ status: 'discard' as const }));
    const state = fixture(onExit);
    state.region.renderedAuthority = JSON.stringify([
      'previous-user',
      authority.scopeDigest,
      authority.policyRevision,
      authority.experienceRevision,
      [...authority.grants].sort(),
    ]);
    expect((await renderRequest(state.context, { regionId: 'main', intent })).status).toBe('denied');
    expect(onExit).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
    expect(state.element.revoke).toHaveBeenCalledOnce();
  });

  it('never calls save when aborted in the microtask after the exit decision', async () => {
    const controller = new AbortController();
    const save = vi.fn(() => ({ ok: true as const, value: undefined }));
    const state = fixture(() => {
      queueMicrotask(() => controller.abort());
      return { status: 'save', save };
    });
    expect((await renderRequest(state.context, { regionId: 'main', intent, signal: controller.signal })).status).toBe(
      'cancelled',
    );
    expect(save).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
  });
});

it('reauthorizes a clean new render after an earlier runtime denial', async () => {
  const state = fixture();
  state.region.drafts.clear();
  const denied = { regionId: 'main', resourceId: 'people', phase: 'denied' as const, results: [], diagnostics: [] };
  state.context.runtime.snapshot = () => denied;
  const result = await renderRequest(state.context, { regionId: 'main', intent });
  expect(state.render).toHaveBeenCalledOnce();
  expect(result.status).toBe('failed');
});

it.each([{ grants: ['task.evaluate', 'result.inspect'] }, { grants: [] }])(
  'delegates operation grants to the canonical runtime: $grants',
  async ({ grants }) => {
    const state = fixture(() => ({ status: 'discard' }));
    state.read.mockReturnValue({ ok: true, value: { ...authority, grants } });
    await renderRequest(state.context, { regionId: 'main', intent });
    expect(state.render).toHaveBeenCalledOnce();
  },
);

describe('draft exit host denial diagnostics', () => {
  const diagnostics = [
    { code: 'journey.access-denied', message: 'Workspace access was revoked.', retryable: false },
  ] as const;
  it.each([true, false])('preserves initial denial and revokes current state with dirty=%s', async (dirty) => {
    const onExit = vi.fn(() => ({ status: 'discard' as const }));
    const state = fixture(onExit);
    if (!dirty) state.region.drafts.clear();
    const action = new AbortController();
    state.region.actionAbort = action;
    state.region.actionPending = true;
    state.read.mockReturnValue({ ok: false, diagnostics });
    const result = await renderRequest(state.context, { regionId: 'main', intent });
    expect(result).toMatchObject({ status: 'denied', diagnostics });
    expect(state.render).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
    expect(state.element.revoke).toHaveBeenCalledOnce();
    expect(state.region.drafts.size).toBe(0);
    expect(action.signal.aborted).toBe(true);
    expect(state.region.actionPending).toBe(false);
  });
  it('preserves denial before save without executing the host effect', async () => {
    const decision = deferred<{ status: 'save'; save: () => Promise<{ ok: true; value: undefined }> }>();
    const save = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const state = fixture(() => decision.promise);
    const pending = renderRequest(state.context, { regionId: 'main', intent });
    state.read.mockReturnValue({ ok: false, diagnostics });
    decision.resolve({ status: 'save', save });
    expect(await pending).toMatchObject({ status: 'denied', diagnostics });
    expect(save).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
  });
  it('preserves denial after a successful host save and does not evaluate target', async () => {
    const saved = deferred<{ ok: true; value: undefined }>();
    const started = deferred<void>();
    const state = fixture(() => ({
      status: 'save',
      save: () => {
        started.resolve();
        return saved.promise;
      },
    }));
    const pending = renderRequest(state.context, { regionId: 'main', intent });
    await started.promise;
    state.read.mockReturnValue({ ok: false, diagnostics });
    saved.resolve({ ok: true, value: undefined });
    expect(await pending).toMatchObject({ status: 'denied', diagnostics });
    expect(state.render).not.toHaveBeenCalled();
  });
  it('uses runtime revocation diagnostics even when the host decision ignores abort', async () => {
    const state = fixture(() => new Promise(() => {}));
    const pending = renderRequest(state.context, { regionId: 'main', intent });
    state.context.runtime.snapshot = () => ({
      regionId: 'main',
      resourceId: 'people',
      phase: 'denied',
      results: [],
      diagnostics,
    });
    state.region.renderAbort?.abort();
    expect(await pending).toMatchObject({ status: 'denied', diagnostics });
    expect(state.render).not.toHaveBeenCalled();
  });
  it('returns a generic safe diagnostic when the host authority callback throws', async () => {
    const state = fixture();
    state.read.mockImplementation(() => {
      throw Error('private-host-details');
    });
    const result = await renderRequest(state.context, { regionId: 'main', intent });
    expect(result).toMatchObject({ status: 'denied', diagnostics: [{ code: 'web.app.draft-denied' }] });
    expect(JSON.stringify(result)).not.toContain('private-host-details');
    expect(state.element.revoke).toHaveBeenCalledOnce();
  });
});
