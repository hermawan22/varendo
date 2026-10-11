import type { Intent } from '@varendo/core';
import { defineDataFeature } from '@varendo/core/features';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import {
  createAeliqoRuntime,
  createLocalDataBinding,
  type AeliqoRuntime,
  type DataSurfaceBindings,
  type SurfaceController,
  type SurfaceReadContext,
  type LocalSurfaceScope,
} from '@varendo/runtime';
import type { LocalDataService, LocalSnapshot, ResultEvent } from '@varendo/runtime/data';
import { z } from 'zod';

export const PersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  team: z.enum(['Design', 'Engineering']),
});

export type Person = z.infer<typeof PersonSchema>;

export const fixtureRows: readonly Person[] = Object.freeze([
  Object.freeze({ id: 'ada', name: 'Ada Chen', team: 'Design' as const }),
  Object.freeze({ id: 'sam', name: 'Sam Rivera', team: 'Engineering' as const }),
]);

export const updatedRows: readonly Person[] = Object.freeze([
  fixtureRows[0]!,
  Object.freeze({ id: 'sam', name: 'Sam Rivera', team: 'Design' as const }),
]);

export const peopleFeature = defineDataFeature({
  id: 'people',
  schema: PersonSchema,
  identity: ['id'],
  fields: { team: { role: 'dimension' } },
});

export interface PeopleSurfaceState {
  readonly rows: readonly Person[];
  readonly selection: readonly string[];
}

export interface PeopleFixtureContract {
  readonly runtime: AeliqoRuntime;
  readonly runtimeId: string;
  readonly scope: LocalSurfaceScope;
  readonly feature: typeof peopleFeature;
  readonly bindings: DataSurfaceBindings<PeopleSurfaceState> & { readonly service: LocalDataService };
  readonly source: LocalDataService;
  readonly initialSnapshot: LocalSnapshot;
  readonly updatedSnapshot: LocalSnapshot;
  readonly observeRows: (surface: SurfaceController<Intent, PeopleSurfaceState>) => Promise<readonly Person[]>;
  readonly observeEvidence: () => Readonly<{ readonly sourceRevision?: string; readonly resultRevision?: string }>;
  readonly setReadsAllowed: (allowed: boolean) => void;
  readonly setNormalizeWaiter: (waiter: (() => Promise<void>) | undefined) => void;
  readonly setAuthorityReadHook: (hook: ((count: number) => void) | undefined) => void;
  readonly dispose: () => void | Promise<void>;
}

let nextFixtureId = 1;

export function createPeopleFixture(): PeopleFixtureContract {
  const fixtureId = nextFixtureId++;
  const runtimeId = `people-runtime-${fixtureId}`;
  const snapshot: LocalSnapshot = Object.freeze({
    catalog: peopleFeature.catalog,
    sourceRevision: 'people-source-1',
    records: Object.freeze({ people: fixtureRows }),
  });
  const functionRegistry = createQueryFunctionRegistry({ version: '2' });
  if (!functionRegistry.ok) throw new TypeError(functionRegistry.diagnostics[0].message);
  let evidence: { sourceRevision?: string; resultRevision?: string } = {};
  let readsAllowed = true;
  let normalizeWaiter: (() => Promise<void>) | undefined;
  let authorityReads = 0;
  let authorityReadHook: ((count: number) => void) | undefined;
  const normalize = async (
    events: AsyncIterable<ResultEvent>,
    _context: SurfaceReadContext,
  ): Promise<PeopleSurfaceState> => {
    const rows: Person[] = [];
    for await (const event of events) {
      if (event.kind === 'descriptor') {
        const consistency = event.descriptor.consistency;
        const sourceRevision =
          'snapshotId' in consistency
            ? consistency.snapshotId
            : 'sourceRevisions' in consistency
              ? consistency.sourceRevisions.people
              : undefined;
        evidence = {
          resultRevision: event.descriptor.ref.revision,
          ...(sourceRevision === undefined ? {} : { sourceRevision }),
        };
      }
      if (event.kind === 'error') throw new TypeError(event.error.message);
      if (event.kind !== 'batch') continue;
      for (const row of event.rows) {
        const parsed = peopleFeature.parseRecord(row);
        if (!parsed.ok) throw new TypeError(parsed.diagnostics[0].message);
        rows.push(parsed.value);
      }
    }
    const wait = normalizeWaiter;
    normalizeWaiter = undefined;
    if (wait !== undefined) await wait();
    return { rows: Object.freeze(rows), selection: Object.freeze([]) };
  };
  const bindings = createLocalDataBinding({
    feature: peopleFeature,
    snapshot,
    initialState: Object.freeze({ rows: Object.freeze([]), selection: Object.freeze([]) }),
    coverage: {
      fields: ['id', 'name', 'team'],
      operators: ['eq', 'contains'],
      pagination: 'snapshot',
      stableOrder: ['id'],
      sorting: 'stable-fields-only',
      aggregation: 'unsupported',
      streaming: 'finite',
      updates: 'snapshot-replace',
      unsupported: ['aggregation', 'streaming', 'live-updates'],
    },
    normalize,
    serviceOptions: {
      functionRegistry: functionRegistry.value,
      authorize: ({ context }) =>
        readsAllowed && context.principal === 'local-user'
          ? { ok: true, value: { scopeDigest: `people-local-${fixtureId}`, policyRevision: 'local-policy-1' } }
          : {
              ok: false,
              diagnostics: [{ code: 'data.denied', message: 'The local read was not authorized.', retryable: false }],
            },
    },
  });
  const source = bindings.service;
  const runtime = createAeliqoRuntime({
    runtimeId,
    resources: [{ resource: peopleFeature.resource, data: source }],
    authority: {
      read: () => {
        authorityReads += 1;
        authorityReadHook?.(authorityReads);
        return {
          ok: true,
          value: {
            principalKey: 'local-user',
            scopeDigest: `people-local-${fixtureId}`,
            policyRevision: 'local-policy-1',
            experienceRevision: 'local-experience-1',
            grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
            readContext: { principal: 'local-user' },
          },
        };
      },
    },
  });
  const scope = runtime.createLocalSurfaceScope({
    id: `people-local-${fixtureId}`,
    allowedFeatures: ['people', 'report'],
  });
  return {
    runtime,
    runtimeId,
    scope,
    feature: peopleFeature,
    bindings,
    source,
    initialSnapshot: snapshot,
    updatedSnapshot: Object.freeze({
      catalog: peopleFeature.catalog,
      sourceRevision: 'people-source-2',
      records: Object.freeze({ people: updatedRows }),
    }),
    observeRows: async (surface) => surface.getSnapshot().state.rows,
    observeEvidence: () => Object.freeze({ ...evidence }),
    setReadsAllowed: (allowed) => {
      readsAllowed = allowed;
    },
    setNormalizeWaiter: (waiter) => {
      normalizeWaiter = waiter;
    },
    setAuthorityReadHook: (hook) => {
      authorityReadHook = hook;
    },
    dispose: () => {
      runtime.dispose();
      scope.dispose();
    },
  };
}
