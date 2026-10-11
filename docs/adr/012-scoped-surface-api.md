# ADR 012: Scoped surface API and compatibility boundary

Status: Accepted for the vNext T01 design contract; T05 local-data implementation reconciled.
Date: 19 September 2026.

## Context

The 0.4 API exposes an application/resource/region facade. The vNext design
must add scoped live surfaces without turning an immutable feature definition
into mutable session state, introducing a second evaluator, or silently
changing the meaning of the existing `AeliqoProvider app={...}` path. The
contract must also make scope transitions, controlled state, native React views,
and the optional agent bridge explicit before implementation begins.

The authoritative design is `docs/plans/aeliqo-vnext/01-SPEC.md` and
`08-CONTRACTS.md`. The declarations in `tests/vnext/api-contract.ts` and its
consumer fixtures are design probes only. They do not add exports or prove
runtime behavior.

## Requirements and constraints

- A feature definition is immutable metadata. It contains no rows, credentials,
  principal, mutable selection, or live subscriptions.
- A data feature declaration is limited to reusable `id`, schema, identity, and
  presentation metadata. Typed live state belongs to the source binding and
  controller, not to a feature-owned state parser or singleton.
- A live surface is addressed by the immutable tuple
  `(runtimeId, scopeInstanceId, activationEpoch, surfaceId, surfaceGeneration)`.
  A captured controller cannot be retargeted after a scope transition.
- Renderers consume a `SurfaceController`; they never receive a
  `FeatureDefinition` as their live state.
- A surface's intent type comes from its feature definition. Bindings,
  controllers, native views, and ownership cannot substitute an unrelated
  intent merely by supplying an explicit generic argument.
- Ownership is one discriminated option: `internal` state is runtime-owned;
  `external` state is host-owned and emits correlated proposals.
- Scope selection is not authorization. The host/server resolves membership,
  guard decisions, and effects at the relevant boundary.
- Core/runtime remain framework-independent and DOM-free. React views remain
  in an adapter, and agent access is optional and explicitly target-scoped.
- Existing 0.4 behavior and package exports remain available until an
  implementation and migration are reviewed.

### Local identity and asynchronous ownership

The providerless local helper accepts a bounded complete array and a required
`getRowId` for entity-dependent operations. When no explicit surface `id` is
provided, it creates a stable per-instance display identity for the lifetime of
that mounted controller; it never turns an array index, label, or inferred field
into a business identity. Missing or duplicate row identities produce a useful
diagnostic and disable identity-dependent operations. Empty or ambiguous input
can supply an explicit schema and does not trigger a guessed remote fetch.

Construction is inert. `useDataSurface` feeds data updates into the same local
controller within one activation, while committed lifecycle owns subscriptions
and default reads. Advanced data bindings reuse the existing
`DataService.describe/plan/execute` boundary and declare supported fields,
operators, pagination, stable ordering, normalization, and approved
`ActionPort` access. Non-data capabilities use a separate typed binding;
neither path creates a parallel query engine. The runtime fences asynchronous
work with the captured scope address. Internal ownership commits through the
runtime; external ownership reads a host snapshot and emits a correlated
proposal, so a callback is never treated as an accepted commit.

## Viable options

### Keep the 0.4 region/resource API as the only contract

This preserves compatibility but cannot express immutable per-instance
addresses, guarded scope activation, controlled proposals, or a renderer that
operates on a live surface without conflating resource metadata and session
state. It remains the compatibility path, not the vNext contract.

### Add one universal all-props component

This is concise in a demo but combines data access, authority, actions,
renderer selection, lifecycle, and model configuration in one trust boundary.
It would encourage ambient discovery and duplicate host state, so it is
rejected.

### Use immutable features plus scoped controllers and adapter bindings

This keeps reusable definitions shareable, makes live identity explicit, lets
manual controls and optional agents use the same request boundary, and allows
React/native views to remain adapters. It adds lifecycle types and a deliberate
compatibility seam, but those costs are visible and testable.

## Decision and consequences

Select the third option. The frozen design contract provides:

- `defineFeature`/`defineDataFeature` for immutable definitions;
- `createAeliqoRuntime`, `runtime.createScope`, and `runtime.createSurface` for
  host-owned composition roots;
- `SurfaceController` plus `AdaptiveSurface`/`ViewSurface` for live rendering;
- `internal` versus `external` ownership with revision-correlated proposals;
- `ScopeController.attach`, `requestChange`, `invalidate`, and `dispose` for
  voluntary guarded transitions and forced security fences;
- `useDataSurface`, `useSurface`, and `useSurfaceState` for React adoption;
- `AeliqoScope` and a runtime-oriented `AeliqoProvider` for explicit scope
  ownership;
