import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineResource, type PresentationPlan } from '../../packages/core/src/index.js';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import { createAeliqoRuntime } from '../../packages/runtime/src/app/index.js';
import { createLocalDataService } from '../../packages/runtime/src/data/index.js';
import type {
  RuntimeRenderPreparation,
  RuntimeRenderOptions,
  RuntimePreparedRender,
} from '../../packages/runtime/src/app/index.js';
import { standardDataRecipe } from '../../packages/web/src/recipes/index.js';
import type { WebAppContext, WebRegion } from '../../packages/web/src/app/context.js';
import { createRenderTransaction } from '../../packages/web/src/app/render-transaction.js';
import { createResultStore, type ResultStore, type ResultLease } from '../../packages/runtime/src/results/index.js';
import type { RegionSnapshot } from '../../packages/runtime/src/regions/index.js';
import { createRegistrationDocument } from './registration-document.js';

function fixture() {
  const resource = defineResource({
    id: 'people',
    label: 'People',
    revision: 'people-1',
    identity: ['id'],
    schema: z.object({ id: z.string(), name: z.string(), team: z.string() }),
    fields: { team: { role: 'dimension' } },
    presentation: { allowedViews: ['table', 'cards'], preferred: { browse: 'table' } },
    forms: {
      create: { schema: { id: 'people.create', revision: '1' }, action: { id: 'people.create', revision: '1' } },
    },
  });
  const registry = createQueryFunctionRegistry({ version: '2' });
  if (!registry.ok) throw new Error('Registry unavailable.');
  let principal = 'alice';
  let permitted = true;
  let onAuthorityRead: (() => void) | undefined;
  const local = createLocalDataService({
    snapshot: {
      catalog: resource.catalog,
      sourceRevision: 'people-source-1',
      records: {
        people: [
          { id: 'p1', name: 'Ada', team: 'Platform' },
          { id: 'p2', name: 'Grace', team: 'Research' },
        ],
      },
    },
    functionRegistry: registry.value,
    authorize: ({ context }) =>
      permitted && context.principal === principal
        ? { ok: true, value: { scopeDigest: `scope-${principal}`, policyRevision: 'policy-1' } }
        : { ok: false, diagnostics: [{ code: 'data.denied', message: 'Denied.', retryable: false }] },
  });
  const authority = {
    read: () => {
      const callback = onAuthorityRead;
      onAuthorityRead = undefined;
      callback?.();
      return permitted
        ? {
            ok: true as const,
            value: {
              principalKey: principal,
              scopeDigest: `scope-${principal}`,
              policyRevision: 'policy-1',
              experienceRevision: 'experience-1',
              grants: ['task.evaluate', 'result.inspect'],
              readContext: { principal },
            },
          }
        : {
            ok: false as const,
            diagnostics: [{ code: 'runtime.authority-denied', message: 'Denied.', retryable: false }] as const,
          };
    },
  };
  return {
    onAuthorityRead(callback: () => void) {
      onAuthorityRead = callback;
    },
    resource,
    local,
    authority,
    setPrincipal(value: string) {
      principal = value;
    },
    setPermitted(value: boolean) {
      permitted = value;
    },
  };
}

const browse = (id: string, search?: string) =>
  ({
    version: '1',
    id,
    resource: 'people',
    kind: 'browse',
    fields: ['name', 'team'],
    ...(search === undefined ? {} : { search: { text: search, fields: ['team'] } }),
  }) as const;

const ok = () => ({ ok: true as const, value: undefined });
const reject = () => ({
  ok: false as const,
  diagnostics: [{ code: 'test.unsupported', message: 'Unsupported target.', retryable: false }] as const,
});
function plan(input: RuntimeRenderPreparation): PresentationPlan {
  const { dataRevision: _dataRevision, ...pins } = input.current;
  return {
    id: 'test-plan',
    revision: '1',
    rootId: 'table',
    preconditions: pins,
    nodes: [
      {
        id: 'table',
        role: 'table',
        representation: { id: 'data.table', revision: '1' },
        result: input.outputs[0]!.ref,
        config: { schema: { id: 'data.table.config', revision: '1' }, values: { columns: ['id', 'name'] } },
        children: [],
      },
    ],
    links: [],
    coverage: [],
    stateTransfer: [],
    diagnostics: [],
  };
}
async function setup(resultStore?: ResultStore) {
  const app = fixture();
  const runtime = createAeliqoRuntime({
    resources: [{ resource: app.resource, data: app.local }],
    authority: app.authority,
    ...(resultStore === undefined ? {} : { resultStore }),
  });
  runtime.mount({ regionId: 'main', resourceId: 'people' });
  const first = await runtime.render({ regionId: 'main', intent: browse('first') });
  if (first.status !== 'committed') throw Error(JSON.stringify(first));
  return { ...app, runtime, first, previous: runtime.snapshot('main')! };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { resolve, promise };
}

