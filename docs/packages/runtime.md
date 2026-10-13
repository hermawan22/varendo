# `@varendo/runtime`

`@varendo/runtime` coordinates intent compilation, trusted authority, bounded
data access, Results, Regions, and actions. Its domain code is usable in Node.js
and workers and does not access the DOM.

## Main entry point

```ts
import { createVarendoRuntime } from '@varendo/runtime';
import type { VarendoRuntimeOptions } from '@varendo/runtime';

const runtime = createVarendoRuntime({ resources, authority });
const mounted = runtime.mount({ regionId: 'people-main', resourceId: 'people' });
if (!mounted.ok) throw new Error(mounted.diagnostics[0].message);
```

The host supplies each resource's data adapter and a fresh authority response.
Identity, grants, policy revisions, and read context stay with the host. An
intent cannot grant itself access.

## Transactional presentation (0.6)

Most browser applications should use `createVarendoApp` from `@varendo/web/app`.
It connects the runtime transaction to the shared renderer automatically.
A custom host renderer can instead supply `RuntimeRenderOptions` to
`runtime.render(input, options)`. These types are exported from both
`@varendo/runtime` and `@varendo/runtime/app`.

The optional `prepare(candidate)` callback runs after bounded data evaluation,
before publication. It receives the candidate task, evaluated outputs, prior
Region snapshot, current read set, and cancellation signal. The current read
set includes both prior and candidate results for transition validation. Set the
new plan’s result preconditions to the results it actually depends on; copying
the entire current result set deliberately retains those older dependencies. Return a failed
`Outcome` to keep the previous authorized state. A successful preparation may
return no value (headless use), or a `RuntimePreparedRender` containing:

- `presentation`: the host-resolved plan, validated against registered contracts.
- `interaction`: optional state that belongs to that plan.
- `apply(next)`: a **synchronous** callback receiving the prospective committed
  Region snapshot; return `Outcome<void>` after applying the host presentation.
- `rollback()`: restore the previous presentation after failed application. This
  must be idempotent and must never restore content after revocation or disposal.

The runtime rechecks authority and cancellation around application, then
publishes the task, results, presentation, and interaction together. A thrown
error, failed outcome, asynchronous `apply`, or stale request rejects the
candidate and releases its resources. Ordinary failures preserve the prior
snapshot; denied or changed ownership clears inaccessible state.
`commitPresentation` accepts the same optional projection for adapting an
existing task without another data evaluation. Neither API executes agent code:
these callbacks belong to trusted application wiring.

## Scoped surfaces (0.5)

The 0.5.0 surface API adds live instances without changing the existing
app/Region compatibility path. A host creates an explicit local read-only scope
and may create multiple controllers from one immutable feature definition:

```ts
import { createVarendoRuntime } from '@varendo/runtime';
import type { DataSurfaceBindings } from '@varendo/runtime/surfaces';

const runtime = createVarendoRuntime({ runtimeId: 'app', resources, authority });
const scope = runtime.createLocalSurfaceScope({
  id: 'local-session',
  allowedFeatures: [peopleFeature.id],
});
const bindings: DataSurfaceBindings<PeopleState> = {
  initialState: { rows: [], selection: [] },
  source: {
    kind: 'data-service',
    service: peopleData,
    coverage,
    normalize: normalizePeopleResults,
  },
};
const left = runtime.createSurface({ scope, id: 'left', feature: peopleFeature, bindings });
const right = runtime.createSurface({ scope, id: 'right', feature: peopleFeature, bindings });
```

Construction is inert: it does not subscribe, start a timer, or read data.
`request()` is the explicit headless operation. Each controller owns an
immutable address containing the runtime, scope instance, activation epoch,
surface ID, and generation. Duplicate live IDs fail, remounting advances the
generation, and captured callbacks never resolve another target by feature
name. Generations come from one bounded-memory monotonic runtime sequence, so
disposed surface IDs do not leave per-ID tombstones. Data features continue
through `DataService.describe/plan/execute`; typed capability bindings cover
non-data features. Capability bindings supply a typed `initialIntent`, so the
first snapshot is truthful for both internal and external ownership without
reading an addressed host store during construction. The host can initialize
an external store from the returned controller address before its first read.

Internal ownership commits controller state through the existing runtime,
ResultStore, and Region lifecycle. External ownership reads a stable host store
and emits a correlated proposal. The host publishes acceptance or rejection
with `proposalDecision` containing the proposal ID, address, and expected
revision; firing `onProposal` or changing an unrelated host revision is not
acceptance. `request()` therefore returns `proposed` until the host explicitly
decides. Stale, denied, cancelled, disposed, unsupported, and failed outcomes
are explicit and do not retarget another instance. Pending proposals capture
the scope permission revision and are retired if that authority changes before
acceptance. Denied snapshots expose the binding's copied `initialState` rather
than stale rows or an untyped `undefined` value. Observer exceptions cannot
interrupt request completion or teardown.

