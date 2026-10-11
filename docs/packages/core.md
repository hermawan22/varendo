# `@varendo/core`

`@varendo/core` defines Varendo's wire contracts and pure domain operations. It
does not read from a browser, access a network, or perform application effects.

## Main entry point

Use the package root for the common resource and contract workflow:

```ts
import { compileIntent, defineResource, parseCatalog } from '@varendo/core';
import type { Catalog, Intent, Task } from '@varendo/core';
```

The root exports `defineResource`, `compileIntent`, contract parsers and
validators, schema helpers, and the primary wire types. Typed parsers include
`parseCatalog`, `parseTask`, `parseResult`, `parseExperience`, `parseQuery`,
`parseInteraction`, `parsePresentationPlan`, and `parseResultEvent`. Use
`parseContract` when the contract kind is selected dynamically. The root does
not expose query planner or presentation implementation details.

## Measures

`defineResource` accepts a `measures` map for the common count and sum cases.
Each entry expands into an approved, active meaning with the output type taken
from the schema, so analyze intents can reference it immediately:

```ts
const people = defineResource({
  id: 'people',
  revision: '1',
  label: 'People',
  identity: ['id'],
  schema: z.object({ id: z.string(), team: z.string(), joined: z.iso.date() }),
  fields: { team: { role: 'dimension' }, joined: { role: 'time' } },
  measures: { hires: { label: 'New hires', aggregate: 'count' } },
  presentation: { allowedViews: ['table', 'trend', 'bar'] },
});
// analyze intent: measures: [{ id: 'hires', revision: '1' }]
```

`aggregate` is `count`, `count-distinct`, or `sum`. Counts default to the first
identity field; `sum` requires a numeric `field`. `semiAdditiveOver` marks a
snapshot measure that must never be summed across the named fields. Invalid
entries fail with a `resource.measure` diagnostic. Use `meanings` for ratios,
denominators, and host capabilities.

## Reusable feature definitions

Use `@varendo/core/features` for immutable feature metadata. A data
feature keeps its schema, identity fields, meanings, and eligible view aliases
separate from live rows, principals, credentials, selection, and subscriptions:

```ts
import { defineDataFeature } from '@varendo/core/features';
import { z } from 'zod';

const peopleFeature = defineDataFeature({
  id: 'people',
  schema: z.object({
    id: z.string(),
    name: z.string(),
    team: z.enum(['Design', 'Engineering']),
  }),
  identity: ['id'],
});
```

`peopleFeature.resource` is the compatibility lowering into the existing
`ResourceDefinition` path. It uses the same Catalog, intent compiler, query
planner, and validation behavior as `defineResource`; it does not introduce a
second data or authority engine. The default eligible view aliases are the
currently registered standard recipe aliases: `table`, `cards`, `list`,
`detail`, and `trend`. Supply `presentation` explicitly to narrow that policy.

Non-data features declare typed intents and the capability schemas they may
address without fabricating relational rows or a Catalog:

```ts
import { defineFeature } from '@varendo/core/features';
import { z } from 'zod';

const documentJob = defineFeature({
  id: 'document-job',
  capabilities: [
    {
      ref: { id: 'job.status', revision: '1' },
      kind: 'status',
      schema: z.object({ jobId: z.string(), state: z.string() }),
    },
  ],
  intents: [
    {
      ref: { id: 'job.configure', revision: '1' },
      schema: z.object({ template: z.string() }),
      capabilities: [{ id: 'job.status', revision: '1' }],
    },
  ],
});

const parsed = documentJob.parseIntent({
  intent: { id: 'job.configure', revision: '1' },
  input: { template: 'invoice' },
});
```

## Bounded local shape inference

