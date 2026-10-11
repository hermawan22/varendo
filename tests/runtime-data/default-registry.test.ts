import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { defineResource, type Intent } from '../../packages/core/src/index.js';
import { createAeliqoRuntime } from '../../packages/runtime/src/index.js';
import { createLocalDataService } from '../../packages/runtime/src/data/index.js';

const rows = [
  { id: 'ada', team: 'Design', joined: '2026-01-12' },
  { id: 'sam', team: 'Engineering', joined: '2026-02-03' },
  { id: 'iman', team: 'Engineering', joined: '2026-02-20' },
];

function runtimeFor(functionRegistryDigest?: string) {
  const people = defineResource({
    id: 'people',
    revision: '1',
    label: 'People',
    identity: ['id'],
    schema: z.object({ id: z.string(), team: z.string(), joined: z.iso.date() }),
    fields: { team: { role: 'dimension' }, joined: { role: 'time' } },
    measures: { hires: { label: 'New hires', aggregate: 'count' } },
    ...(functionRegistryDigest === undefined ? {} : { functionRegistryDigest }),
    presentation: { allowedViews: ['table', 'trend'] },
  });
  const access = { scopeDigest: 'people:all', policyRevision: '1' };
  const data = createLocalDataService({
    snapshot: { catalog: people.catalog, sourceRevision: '1', records: { people: rows } },
    authorize: () => ({ ok: true, value: access }),
  });
  const runtime = createAeliqoRuntime({
    resources: [{ resource: people, data }],
    authority: {
      read: () => ({
        ok: true,
        value: {
          principalKey: 'me',
          ...access,
          experienceRevision: '1',
          grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
          readContext: {},
        },
      }),
    },
  });
  expect(runtime.mount({ regionId: 'main', resourceId: 'people' }).ok).toBe(true);
  return runtime;
}

const browse: Intent = { version: '1', id: 'list', kind: 'browse', resource: 'people' };
const trend: Intent = {
  version: '1',
  id: 'hires-trend',
  kind: 'analyze',
  resource: 'people',
  measures: [{ id: 'hires', revision: '1' }],
  time: { field: 'joined', grain: 'month', calendar: 'gregorian', timezone: 'UTC' },
};

describe('local data service default function registry', () => {
  it.each([undefined, 'core-query-2', 'core-standard-1'])(
    'renders browse and analyze intents with the built-in %s registry and no host wiring',
    async (digest) => {
      const runtime = runtimeFor(digest);
      for (const intent of [browse, trend]) {
        const receipt = await runtime.render({ regionId: 'main', intent });
        expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed');
      }
      runtime.dispose();
    },
  );

  it('still requires a host registry for a custom digest', async () => {
    const runtime = runtimeFor('acme-functions-7');
    const receipt = await runtime.render({ regionId: 'main', intent: browse });
    expect(receipt.status).toBe('unsupported');
    expect(receipt.diagnostics[0]?.path).toEqual(['functionRegistryDigest']);
    runtime.dispose();
  });
});
