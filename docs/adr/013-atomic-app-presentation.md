# ADR 013: Publish app tasks and presentations together

Status: accepted for implementation in 0.6.0. Supersedes the two-step facade
publication detail, preserving [ADR 010](010-replayable-presentation-plans.md)
and [ADR 012](012-scoped-surface-api.md) ownership and validation boundaries.

## Context

The app facade previously committed a runtime task and then resolved and applied
its presentation. A rejected target or failed renderer could leave the previous
UI visible while the runtime named the newer task. A subsequent action or resize
could then target a different canonical task from the one shown.

The runtime must remain independent of the DOM. The existing Region owns
result leases, current authority, revision fencing, and canonical publication.
The web layer must keep its existing keyed renderer, child identities, focus,
and draft ownership. Host views are synchronous trusted rendering callbacks.

## Decision

Add a trusted optional preparation transaction to the runtime app API. Evaluate
candidate outputs first, prepare and validate the presentation without changing
the live tree, then stage task, presentation, and interaction together. Apply the
prepared renderer in the existing synchronous final Region commit recheck. Only
a successful apply and final authority check may publish the canonical state.
A failed or cancelled attempt rolls back its projection and releases candidate
leases. Revocation clears private content and forbids restoration.

The web Region exposes an explicit synchronous root flush using Lit's supported
`performUpdate` mechanism. This invokes the same keyed renderer on the mounted
Region. It avoids cloning a second tree or replacing every child owner. Custom
view exceptions propagate to this transaction; standalone asynchronous rendering
retains its existing fallback behavior. Renderer callbacks and nested directives
must be deterministic over their captured inputs so the retained template can be
replayed. A callback that reads mutable external state or changes application
state while rendering cannot be promised DOM rollback; such a callback must be
fixed before retrying.

A bounded browser spike covered keyed child/input identity, focus and draft
retention, root failures before and after DOM mutation, synchronous rollback,
and queued updates in Chromium, Firefox, and WebKit. Production acceptance must
also cover authorization, stale operations, result retention, and app-level
failures; the spike alone does not qualify the release.

## Alternatives

- Preflight followed by the existing two commits would catch unsupported targets
  but still publish a task before a renderer failure.
- Restoring only the DOM after failure leaves the canonical mismatch intact.
- Rendering a detached replacement tree would duplicate child ownership and lose
  existing input instances, focus, and local state.
- A second runtime or rendering engine would duplicate existing trust contracts.

## Consequences

The optional runtime preparation API is additive. Existing headless render calls
keep their behavior. Both new task rendering and responsive presentation updates
use the same publication boundary. Renderer callbacks cannot grant authority,
replace the compiled task, or introduce unvalidated agent-supplied UI.

`renderer-ready` describes the Region root update. It does not promise browser
paint or completion of asynchronous descendant components. Application-owned
business effects, including an already completed Save, are not undone by UI
rollback. Review this decision if asynchronous host render callbacks or a
subtree-wide readiness contract become required.
