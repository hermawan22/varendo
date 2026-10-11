import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineResource, type PresentationPlan } from '../../packages/core/src/index.js';
import { createQueryFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import { createAeliqoRuntime } from '../../packages/runtime/src/app/index.js';
import { createLocalDataService } from '../../packages/runtime/src/data/index.js';
import type { RuntimeRenderPreparation } from '../../packages/runtime/src/app/index.js';

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
async function setup() {
  const app = fixture();
  const runtime = createAeliqoRuntime({
    resources: [{ resource: app.resource, data: app.local }],
    authority: app.authority,
  });
  runtime.mount({ regionId: 'main', resourceId: 'people' });
  const first = await runtime.render({ regionId: 'main', intent: browse('first') });
  if (first.status !== 'committed') throw Error(JSON.stringify(first));
  return { ...app, runtime, first, previous: runtime.snapshot('main')! };
}
it.each(['apply', 'final-authority'] as const)('rejects source replacement during %s', async (boundary) => {
  const state = await setup();
  const rollback = vi.fn();
  const result = await state.runtime.render(
    { regionId: 'main', intent: browse('next') },
    {
      prepare: (input) => ({
        ok: true,
        value: {
          presentation: plan(input),
          apply() {
            const replace = () =>
              expect(
                state.local.replaceSnapshot({
                  catalog: state.resource.catalog,
                  sourceRevision: 'people-source-2',
                  records: { people: [{ id: 'p3', name: 'New source', team: 'Platform' }] },
                }).ok,
              ).toBe(true);
            if (boundary === 'apply') replace();
            else state.onAuthorityRead(replace);
            return ok();
          },
          rollback,
        },
      }),
    },
  );
  expect(result.status).not.toBe('committed');
  expect(rollback).toHaveBeenCalledOnce();
  expect(state.runtime.snapshot('main')?.task).toEqual(state.previous.task);
  expect(state.runtime.snapshot('main')?.region).toEqual(state.previous.region);
  state.runtime.dispose();
});
