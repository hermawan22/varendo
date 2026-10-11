import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineResource, type PresentationPlan } from '../../packages/core/src/index.js';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import { createAeliqoRuntime } from '../../packages/runtime/src/app/index.js';
import { createLocalDataService } from '../../packages/runtime/src/data/index.js';
import type { DataService } from '../../packages/runtime/src/data/index.js';

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
    read: () =>
      permitted
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
          },
  };
  return {
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

describe('createAeliqoRuntime', () => {
  it('discovers only same-principal, same-scope resources authorized for the paired Region', () => {
    const app = fixture();
    const secondary = defineResource({
      id: 'absences',
      label: 'Absence history',
      revision: 'absences-1',
      identity: ['id'],
      schema: z.object({ id: z.string(), week: z.iso.date(), absence_days: z.number().int() }),
      fields: { week: { role: 'time' }, absence_days: { role: 'measure' } },
      presentation: { allowedViews: ['table', 'trend'] },
    });
    const privateResource = defineResource({
      id: 'private-notes',
      label: 'Private notes',
      revision: 'private-1',
      identity: ['id'],
      schema: z.object({ id: z.string(), note: z.string() }),
      presentation: { allowedViews: ['table'] },
    });
    const runtime = createAeliqoRuntime({
      resources: [
        { resource: app.resource, data: app.local },
        { resource: secondary, data: app.local },
        { resource: privateResource, data: app.local },
      ],
      authority: {
        read: ({ resourceId }) =>
          resourceId === 'private-notes'
            ? { ok: false, diagnostics: [{ code: 'runtime.authority-denied', message: 'Denied.', retryable: false }] }
            : {
                ok: true,
                value: {
                  principalKey: 'alice',
                  scopeDigest: 'scope-alice',
                  policyRevision: 'policy-1',
                  experienceRevision: 'experience-1',
                  grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
                  readContext: { principal: 'alice' },
                },
              },
      },
    });
    runtime.mount({ regionId: 'main', resourceId: 'people' });
    expect(runtime.contexts('main')).toMatchObject({
      ok: true,
      value: [{ resource: { id: 'people' } }, { resource: { id: 'absences' }, views: ['table', 'trend'] }],
    });
    runtime.dispose();
  });

  it('mounts and renders a manual intent through compiler, evaluator, ResultStore, and Region commit', async () => {
    const app = fixture();
    const runtime = createAeliqoRuntime({
      resources: [{ resource: app.resource, data: app.local }],
      authority: app.authority,
    });
    expect(runtime.mount({ regionId: 'main', resourceId: 'people' })).toMatchObject({
      ok: true,
      value: { phase: 'idle' },
    });
    const states: string[] = [];
    const unsubscribe = runtime.subscribe('main', (state) => states.push(state.phase));
    const receipt = await runtime.render({ regionId: 'main', intent: browse('browse-platform', 'platform') });
    expect(receipt.status).toBe('committed');
    if (receipt.status === 'committed') {
      expect(receipt.task.kind).toBe('data');
      expect(receipt.outputs[0]?.handle.snapshot().batches.flatMap((batch) => batch.rows)).toEqual([
        { id: 'p1', name: 'Ada', team: 'Platform' },
      ]);
      expect(receipt.region.state?.task.id).toBe('browse-platform');
    }
    expect(states).toEqual(['rendering', 'committed']);
    unsubscribe();
    runtime.dispose();
  });

  it('lets a newer render replace an older pending render without a late commit', async () => {
    const app = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const delayed: DataService = {
      describe: (input, context) => app.local.describe(input, context),
      async plan(input, context) {
        calls++;
        if (calls === 1) await gate;
        return app.local.plan(input, context);
      },
      execute: (input, context) => app.local.execute(input, context),
    };
    const runtime = createAeliqoRuntime({
      resources: [{ resource: app.resource, data: delayed }],
      authority: app.authority,
    });
    runtime.mount({ regionId: 'main', resourceId: 'people' });
    const older = runtime.render({ regionId: 'main', intent: browse('older') });
    await Promise.resolve();
    const newer = runtime.render({ regionId: 'main', intent: browse('newer', 'research') });
    release();
    await expect(newer).resolves.toMatchObject({ status: 'committed', task: { id: 'newer' } });
    await expect(older).resolves.toMatchObject({ status: 'cancelled' });
    expect(runtime.snapshot('main')).toMatchObject({ phase: 'committed', task: { id: 'newer' } });
    runtime.dispose();
  });

  it('does not let a late failure or cleanup from an older render overwrite a newer pending render', async () => {
    const app = fixture();
    let releaseOlder!: () => void;
    let releaseNewer!: () => void;
    let olderStarted!: () => void;
    let newerStarted!: () => void;
    const olderGate = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    const newerGate = new Promise<void>((resolve) => {
      releaseNewer = resolve;
    });
    const olderIsRunning = new Promise<void>((resolve) => {
      olderStarted = resolve;
    });
    const newerIsRunning = new Promise<void>((resolve) => {
      newerStarted = resolve;
    });
    let calls = 0;
    const delayed: DataService = {
      describe: (input, context) => app.local.describe(input, context),
      async plan(input, context) {
        calls += 1;
        if (calls === 1) {
          olderStarted();
          await olderGate;
          throw new Error('The superseded data source completed with a late failure.');
        }
        newerStarted();
        await newerGate;
        return app.local.plan(input, context);
      },
      execute: (input, context) => app.local.execute(input, context),
    };
    const runtime = createAeliqoRuntime({
      resources: [{ resource: app.resource, data: delayed }],
      authority: app.authority,
    });
    runtime.mount({ regionId: 'main', resourceId: 'people' });
    const phases: string[] = [];
    runtime.subscribe('main', (state) => phases.push(`${state.requestId}:${state.phase}`));

    const older = runtime.render({ regionId: 'main', intent: browse('older') });
    await olderIsRunning;
    const newer = runtime.render({ regionId: 'main', intent: browse('newer') });
    await newerIsRunning;
    releaseOlder();

    await expect(older).resolves.toMatchObject({ status: 'cancelled' });
    expect(runtime.snapshot('main')).toMatchObject({ phase: 'rendering', requestId: 'render-main-2' });
    expect(phases.at(-1)).toBe('render-main-2:rendering');

    releaseNewer();
    await expect(newer).resolves.toMatchObject({ status: 'committed', task: { id: 'newer' } });
    expect(runtime.snapshot('main')).toMatchObject({ phase: 'committed', task: { id: 'newer' } });
    runtime.dispose();
  });

  it('rejects a presentation pinned to an older revision of the same Task ID', async () => {
    const app = fixture();
    const runtime = createAeliqoRuntime({
      resources: [{ resource: app.resource, data: app.local }],
      authority: app.authority,
    });
    runtime.mount({ regionId: 'main', resourceId: 'people' });
    const first = await runtime.render({ regionId: 'main', intent: browse('reused-id') });
    if (first.status !== 'committed' || first.region.readSet === undefined)
      throw new Error('Expected the first committed Task.');
    const pins = first.region.readSet;
    const oldPresentation: PresentationPlan = {
      id: 'old-presentation',
      revision: first.task.revision,
      rootId: 'root',
      preconditions: {
        scopeDigest: pins.scopeDigest,
        policyRevision: pins.policyRevision,
        taskRevision: pins.taskRevision,
        regionRevision: pins.regionRevision,
        catalogRevision: pins.catalogRevision,
        experienceRevision: pins.experienceRevision,
        functionRegistryDigest: pins.functionRegistryDigest,
        results: pins.results,
      },
      nodes: [],
      links: [],
      coverage: [],
      stateTransfer: [],
      diagnostics: [],
    };

    await expect(runtime.render({ regionId: 'main', intent: browse('reused-id') })).resolves.toMatchObject({
      status: 'committed',
    });
    await expect(
      runtime.commitPresentation({
        regionId: 'main',
        requestId: 'late-presentation',
        task: first.task,
        presentation: oldPresentation,
      }),
    ).resolves.toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.presentation-stale' }] });
    expect(runtime.snapshot('main')).toMatchObject({ phase: 'committed', task: { id: 'reused-id', revision: '2' } });
    runtime.dispose();
  });

  it('clears unauthorized results and starts a fresh Region when the principal changes', async () => {
    const app = fixture();
    const runtime = createAeliqoRuntime({
      resources: [{ resource: app.resource, data: app.local }],
      authority: app.authority,
    });
    runtime.mount({ regionId: 'main', resourceId: 'people' });
    const first = await runtime.render({ regionId: 'main', intent: browse('alice-view') });
    expect(first.status).toBe('committed');
    const old = first.status === 'committed' ? first.outputs[0]?.handle : undefined;
    app.setPrincipal('bob');
    await expect(runtime.render({ regionId: 'main', intent: browse('bob-view') })).resolves.toMatchObject({
      status: 'committed',
      task: { id: 'bob-view' },
    });
    expect(old?.snapshot().status).toBe('denied');
    app.setPermitted(false);
    await expect(runtime.render({ regionId: 'main', intent: browse('denied') })).resolves.toMatchObject({
      status: 'denied',
    });
    expect(runtime.snapshot('main')).toMatchObject({ phase: 'denied', results: [] });
    runtime.dispose();
  });

  it('moves from data to a queryless form and back without retaining a stale Result read set', async () => {
    const app = fixture();
    const runtime = createAeliqoRuntime({
      resources: [{ resource: app.resource, data: app.local }],
      authority: app.authority,
    });
    runtime.mount({ regionId: 'main', resourceId: 'people' });

    await expect(runtime.render({ regionId: 'main', intent: browse('people-list') })).resolves.toMatchObject({
      status: 'committed',
    });
    await expect(
      runtime.render({
        regionId: 'main',
        intent: { version: '1', id: 'create-person', kind: 'create', resource: 'people' },
      }),
    ).resolves.toMatchObject({ status: 'committed', task: { kind: 'form' }, outputs: [] });
    expect(runtime.snapshot('main')).toMatchObject({ phase: 'committed', results: [], task: { id: 'create-person' } });

    await expect(runtime.render({ regionId: 'main', intent: browse('people-list-again') })).resolves.toMatchObject({
      status: 'committed',
    });
    expect(runtime.snapshot('main')?.results).toHaveLength(1);
    runtime.dispose();
  });

  it('classifies an unknown registered contract as unsupported without replacing the current Result', async () => {
    const app = fixture();
    const runtime = createAeliqoRuntime({
      resources: [{ resource: app.resource, data: app.local }],
      authority: app.authority,
    });
    runtime.mount({ regionId: 'main', resourceId: 'people' });

    await expect(runtime.render({ regionId: 'main', intent: browse('valid-people') })).resolves.toMatchObject({
      status: 'committed',
    });
    const current = runtime.snapshot('main')?.results;
    await expect(
      runtime.render({
        regionId: 'main',
        intent: {
          version: '1',
          id: 'unknown-field',
          kind: 'browse',
          resource: 'people',
          fields: ['salary'],
        },
      }),
    ).resolves.toMatchObject({ status: 'unsupported', diagnostics: [{ code: 'intent.unknown-field' }] });
    expect(runtime.snapshot('main')?.results).toEqual(current);
    runtime.dispose();
  });
});