it('rejects preparation before publishing a new canonical task or snapshot', async () => {
  const state = await setup();
  const prepare = vi.fn(reject);
  const result = await state.runtime.render({ regionId: 'main', intent: browse('next') }, { prepare });
  expect(prepare).toHaveBeenCalledOnce();
  expect(result.status).toBe('unsupported');
  expect(state.runtime.snapshot('main')).toBe(state.previous);
  state.runtime.dispose();
});
it('publishes task, presentation and interaction with one exact prospective snapshot', async () => {
  const state = await setup();
  let applied: RegionSnapshot | undefined;
  let prepared: RuntimeRenderPreparation | undefined;
  const rollback = vi.fn();
  const result = await state.runtime.render(
    { regionId: 'main', intent: browse('next') },
    {
      prepare(input) {
        prepared = input;
        expect(input.task.revision).toBe(input.current.taskRevision);
        return {
          ok: true,
          value: {
            presentation: plan(input),
            interaction: { version: '1', values: [], drafts: [] },
            apply(next) {
              expect(state.runtime.snapshot('main')?.task?.id).not.toBe('next');
              applied = next;
              return ok();
            },
            rollback,
          },
        };
      },
    },
  );
  expect(result.status).toBe('committed');
  if (result.status !== 'committed') throw Error(JSON.stringify(result));
  expect(prepared?.signal.aborted).toBe(false);
  expect(result.region).toStrictEqual(applied);
  expect(result.region.state?.task.id).toBe('next');
  expect(result.region.state?.presentation?.preconditions.taskRevision).toBe(result.task.revision);
  expect(result.region.state?.interaction).toEqual({ version: '1', values: [], drafts: [] });
  expect(rollback).not.toHaveBeenCalled();
  state.runtime.dispose();
});
it.each(['failure', 'throw', 'promise'] as const)(
  'rolls back %s from synchronous apply and retains prior canonical state',
  async (kind) => {
    const state = await setup();
    let visible = 'first';
    const rollback = vi.fn(() => {
      visible = 'first';
    });
    const apply = () => {
      visible = 'next';
      if (kind === 'throw') throw Error('broken renderer');
      if (kind === 'promise') return Promise.resolve(ok());
      return reject();
    };
    const result = await state.runtime.render(
      { regionId: 'main', intent: browse('next') },
      {
        prepare: (input) => ({
          ok: true,
          value: { presentation: plan(input), apply, rollback } as unknown as RuntimePreparedRender,
        }),
      },
    );
    expect(result.status).not.toBe('committed');
    expect(rollback).toHaveBeenCalledOnce();
    expect(visible).toBe('first');
    expect(state.runtime.snapshot('main')).toBe(state.previous);
    state.runtime.dispose();
  },
);
it.each([
  undefined,
  null,
  {},
  { ok: true },
  { ok: false, diagnostics: [] },
  { ok: true, value: { presentation: {}, apply: () => ok(), rollback: () => {} } },
])('fails malformed prepare result safely without publishing: %j', async (value) => {
  const state = await setup();
  const result = await state.runtime.render({ regionId: 'main', intent: browse('next') }, {
    prepare: () => value,
  } as unknown as RuntimeRenderOptions);
  expect(result.status).not.toBe('committed');
  expect(state.runtime.snapshot('main')).toBe(state.previous);
  state.runtime.dispose();
});
it('rolls back a prepared superseded render without restoring over the newer snapshot', async () => {
  const state = await setup();
  const waiting = deferred<void>();
  const entered = deferred<void>();
  const rollback = vi.fn();
  const apply = vi.fn(ok);
  const pending = state.runtime.render(
    { regionId: 'main', intent: browse('old') },
    {
      prepare: async (input) => {
        entered.resolve();
        await waiting.promise;
        return { ok: true, value: { presentation: plan(input), apply, rollback } };
      },
    },
  );
  await entered.promise;
  const newer = await state.runtime.render({ regionId: 'main', intent: browse('newer') });
  waiting.resolve();
  expect((await pending).status).toBe('cancelled');
  expect(apply).not.toHaveBeenCalled();
  expect(rollback).toHaveBeenCalledOnce();
  expect(state.runtime.snapshot('main')?.task?.id).toBe('newer');
  expect(newer.status).toBe('committed');
  state.runtime.dispose();
});
it.each(['superseded', 'aborted-and-settled', 'committed-previous'] as const)(
  'commits a create after a %s browse without retaining unpublished results',
  async (mode) => {
    const app = fixture();
    const runtime = createAeliqoRuntime({
      resources: [{ resource: app.resource, data: app.local }],
      authority: app.authority,
    });
    runtime.mount({ regionId: 'main', resourceId: 'people' });
    const prior =
      mode === 'committed-previous'
        ? await runtime.render({ regionId: 'main', intent: browse('published') })
        : undefined;
    const publishedRefs = prior?.status === 'committed' ? prior.region.readSet!.results : [];
    if (prior !== undefined) expect(prior.status).toBe('committed');
    const waiting = deferred<void>();
    const entered = deferred<RuntimeRenderPreparation>();
    const controller = new AbortController();
    const pending = runtime.render(
      { regionId: 'main', intent: browse('pending'), signal: controller.signal },
      {
        async prepare(candidate) {
          entered.resolve(candidate);
          await waiting.promise;
          return ok();
        },
      },
    );
    try {
      const candidate = await entered.promise;
      expect(candidate.outputs).toHaveLength(1);
      expect(candidate.current.results).toContainEqual(candidate.outputs[0]!.ref);
      if (mode === 'aborted-and-settled') {
        controller.abort();
        waiting.resolve();
        expect((await pending).status).toBe('cancelled');
      }
      let replacementCandidate: RuntimeRenderPreparation | undefined;
      const replacement = await runtime.render(
        { regionId: 'main', intent: { version: '1', id: 'create', kind: 'create', resource: 'people' } },
        {
          prepare(next) {
            replacementCandidate = next;
            return ok();
          },
        },
      );
      const committed = runtime.snapshot('main');
      waiting.resolve();
      expect((await pending).status).toBe('cancelled');
      expect(replacement.status, JSON.stringify(replacement.diagnostics)).toBe('committed');
      expect(replacementCandidate?.outputs).toEqual([]);
      expect(replacementCandidate?.current.results).toEqual(publishedRefs);
      expect(committed?.task?.id).toBe('create');
      expect(committed?.results).toEqual([]);
      expect(runtime.snapshot('main')).toBe(committed);
    } finally {
      waiting.resolve();
      await pending;
      runtime.dispose();
    }
  },
);
it('rechecks authority changed synchronously by apply before publishing', async () => {
  const state = await setup();
  const rollback = vi.fn();
  const result = await state.runtime.render(
    { regionId: 'main', intent: browse('next') },
    {
      prepare: (input) => ({
        ok: true,
        value: {
          presentation: plan(input),
          apply: () => {
            state.setPermitted(false);
            return ok();
          },
          rollback,
        },
      }),
    },
  );
  expect(result.status).not.toBe('committed');
  expect(rollback).toHaveBeenCalledOnce();
  expect(state.runtime.snapshot('main')?.phase).toBe('denied');
  expect(state.runtime.snapshot('main')?.task?.id).not.toBe('next');
  state.runtime.dispose();
});
it('rolls back apply that synchronously unmounts its target', async () => {
  const state = await setup();
  const rollback = vi.fn();
  const result = await state.runtime.render(
    { regionId: 'main', intent: browse('next') },
    {
      prepare: (input) => ({
        ok: true,
        value: {
          presentation: plan(input),
          apply: () => {
            state.runtime.unmount('main');
            return ok();
          },
          rollback,
        },
      }),
    },
  );
  expect(result.status).not.toBe('committed');
  expect(rollback).toHaveBeenCalledOnce();
  expect(state.runtime.snapshot('main')).toBeUndefined();
  state.runtime.dispose();
});
it('supports adaptive presentation projection without advancing on a failed apply', async () => {
  const state = await setup();
  let prepared: RuntimeRenderPreparation | undefined;
  await state.runtime.render(
    { regionId: 'main', intent: browse('seed') },
    {
      prepare: (input) => {
        prepared = input;
        return { ok: true, value: { presentation: plan(input), apply: () => ok(), rollback: () => {} } };
      },
    },
  );
  const snapshot = state.runtime.snapshot('main')!;
  const region = snapshot.region!;
  const rollback = vi.fn();
  const result = await state.runtime.commitPresentation({
    regionId: 'main',
    requestId: 'adapt-fail',
    task: region.state!.task,
    presentation: region.state!.presentation!,
    interaction: { version: '1', values: [], drafts: [] },
    projection: { apply: () => reject(), rollback },
  });
  expect(prepared).toBeDefined();
  expect(result.ok).toBe(false);
  expect(state.runtime.snapshot('main')).toBe(snapshot);
  expect(rollback).toHaveBeenCalledOnce();
  state.runtime.dispose();
});