`inferLocalDataShape` is the bounded structural check used by the runtime local
binding. It accepts a complete row array and an optional declared Zod object
schema, validates field names and scalar values against the existing resource
schema semantics, and returns either a ready shape or an explicit diagnostic.
It never invents a field or a business identity. Empty input therefore needs a
declared schema; schema-less all-null or nested values, inconsistent row keys, duplicate
canonical identities, and values that exceed the configured row/field/byte
bounds are rejected with `data.*` diagnostics. Use an explicit `identity` field
list or a callback that resolves to exactly one real scalar field:
Declared nullable schema fields may contain `null`; the schema-less all-null
case is the ambiguous case.

```ts
import { inferLocalDataShape } from '@varendo/core/features';

const shape = inferLocalDataShape({
  id: 'people',
  rows: [{ id: 'ada', name: 'Ada' }],
  identity: ['id'],
  limits: { rows: 1_000, fields: 32, bytes: 1_000_000 },
});
if (!shape.ok) throw new Error(shape.diagnostics[0].message);
```

An empty collection can still report its declared fields:

```ts
const empty = inferLocalDataShape({
  id: 'people',
  rows: [],
  schema: peopleFeature.schema,
  identity: ['id'],
});
```

The result reports field kind and nullability and is safe to use as a
diagnostic/coverage input. It is not a second resource definition or query
planner; data features still own the canonical Catalog and schema lowering.
Structural inference supports `text`, `boolean`, `integer`, `float`, and
`decimal`; a declared schema additionally reports its resource-compatible
`date` and `instant` kinds. The helper does not infer permissions, units,
currency, metrics, relationships, pagination/coverage, or business IDs; those
remain explicit host/resource and binding contracts. The same helper is
re-exported from `@varendo/core` for root consumers.

## Remote capability and analytics semantics

A remote Catalog declares only operations the source can execute. A capability
may name registered metrics and one pagination contract:

```ts
const capability = {
  ref: { id: 'people.remote', revision: '1' },
  entity: 'people',
  operators: [{ id: 'eq', revision: '1' }],
  fields: ['id', 'name', 'team'],
  relations: [],
  metrics: [{ id: 'people.global-count', revision: '1' }],
  pagination: {
    mode: 'snapshot',
    stableOrder: [{ field: 'id', direction: 'asc', nulls: 'last' }],
    identity: ['id'],
  },
  maxOutputRows: 10_000,
} satisfies Catalog['capabilities'][number];
```

Catalog validation resolves every capability field, relation, and metric.
Pagination identity must match the entity identity, and the stable order must
end with that identity as its deterministic tie-breaker. Snapshot and keyset
modes are different contracts; a source must not relabel an offset cursor as a
live keyset cursor.

Registered analytics keep meaning metadata in the validated logical plan.
Semi-additive measures require an explicit time bucket and select all rows at
the latest requested temporal value before applying the registered aggregate. Ratio-of-sums, mean-of-rates, count, and nested
aggregates apply the meaning's missing-value policy; propagating aggregate
meanings declare nullable outputs. Units and currencies must
match unless a reviewed conversion meaning explicitly defines the conversion.
A partial page cannot be promoted to a complete global aggregate; complete
analytics require complete source coverage or server-provided computed
evidence tied to the exact query and meaning revision.

References must be namespaced and versioned. Intent and view references can
only name capabilities and views declared by the same feature. Capability
`kind` is explicit because a schema shape does not imply read, status, command,
cancel, or output semantics.

`ResultRef` also carries `sourceLineage`: a stable source identity distinct from
the revision. Preserve it when forwarding result references, including task
inputs, result events, and presentation bindings. A mixed-consistency Result
must state the same immutable lineage so consumers can distinguish an advancing
live source from an unrelated source that reused a revision label.

## Presentation decisions

Use `resolvePresentation` from `@varendo/core/presentation` when a host has
already obtained authorized task, result, registry, policy, environment, target,
and candidate evidence. It is a pure decision boundary: it never reads a
browser, network, clock, model, cache, or host object, and it never commits or
renders a plan.