`createLocalSurfaceScope` grants only the feature IDs named by the application;
it is not a remote credential or tenant selector. Backend authorization remains
authoritative for every data operation. Dispose controllers, the scope, and
finally the owning runtime; every dispose operation is idempotent.

### Canonical local data binding

For a bounded providerless data array, `createLocalDataSurface` owns a local
runtime, scope, source, and controller. Construct it in a committed UI effect
or an imperative owner, then explicitly request browse. It never supplies
remote permissions:

```ts
import { createLocalDataSurface } from '@varendo/runtime/surfaces';

const owned = createLocalDataSurface({ data: rows, getRowId: (row) => row.id });
await owned.surface.request({ kind: 'browse' });
// A new array reference may replace data while retaining the controller address.
const accepted = owned.replaceData(updatedRows);
if (accepted.ok) await owned.surface.request({ kind: 'browse' });
owned.dispose();
```

Rows need one real scalar identity field and a bounded, consistent scalar
shape. A declared Zod object schema can fix the shape of nullable fields;
an initially empty array also needs `identity: 'id'` (or the actual declared
identity field) because `getRowId` cannot be observed without a row. Invalid replacements
leave the last committed state in place. `replaceData` returns a diagnostic if
its safe integer revision sequence is exhausted; callers must surface that
failure and must not present old rows as a successful refresh. The local helper
uses an opt-in monotonically increasing source revision sequence, so ordinary
long-lived updates do not consume the general service's 256-ID history cap.

For an application-owned snapshot, use the one public convenience adapter so
the surface, `LocalDataService`, ResultStore, and Region lifecycle share one
source and one address:

```ts
import { createLocalDataBinding } from '@varendo/runtime/surfaces';

const bindings = createLocalDataBinding({
  feature: peopleFeature,
  snapshot: { catalog: peopleFeature.catalog, sourceRevision: 'people-1', records: { people: rows } },
  initialState: { rows: [], selection: [] },
  coverage,
  normalize: normalizePeopleResults,
});
const surface = runtime.createSurface({
  scope,
  id: 'people-main',
  feature: peopleFeature,
  bindings,
});
```

`bindings.service` is the exact service mounted by the surface. Replacing its
snapshot is explicit: the input is copied and frozen, a new `sourceRevision`
is required for changed records, and equivalent catalog-plus-record content at
the same revision is a no-op that retains plans and registered meanings. A
same-revision conflict, a feature/catalog mismatch, an invalid shape, or a
capacity violation is rejected atomically, leaving the last committed surface
state and address intact. The replacement returns an `Outcome`; use it before
issuing a new request:

```ts
const replaced = bindings.service.replaceSnapshot({
  catalog: peopleFeature.catalog,
  sourceRevision: 'people-2',
  records: { people: nextRows },
});
if (!replaced.ok) throw new Error(replaced.diagnostics[0].message);
await surface.request({ kind: 'browse' });
// surface.address is unchanged; rows now come from people-2.
```

Local snapshots use `pagination: 'snapshot'`: they are complete bounded
application-owned inputs, not remote cursors. Query and page budgets can still
produce explicit partial results: the descriptor carries `coverage.kind` and
`coverage.reason`, `counts.population` is exact when the source is complete,
and a page can carry a continuation cursor. If even one row cannot fit the
response byte budget, execution returns a `data.budget` diagnostic; results
never silently truncate. `maxSourceRevisions` defaults to 256 and is bounded at
10,000; it caps the service lifetime's non-reusable revision history. A cap
failure preserves the current snapshot, and a deliberate rollback uses a
fresh revision.

An application with a trusted monotonically numbered source can opt into
`revisionMode: { kind: 'monotonic', prefix: 'people-' }` on the
local service. The initial source revision and every replacement must use that
prefix followed by a canonical positive safe integer. Changed content at a
repeated sequence, a stale sequence, or a malformed sequence is rejected;
exactly equivalent content at the current revision remains a no-op. This mode
retains a high-water mark instead of storing every old revision ID; the default
arbitrary-revision history and its cap remain unchanged.

The binding validates bounded scalar structure before it can emit a result:
empty/no-schema, schema-less all-null fields, nested/accessor/executable rows, invalid identifiers,
ambiguous or duplicate identities, and row/byte source limits are explicit
diagnostics; field count remains bounded by the wire/schema boundary. The
adapter is local and read-only; it does not infer permission,
fetch a missing source, or add another evaluator/cache/authority path. Dispose
the surface and its owning scope when the address ends; source replacement and
pending requests after disposal cannot resurrect it. T10's React lifecycle
adapter remains responsible for mounting and disposing this same controller;
it does not create a second local-data path. The helper is also re-exported
from `@varendo/runtime` for root consumers.

