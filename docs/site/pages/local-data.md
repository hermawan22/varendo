---
id: 'local-data'
path: '/guides/local-data/'
section: 'Guides'
title: 'Local data service'
description: 'Evaluate canonical queries over a bounded, application-owned snapshot with no network and no AI.'
---

<p class="lead">A local data service runs queries over rows your app already owns. No network, no model, no server grant.</p>

## When you need this

- You demo, test, or build offline with a fixed set of rows.
- Your app already loaded the records and knows the signed-in user may see them.
- You want the same query contract as a server, without running a server.

## 1. Render a local array in React

For a small dataset your app already owns, wrap the array with `useDataSurface` and render `AdaptiveSurface`.

```tsx
import { AdaptiveSurface, useDataSurface } from '@varendo/react/surface';

type Person = { id: string; name: string; team: string };

export function People({ rows }: { rows: readonly Person[] }) {
  const surface = useDataSurface({ data: rows, getRowId: (row) => row.id });
  return <AdaptiveSurface surface={surface} />;
}
```

`getRowId` must return one real scalar field from each row. You should see: a table of your rows that adapts to its container.

Update rows by passing a new array. If you mutate the same array in place, bump the hook's `version` option so the surface notices. For an empty starting array, also pass a Zod `schema` and the identity field name. A `getRowId` callback cannot reveal its field until a row exists.