it.each([undefined, null, {}, { ok: true }, { ok: true, value: 1 }, { ok: false, diagnostics: [] }])(
  'rejects malformed synchronous apply outcome: %j',
  async (value) => {
    const state = await setup();
    const rollback = vi.fn();
    const result = await state.runtime.render(
      { regionId: 'main', intent: browse('next') },
      {
        prepare: (input) => ({
          ok: true,
          value: {
            presentation: plan(input),
            apply: () => value,
            rollback,
          } as unknown as RuntimePreparedRender,
        }),
      },
    );
    expect(result.status).not.toBe('committed');
    expect(rollback).toHaveBeenCalledOnce();
    expect(state.runtime.snapshot('main')).toBe(state.previous);
    state.runtime.dispose();
  },
);

it('rejects authority principal replacement performed inside apply', async () => {
  const state = await setup();
  const rollback = vi.fn();
  const result = await state.runtime.render(
    { regionId: 'main', intent: browse('next') },
    {
      prepare: (input) => ({
        ok: true,
        value: {
          presentation: plan(input),
          apply: () => {
            state.setPrincipal('bob');
            return ok();
          },
          rollback,
        },
      }),
    },
  );
  expect(result.status).toBe('cancelled');
  expect(rollback).toHaveBeenCalledOnce();
  const snapshot = state.runtime.snapshot('main');
  expect(snapshot?.task).toBeUndefined();
  expect(snapshot?.results).toEqual([]);
  expect(snapshot?.region?.status).toBe('revoked');
  state.runtime.dispose();
});

