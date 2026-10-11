---
id: 'migration-0-5'
path: '/ship/migration-0.5/'
section: 'Releases'
title: 'Migrate from 0.5 to 0.6'
description: 'Keep existing integrations and adopt transactional rendering, draft exits, registered layouts, and the new Playground paths.'
---

## Update the packages together

Use the same exact 0.6.3 version for every Aeliqo package you install. Check the
[package publication status](/reference/packages/) before upgrading. The wire
contract version remains `1`; existing resource definitions, data adapters,
React bindings, and headless runtime renders remain available.

## Continue from 0.6 to 0.7

The OAuth issuer requirement and `createAppToolSession` API belong to 0.7,
and are not part of the 0.6.3 packages. After completing this upgrade, follow
the [0.6 to 0.7 migration guide](/ship/migration-0.6/) for issuer-bound
credentials and authenticated host-session ownership.

## Handle unsaved forms

Calling `app.render` with a new intent now returns `needs-input` when the
current form has unsaved drafts and the host has supplied no exit decision.
Your app chooses Save, Discard, or Stay through `onDraftExit`.

For an app that already saves through registered actions, a minimal discard
confirmation can be added to its existing `createAeliqoApp` options:

```ts
onDraftExit: () => window.confirm('Discard unsaved changes?')
  ? { status: 'discard' }
  : { status: 'stay' },
```

Use your application's accessible dialog for a full Save/Discard/Stay flow.
A Save decision must return a `save({ signal })` callback that reports an
`Outcome<void>` only after the host save succeeds. See [App API](/reference/app-api/)
for the complete contract. Cancellation, a later draft edit, or changed
authority prevents an earlier decision from replacing the current form.

## Read render receipts after publication

`renderer-ready` now means the candidate task and its root presentation were
published together. If preparation or synchronous rendering fails, the previous
authorized task and UI remain current. Do not treat a rejected candidate as a
new committed task. `app.subscribe` continues to observe runtime lifecycle
state; use `onPresentation` to update a displayed view label after successful
rendering or container adaptation.

A custom renderer, including callbacks in nested Lit directives, must produce
deterministic output from captured immutable inputs. Keep business effects in
registered actions. If a host callback also fails while restoring its previous
template, the candidate stays unpublished and the region is cleared. Correct
the callback and remount before retrying; arbitrary host DOM effects cannot be
rolled back by Aeliqo.

## Register larger layouts

`AeliqoAppOptions.patterns` and `stateMappings` add registered workspace and page
layouts to the same facade. Recipes receive every output through
`RecipeContext.results`; the primary `result` remains available. Pattern
callbacks receive a current, owned `context.incumbent` to author explicit
transfers. Follow [From one view to a complete page](/guides/workspace/) for a
runnable progression with a header, sidebar, summary, trend, and breakdown.

State preservation remains conditional on compatible task semantics, current
authority, exact result ownership, and validated mappings. A new query starts a
new task. A selected identity that cannot be proved in the candidate result is
reported as a failed transition instead of being silently reassigned.

## Choose the new agent path

The public [Playground](/playground/) has manual controls and experimental native
WebMCP. It no longer hosts a model composer, BYOK configuration, or MCP relay.
Use [WebMCP setup](/connect/webmcp/) for the browser configuration and
[the local MCP example](/connect/mcp/) for HTTP/stdio or optional server-side
BYOK. The SDK's open tool/model port remains independent of providers.