The server-rendered first view already shows read-only cells. The client starts its source-backed controller after commit. An invalid update reports a diagnostic and keeps the last authorized result. See the [React package guide](https://github.com/hermawan22/varendo/blob/main/docs/packages/react.md) for the hook's complete contract. The [React quickstart](/start/) uses a registered resource instead, for filtering and charting the same dataset.

## 2. Own the surface outside React

`createLocalDataSurface` gives you the same surface without a provider. It owns its runtime and scope, so call it from your UI lifecycle and dispose it when done.

```ts
import { createLocalDataSurface } from '@varendo/runtime/surfaces';

const owned = createLocalDataSurface({ data: rows, getRowId: (row) => row.id });
await owned.surface.request({ kind: 'browse' });
const update = owned.replaceData(nextRows);
if (update.ok) await owned.surface.request({ kind: 'browse' });
owned.dispose();
```

Rows need a consistent scalar shape and unique identities. An invalid `replaceData` keeps the last committed rows and returns a diagnostic. This local scope grants no server authority and fetches nothing remote.

## 3. Serve a registered resource

For a named resource with permissions, create a `LocalDataService` — a real `DataService` over an in-memory snapshot.

**data.ts**

```ts
import { createLocalDataService } from '@varendo/runtime/data';

const data = createLocalDataService({
  snapshot: {
    catalog: people.catalog,
    sourceRevision: 'people-data-1',
    records: { people: permittedRecords },
  },
  functionRegistry,
  sourceLimits: { rows: 1_000, bytes: 1_000_000 },
  authorize: ({ context }) => authorizePeople(context.principal),
});
```

`snapshot.catalog` comes from the resource (`people.catalog`). `sourceLimits` caps what the snapshot may hold. `authorize` runs on every request — it reads `context.principal`, the signed-in user your app supplied, and returns a grant or a denial. See [permissions](/guides/permissions/).

## 4. Bind it to a scoped surface

For a scoped surface, build the binding once. Its `service` is the exact service the controller mounts, so source revisions and result events stay on one path.

```ts
import { z } from 'zod';
import { defineDataFeature } from '@varendo/core/features';
import { createVarendoRuntime } from '@varendo/runtime/app';
import { createLocalDataBinding } from '@varendo/runtime/surfaces';
import type { DataRecord, ResultEvent } from '@varendo/runtime/data';

const peopleFeature = defineDataFeature({
  id: 'people',
  identity: ['id'],
  schema: z.object({ id: z.string(), name: z.string(), team: z.string() }),
});

const permittedRecords = [
  { id: 'p-1', name: 'Ada Chen', team: 'Design' },
  { id: 'p-2', name: 'Sam Rivera', team: 'Engineering' },
];

const authority = {
  read: () => ({
    ok: true as const,
    value: {
      principalKey: 'local-user',
      scopeDigest: 'local-session',
      policyRevision: 'policy-1',
      experienceRevision: 'local-1',
      grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
      readContext: { principal: 'local-user' },
    },
  }),
};

async function readPeopleRows(events: AsyncIterable<ResultEvent>) {
  const rows: DataRecord[] = [];
  for await (const event of events) {
    if (event.kind === 'batch') rows.push(...event.rows);
    if (event.kind === 'error') throw new Error(event.error.message);
  }
  return { rows };
}

const bindings = createLocalDataBinding({
  feature: peopleFeature,
  snapshot: { catalog: peopleFeature.catalog, sourceRevision: 'people-1', records: { people: permittedRecords } },
  initialState: { rows: [] },
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
  normalize: readPeopleRows,
});

const runtime = createVarendoRuntime({
  resources: [{ resource: peopleFeature.resource, data: bindings.service }],
  authority,
});
const scope = runtime.createLocalSurfaceScope();
const peopleSurface = runtime.createSurface({ scope, id: 'people', feature: peopleFeature, bindings });
await peopleSurface.request({ kind: 'browse' });
```

`coverage` declares what the source honestly supports — fields, operators, pagination mode, stable ordering, and anything unsupported. `normalize` turns the result event stream into your surface state. A real `authority` adapter reads the signed-in user instead of returning a fixed value — see [permissions](/guides/permissions/).

## 5. Replace the snapshot

The binding copies and freezes each snapshot. Swap data by calling `replaceSnapshot` with a new source revision, then request again — the controller and address stay stable.

```ts
const update = bindings.service.replaceSnapshot({
  catalog: peopleFeature.catalog,
  sourceRevision: 'people-2',
  records: { people: nextRows },
});
if (update.ok) await peopleSurface.request({ kind: 'browse' });
```

Same revision with equal content is a no-op. Changed content at a repeated revision is rejected atomically (`data.source-revision-conflict`) and the last committed rows stay visible. Revisions are single-use for the service lifetime: `maxSourceRevisions` caps the history at 256 by default, configurable up to 10,000. A rollback uses a fresh revision with the old rows — do not reuse an old revision.

Trusted sources with canonical increasing numeric revisions can use `revisionMode: { kind: 'monotonic', prefix: 'people-' }`. That mode keeps only a high-water mark. Stale or malformed revisions fail with `data.source-revision-sequence`.

## Keep it limited

The snapshot is not a client-side database mirror. Set row and byte limits in `sourceLimits`; each request also carries query and result budgets. A page or row limit returns explicit partial coverage. It carries a reason, the population when known, and a continuation cursor when available. A byte budget that cannot fit a response returns `data.budget` instead of silently truncating. Declared nullable schema fields accept null values. Dispose materialized results when the region or authority context changes.

## What can go wrong

- An empty starting array without a schema fails with `data.shape-empty`. Pass `schema` and `identity`.
- Rows with inconsistent keys or types fail with `data.shape-inconsistent`. Nested objects, getters, and executable hooks fail with other `data.shape-*` codes.
- Duplicate or missing identities fail with `data.identity-duplicate` or `data.identity-missing`.
- An unsupported query returns a diagnostic without mutating the current region.
- A denied request or failed replacement keeps the last committed rows. That holds only while the same authorized surface address stays active — disposal and scope transitions fence late updates.

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/start/"><span>Complete quickstart</span><small>See this adapter in the compiled People example.</small><b aria-hidden="true">→</b></a><a href="/guides/http-data/"><span>Move execution server-side</span><small>Keep private source records out of the browser.</small><b aria-hidden="true">→</b></a></nav>