```ts
import { resolvePresentation } from '@varendo/core/presentation';

const decision = resolvePresentation({
  id: 'people-browse',
  revision: '1',
  preconditions,
  context,
  registry,
  target,
  candidates,
});

if (decision.status === 'ready') commit(decision.plan.plan);
if (decision.status === 'needs-input') promptFor(decision.choices);
if (decision.status === 'unsupported') report(decision.diagnostic.code);
```

The supplied target is non-authoritative evidence: core rejects stale or
revoked evidence and requires its surface ID to match the validated task's
region ID, but does not resolve a surface, grant access, or upgrade its state.
The host remains responsible for authorization, the remaining immutable-address
fields, scope fences, result materialization, and commit/renderer transactions.

`ready` contains one validated plan and a bounded decision receipt;
`needs-input` contains a stable, bounded set of typed choices tied to a
registered, policy-eligible representation; and
`unsupported` contains a diagnostic plus candidate rejection codes. Candidate
order cannot change an equivalent decision: eligibility precedes ranking, with
an eligible soft task preference ranked before quality and continuity, then
stable IDs as the tie-breaker. Inputs and outputs are normalized and bounded;
candidate work is capped, and exhaustion returns `unsupported` rather than a
truncated ready result.

Every resolver candidate must have a unique stable `id`; that ID is preserved
in ready receipts and rejection explanations, including candidates expanded by
a registered pattern. The lower-level composition request also accepts an
optional candidate `id` for provenance. Resolver calls with authored candidates
evaluate that complete list only. Registry suggestion search is used only when
the resolver candidate list is empty, so a rejected authored plan cannot be
silently replaced by an unrelated registered suggestion.

An `explicit` task view preference is a hard compatibility gate. An unknown,
disallowed, stale, or incompatible explicit view returns `unsupported` rather
than silently selecting an alternative. A `preferred` view is only a ranking
input: it never grants authority, renderer support, result coverage, or an
operation capability. Missing semantic input is `needs-input`; it is not a
license to choose the first available field or presentation.

## Explicit subpaths

| Subpath                      | Contents                                                       |
| ---------------------------- | -------------------------------------------------------------- |
| `@varendo/core/schema`        | JSON schemas for persisted or transported contracts            |
| `@varendo/core/contracts`     | Contract parsing, validation, scalar handling, and wire limits |
| `@varendo/core/app`           | Custom intent compilers and resource validation                |
| `@varendo/core/features`      | Immutable features and bounded local shape inference           |
| `@varendo/core/expressions`   | Typed expression builders and function registries              |
| `@varendo/core/semantics`     | Catalog indexes and meaning validation or activation           |
| `@varendo/core/query`         | Query planning, logical plans, and evaluation                  |
| `@varendo/core/interaction`   | Interaction graph and state contracts                          |
| `@varendo/core/presentation`  | Presentation validation, composition, and pure decisions       |
| `@varendo/core/plot`          | Plot specifications and binding                                |
| `@varendo/core/visualization` | Visualization specifications and binding                       |
| `@varendo/core/agent`         | Agent proposal and authority wire types                        |
| `@varendo/core/schemas/*`     | Generated JSON Schema artifacts for external validators        |

Import a subpath when using its named capability:

```ts
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createQueryPlanner } from '@varendo/core/query';
```

## Runtime requirements

The package is ESM and targets the supported Node.js and browser toolchains
declared by the repository. It has no runtime dependency on the DOM. The package
uses the contract wire version declared by `CONTRACT_VERSION`; this is separate
from the npm package version.

### Pattern transitions (0.6)

Registered pattern callbacks receive `context.incumbent` when a current
presentation exists. This is a parsed, deeply owned snapshot whose read set
and result references must match current authority. Use its node IDs to author
explicit `stateTransfer` entries. The normal transition validator still checks
identity transfers and registered archival mappings; the incumbent grants no
additional views, data, or permissions. An absent incumbent means there is no
previous presentation to transfer.