it('rolls back a synchronous apply that aborts the request', async () => {
  const state = await setup();
  const controller = new AbortController();
  const rollback = vi.fn();
  const result = await state.runtime.render(
    { regionId: 'main', intent: browse('next'), signal: controller.signal },
    {
      prepare: (input) => ({
        ok: true,
        value: {
          presentation: plan(input),
          apply: () => {
            controller.abort();
            return ok();
          },
          rollback,
        },
      }),
    },
  );
  expect(result.status).toBe('cancelled');
  expect(rollback).toHaveBeenCalledOnce();
  expect(state.runtime.snapshot('main')).toBe(state.previous);
  state.runtime.dispose();
});

async function presented() {
  const state = await setup();
  const seed = await state.runtime.render(
    { regionId: 'main', intent: browse('seed') },
    {
      prepare: (input) => ({ ok: true, value: { presentation: plan(input), apply: ok, rollback() {} } }),
    },
  );
  if (seed.status !== 'committed') throw Error(JSON.stringify(seed));
  return { ...state, seed, previous: state.runtime.snapshot('main')! };
}

it('publishes adaptive interaction and presentation only after the projection accepts the prospective snapshot', async () => {
  const state = await presented();
  const rollback = vi.fn();
  let applied: RegionSnapshot | undefined;
  const result = await state.runtime.commitPresentation({
    regionId: 'main',
    requestId: 'adapt',
    task: state.seed.task,
    presentation: state.seed.region.state!.presentation!,
    interaction: { version: '1', values: [], drafts: [] },
    projection: {
      apply(next) {
        expect(state.runtime.snapshot('main')).toBe(state.previous);
        applied = next;
        return ok();
      },
      rollback,
    },
  });
  if (!result.ok) throw Error(JSON.stringify(result));
  expect(result.ok).toBe(true);
  expect(result.value).toStrictEqual(applied);
  expect(result.value.taskRevision).not.toBe(state.seed.task.revision);
  expect(state.runtime.snapshot('main')?.region).toBe(result.value);
  expect(rollback).not.toHaveBeenCalled();
  state.runtime.dispose();
});