- `defineReactViews` for trusted native React implementations; and
- `connectAgent({scope, client, targets})` for an optional, explicit bridge.

The T01 contract version is `aeliqo.surface/1`. `definitionRevision` belongs to
immutable feature metadata; surface `revision` and `activationEpoch` belong to
live controller state. A future breaking change must introduce a new contract
version and update all consumers, docs, migration notes, and evidence together.

`AeliqoProvider` keeps a documented compatibility branch for existing 0.4
applications: `mode="legacy-app"` accepts the actual current `AeliqoApp`
contract. The vNext branch accepts `runtime={runtime}`. The implementation
must use a discriminated compatibility adapter and must not silently reinterpret
an existing `app` prop as a vNext runtime.

The API is intentionally a small boundary. Source bindings own data and
authority, renderers own presentation, and the host owns business effects.
`committed` is a controller-state result; it is not renderer readiness or proof
of a remote business transaction.

## Delivery and recovery

T01 verifies positive and negative consumer shapes with strict TypeScript. T02
and later tasks must port these shapes to real package exports, add runtime
behavior tests, and update package export maps, docs, migration guidance, and
clean tarball consumers together. Until then, no declaration in this ADR is a
published API.

The T01 SSR fixture only compiles the server-render consumer and records the
expected visible cell/text contract. It deliberately does not manufacture a
passing DOM assertion. T12 must render the real adapter and verify that visible
content; until then SSR is neither implemented nor runtime-verified.

If implementation discovers a concrete incompatibility, update this ADR, the
consumer fixtures, public declarations, examples, migration, and evidence in
one reviewed change. Do not layer an alias or preserve two competing surface
contracts. Existing 0.4 region/resource consumers remain on their documented
path during migration.

T03 implementation exposed one such concrete incompatibility: an inert surface
cannot derive a typed `state: S` without performing a read or casting an
unrelated region snapshot. Data and capability bindings therefore provide an
explicit `initialState`. The runtime copies that value into its first immutable
snapshot without freezing the caller-owned object. This keeps construction
inert and makes the public `SurfaceSnapshot<S>` type truthful; the declaration
consumer and installed runtime consumer cover the same shape.

The same non-optional rule applies to `SurfaceSnapshot.intent`. Data surfaces
have a canonical inert browse intent. A capability surface cannot derive a
valid feature-specific input, so its binding requires a typed `initialIntent`
independently of ownership. External construction does not read the addressed
host store before `createSurface()` returns; the host may initialize that store
from the returned immutable address before its first read. This replaces both
the original `undefined as I` fallback and the circular interim requirement
that an external host snapshot supply an address-dependent initial intent.

### T05 implementation reconciliation: canonical local data binding

T05 implements the local convenience seam without changing the decision's
ownership or evaluation boundaries. `createLocalDataBinding` is the sole public
adapter for a feature-backed local snapshot. It validates the mounted feature
and catalog, performs bounded structural shape and identity checks, and returns
one binding whose `service` is the exact `LocalDataService` mounted by the
surface. Snapshot replacement remains explicit and revisioned: the service
copies/freeze-protects caller input, treats an equivalent catalog plus record
snapshot at the same revision as a no-op, and rejects same-revision conflicts,
catalog drift, invalid shapes, and capacity failures atomically. Accepted
revisions invalidate only the existing DataService plans; they do not replace
the controller or address. Result events, ResultStore handles, and Region
publication all retain the source pin and fail closed if it changes before
publication.

The adapter does not infer permissions, fetch absent sources, or create a
second evaluator, cache, authority, identity, or feature-definition path. Core
owns the bounded `inferLocalDataShape` helper and reuses resource schema
semantics; runtime owns the service and lifecycle wiring. T10 still owns the
React lifecycle adapter and must consume this same binding/controller boundary,
not introduce a parallel local-data implementation. The candidate remains
unpublished until the installed consumer, package, and release gates are
accepted together.

### Documentation source map

`docs/plans/aeliqo-vnext/01-SPEC.md` and `08-CONTRACTS.md` are the normative
behavior and example sources. This ADR records the compatibility and ownership
decision. `tests/vnext/api-contract.ts` is the isolated declaration contract;
`tests/vnext/types/local.tsx`, `advanced.tsx`, and `invalid.tsx` are the
consumer probes. When implementation lands, package exports and installed
consumer checks become the source of published API facts, package guides remain
under `docs/packages/`, and component-facing examples belong under
`docs/site/`. No declaration in the probe or this ADR is a published runtime
implementation.

## Revisit conditions

Revisit this decision only if a real installed-package consumer exposes an
unresolvable type/ownership conflict, the package dependency direction would
need to change, a scope or renderer trust boundary cannot be enforced, or
measured lifecycle cost requires a materially different composition. A future
decision must supersede this record and retain its migration and verification
history.