`LocalDataServiceOptions.now` supplies the absolute clock used for plan and
cursor expiry. `workNow` is a separate monotonic clock for request and evaluator
time budgets, which prevents a fixed wall-clock test from disabling bounded
work. Production applications should normally use both defaults; inject them
only for deterministic host tests.

Local continuation tokens are cryptographically random, opaque references to
host-held cursor metadata. Set `ReadGrant.cursorPartition` from authenticated
host identity when `scopeDigest` alone is not a unique principal partition; the
value is never accepted from the query payload. The registry is bounded by
`maxCursors` (1,024 by default, at most 100,000) and removes expired or oldest
entries. A continuation must still be present when its next plan is accepted;
that accepted plan then pins the validated offset, so later registry eviction
cannot silently restart at the first page. This registry stores continuation
metadata only—it is not a second row or result cache.

### Remote HTTP data

Use the same `DataService` boundary for remote data. The application server
owns authentication and returns trusted read context; browser fields that look
like a principal, tenant, grant, or policy are never authority:

```ts
import { createDataHttpHandler } from '@varendo/runtime/data';

export const handleData = createDataHttpHandler({
  service: applicationDataService,
  authenticate: async (request) => {
    const session = await sessions.read(request.headers.get('authorization'));
    return session === undefined
      ? { ok: false, diagnostics: [deniedDiagnostic] }
      : { ok: true, value: { principal: session.principal } };
  },
  allowedOrigin: 'https://app.example',
  maxRequestBytes: 100_000,
  maxRequestMilliseconds: 30_000,
});
```

Mount `handleData(request)` in the host's Fetch-compatible route, then create
the browser client and use it in the ordinary surface binding:

```ts
import { createHttpDataService } from '@varendo/runtime/data';

const peopleData = createHttpDataService({
  baseUrl: 'https://app.example/api/varendo-data',
  headers: { 'x-csrf-token': csrfToken },
});

const bindings: DataSurfaceBindings<PeopleState> = {
  initialState: { rows: [] },
  source: {
    kind: 'data-service',
    service: peopleData,
    coverage: declaredCoverage,
    normalize: normalizePeopleResults,
  },
};
```

The server's `describe`, `plan`, and `execute` implementation must enforce its
declared fields, operators, relations, metrics, ordering, and page size. An
unsupported query returns a structured diagnostic; it is never emulated by
fetching the full source into the browser. Descriptors distinguish complete
coverage from a partial page and distinguish unknown, estimated, and exact
population counts. A scalar global aggregate is accepted only when the trusted
accepted plan pins `resultShape: "global-aggregate"`; descriptor evidence alone
never authorizes the scalar-count exception. The accepted plan also carries an
immutable `sourceLineage` and canonical result-input `lineageDigest`. Result
cache keys and descriptors must match those pins, so a same-scope result from a
different source lineage or an injected upstream reference is rejected.

Continuation cursors are opaque. Bind them to the authenticated principal
partition, full task/output target, normalized query and order, catalog,
schema, meaning, source lineage and revision, policy, consistency mode, and
expiry. Snapshot cursors pin one source snapshot. Live keyset cursors carry the final stable identity
anchor and continue after it when earlier rows are inserted; do not implement
live pagination as an offset. Cancellation from the HTTP client must reach the
source iterator. All successful events still flow through the runtime's one
ResultStore and Region path; an A→B→A activation creates a fresh Result wrapper
and rechecks authority before eligible cached values can be reused.

For a complete runnable transport, use `examples/reference-host`. Its `server.mjs`
mounts `createLocalDataService` behind `createDataHttpHandler` on an ephemeral
localhost port. Its `verify.mjs` consumes that server with
`createHttpDataService`, checks descriptor and row parity against the local
service, verifies semantic aggregates, and closes the server. Run it from the
workspace with:

```sh
pnpm --filter @varendo/reference-host test
```

The reference data and authentication are synthetic. A production host must
replace the demo authenticator and authorization policy rather than accepting
browser-supplied principal, scope, policy, or credential fields.

## Presentation adaptation

`createPresentationAdaptationController` routes each adaptive decision through
the pure core `resolvePresentation` facade, then retains the runtime's existing
queue, Region fence, stage/commit, and renderer rollback boundaries. A host may
supply `PresentationAdaptationOptions.target` with an immutable expected
runtime/scope/activation/surface address and a synchronous `read()` that returns
current `active`, `stale`, or `revoked` evidence. The controller requires an
exact five-field address match and reads it again at commit. Stale, revoked, or
mismatched evidence fails without publication. Legacy Region-only callers
receive a controller-local active target and remain fenced by the Region
snapshot and commit read set.