it.each(['denied', 'principal', 'promise', 'abort'] as const)(
  'rejects adaptive projection %s without advancing the canonical snapshot',
  async (mode) => {
    const state = await presented();
    const controller = new AbortController();
    const rollback = vi.fn();
    const result = await state.runtime.commitPresentation({
      regionId: 'main',
      requestId: 'adapt',
      task: state.seed.task,
      presentation: state.seed.region.state!.presentation!,
      signal: controller.signal,
      projection: {
        apply() {
          if (mode === 'denied') state.setPermitted(false);
          if (mode === 'principal') state.setPrincipal('bob');
          if (mode === 'abort') controller.abort();
          return mode === 'promise' ? Promise.resolve(ok()) : ok();
        },
        rollback,
      } as unknown as RuntimePreparedRender,
    });
    expect(result.ok).toBe(false);
    expect(rollback).toHaveBeenCalledOnce();
    if (mode === 'denied' || mode === 'principal') {
      expect(state.runtime.snapshot('main')?.phase).toBe('denied');
      expect(state.runtime.snapshot('main')?.region?.status).toBe('revoked');
      expect(state.runtime.snapshot('main')?.results).toEqual([]);
    } else expect(state.runtime.snapshot('main')).toBe(state.previous);
    state.runtime.dispose();
  },
);

it('does not restore previous state over a new render reentered by recovery authority', async () => {
  const state = await setup();
  const waiting = deferred<void>();
  let newer: ReturnType<typeof state.runtime.render> | undefined;
  const rejected = await state.runtime.render(
    { regionId: 'main', intent: browse('rejected') },
    {
      prepare() {
        state.onAuthorityRead(() => {
          newer = state.runtime.render(
            { regionId: 'main', intent: browse('newer') },
            {
              prepare: async () => {
                await waiting.promise;
                return ok();
              },
            },
          );
        });
        return reject();
      },
    },
  );
  expect(rejected.status).toBe('cancelled');
  expect(state.runtime.snapshot('main')?.phase).toBe('rendering');
  waiting.resolve();
  expect((await newer)?.status).toBe('committed');
  expect(state.runtime.snapshot('main')?.task?.id).toBe('newer');
  state.runtime.dispose();
});

it('bounds committed result pins and Region leases across repeated renders through the web resolver', async () => {
  const underlying = createResultStore({ maxEntries: 32 });
  const leases = new Set<ResultLease>();
  const tracked: ResultStore = {
    ...underlying,
    begin(input) {
      const handle = underlying.begin(input);
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'retain')
            return () => {
              const lease = target.retain();
              leases.add(lease);
              return {
                get released() {
                  return lease.released;
                },
                release() {
                  lease.release();
                  leases.delete(lease);
                },
              };
            };
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  const state = await setup(tracked);
  const region = {
    id: 'main',
    resourceId: state.resource.id,
    sequence: 0,
    target: {
      lang: '',
      ownerDocument: { activeElement: null, documentElement: { lang: 'en-US' }, defaultView: null },
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
    },
    element: {
      ownerDocument: createRegistrationDocument(),
      presentation: undefined,
      results: [],
      interaction: undefined,
      viewRenderers: [],
      preparePublication: () => ({ apply() {}, rollback() {}, complete() {} }),
    },
    values: new Map(),
    drafts: new Map(),
    actionPending: false,
    actionSequence: 0,
    composing: false,
  } as unknown as WebRegion;
  const context = {
    options: { authority: state.authority },
    runtime: state.runtime,
    resources: new Map([[state.resource.id, state.resource]]),
    recipes: [standardDataRecipe],
    views: [],
    regions: new Map([['main', region]]),
    stateListeners: new Map(),
    disposed: false,
  } as unknown as WebAppContext;
  const counts: { pins: number; leases: number }[] = [];
  for (let index = 0; index < 5; index++) {
    region.sequence++;
    const transaction = createRenderTransaction(
      context,
      region,
      region.sequence,
      new AbortController().signal,
      () => undefined,
      'same-test-authority',
    );
    const receipt = await state.runtime.render(
      { regionId: 'main', intent: browse(`refresh-${index}`) },
      { prepare: transaction.prepare },
    );
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed');
    if (receipt.status !== 'committed') throw Error(JSON.stringify(receipt));
    expect(transaction.complete(receipt).status).toBe('renderer-ready');
    region.renderedAuthority = 'same-test-authority';
    transaction.close();
    counts.push({ pins: state.runtime.snapshot('main')!.results.length, leases: leases.size });
  }
  state.runtime.dispose();
  underlying.dispose();
  expect(counts).toEqual(Array.from({ length: 5 }, () => ({ pins: 1, leases: 1 })));
  expect(leases.size).toBe(0);
});