When a host supplies target evidence, its `surfaceId` must identify the
controller's Region and every address field must match the expected target. A
mismatched active target is treated as stale and cannot stage or render into
another Region. Existing adaptation candidate lists do not
carry resolver IDs, so the adapter assigns deterministic IDs from canonical
candidate content, collapses exact duplicates, and adds deterministic collision
suffixes before entering the resolver. A non-empty authored list remains
complete: rejection does not trigger registry suggestion fallback.

Target evidence is not authority. Hosts must still authorize the scope and
surface and must not mark an old A-B-A address active. The resolver chooses a
validated plan only; the controller remains the sole publication boundary.

## Application scopes (0.5)

`createScope` coordinates a trusted host-owned workspace or account selection.
A selector is only an address presented to the host: it never grants data or
action authority. The host resolves and authorizes it, then returns revisions
that the runtime captures in immutable activation addresses.

```ts
import { createVarendoRuntime } from '@varendo/runtime';
import type { ScopeBinding } from '@varendo/runtime/scopes';

const runtime = createVarendoRuntime({ resources, authority });
const binding: ScopeBinding = {
  resolve: (selector) => host.resolveWorkspace(selector),
  authorize: (resolution) => host.authorizeWorkspace(resolution),
  prepareActivation: (target, context) => host.acceptWorkspaceActivation(target, context),
  activate: (target, context) => host.commitWorkspaceActivation(target, context),
  deactivate: (active, reason) => host.releaseWorkspaceActivation(active, reason),
  readLeaveState: () => drafts.readLeaveState(),
  beforeLeave: (request) => drafts.confirmLeave(request),
  recover: (request) => host.navigateAfterRevocation(request),
};
const workspace = runtime.createScope({
  initial: { kind: 'workspace', id: 'acme' },
  binding,
});
const detach = workspace.attach();
const transition = await workspace.requestChange({ kind: 'workspace', id: 'globex' });
```

Construction is inert. The first `attach()` starts resolution, and the last
detach aborts an unfinished initial resolution so a later attach can restart
it. Voluntary transitions keep the old activation available while the host
chooses Save, Discard, or Stay. A failed or denied target does not replace a
still-authorized old activation. The required synchronous, side-effect-free
`prepareActivation` hook is the trusted host's atomic acceptance boundary. It
receives the target and captured previous permission, policy, activation, and
draft revisions and must revalidate both scopes. Rejection preserves A and its
children. After acceptance, the runtime fences and deactivates A before the
required synchronous `activate` commit hook starts B effects. A commit failure
is irreversible at that point: the runtime compensates B and fails closed.
Epochs only increase, so late A-B-A work cannot commit into the new A.

If activation starts any host-owned resource, `deactivate` is its required,
idempotent compensation boundary. It must clear partial resources before
returning or throwing; the runtime isolates cleanup exceptions so one hook
cannot interrupt the remaining security fence.

Call `invalidate('logout' | 'revoked' | 'expired' | 'external-switch')` for a
forced authority loss. Invalidation synchronously masks the scope and fences
its child surfaces before optional recovery hooks run. Recovery navigation is
therefore host-controlled and cannot delay revocation. Child DataService,
Result, Region, action, cursor, proposal, and subscription work remains bound
to the address that created it and is released when that activation ends.

## Subpaths

| Subpath                        | Responsibility                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `@varendo/runtime/data`         | Local and HTTP data services, bounded reads, and materialization                      |
| `@varendo/runtime/evaluation`   | Task evaluation                                                                       |
| `@varendo/runtime/results`      | Result storage, handles, and leases                                                   |
| `@varendo/runtime/regions`      | Region state and atomic commit lifecycle                                              |
| `@varendo/runtime/actions`      | Registered application effects and action boundaries                                  |
| `@varendo/runtime/interaction`  | Routed interaction state and dispatch                                                 |
| `@varendo/runtime/presentation` | Runtime presentation adaptation                                                       |
| `@varendo/runtime/persistence`  | Explicit export and restore of runtime documents                                      |
| `@varendo/runtime/audit`        | Bounded in-memory audit collection                                                    |
| `@varendo/runtime/meaning`      | Host-owned meaning registration and evaluation                                        |
| `@varendo/runtime/surfaces`     | Scoped controllers, ownership/address contracts, and the canonical local data binding |
| `@varendo/runtime/scopes`       | Host-resolved scope transitions, leave guards, invalidation, and activation contracts |

`@varendo/runtime/app` is also available for applications that want to make the
composition boundary explicit.

## Lifecycle

Mount a Region once for its host lifecycle, render through the same Region ID,
and dispose the runtime when its owner is finished. A newer render supersedes
older work within that Region. Failed or denied work returns a typed receipt and
does not commit stale output.
