---
id: "app-api"
path: "/reference/app-api/"
section: "Reference"
title: "Application API"
description: "Lifecycle, ownership, outcomes, and extension points for the Varendo application facade."
---

<p class="lead">Create one app, mount Regions, and send intents. Every call returns a typed receipt with a stable outcome.</p>
<aeliqo-release-status></aeliqo-release-status>

Import the application facade from `@varendo/web/app`. This entry point uses
`@varendo/runtime`; component-only consumers can import the web package root.
Use matching package versions for all application dependencies.

<h2>createAeliqoApp</h2>

**Signature**

```ts
createAeliqoApp(options: AeliqoAppOptions): AeliqoApp
```

<p><strong>Required:</strong> a resources array with at least one resource/data binding, plus an authority adapter. <strong>Optional:</strong> a runtime ID, custom intents, an action port, a result store and its options, and region/render limits. You can also pass recipes, views, presentation patterns, state mappings, a form-state adapter, and an action-event callback. Standard recipes are used when no recipes are supplied.</p>
<h2>mount</h2>

**Signature**

```ts
app.mount({target, regionId, resourceId}): Outcome<AeliqoRegionElement>
```

<p>Creates one Region and begins container observation. Region IDs are unique within the app. Mount does not fetch data until <code>render</code>.</p>
<h2>render</h2>

**Signature**

```ts
await app.render({regionId, intent, signal?}): Promise<WebRenderReceipt>
```

<p>Parses unknown input, reads current authority, compiles, evaluates, resolves a recipe or registered pattern, validates state transfer, commits, and returns a typed receipt. A newer request in the same Region supersedes an older one.</p>
<h2>subscribe and snapshot</h2>

**Signatures**

```ts
app.subscribe(regionId, listener): () => void
app.snapshot(regionId): RuntimeRegionState | undefined
```

<p>Subscribers receive sanitized lifecycle state, Result references, and diagnostics—not materialized rows. Subscription is safe before the Region child lifecycle completes.</p>
<h2>unmount and dispose</h2>

**Signatures**

```ts
app.unmount(regionId): boolean
app.dispose(): void
```

<p>Unmount cancels and releases one Region. Dispose is idempotent and releases every Region, listener, pending render, Result handle, and owned observer. Calls after disposal fail closed.</p>
<h2>Receipts</h2><p><code>renderer-ready</code>, <code>needs-input</code>, <code>denied</code>, <code>cancelled</code>, <code>unsupported</code>, and <code>failed</code> are distinct. A failed presentation leaves the previous authorized task, results, and UI in place. Candidate data is published only after the root renderer succeeds. Revocation clears inaccessible content. The receipt includes bounded diagnostics; it does not claim the rejected candidate committed.</p>
<h2>Source declarations</h2><aeliqo-source data-label="AeliqoApp types" data-path="packages/web/src/app/types.ts"></aeliqo-source>
<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/reference/intent-schema/"><span>Intent schema</span><small>Build valid render inputs.</small><b aria-hidden="true">→</b></a><a href="/reference/diagnostics/"><span>Diagnostics</span><small>Handle failure and recovery consistently.</small><b aria-hidden="true">→</b></a></nav>

## Layout registration

`patterns?: readonly PresentationPatternManifest[]` registers trusted layout
expanders. `stateMappings?: readonly PresentationStateMappingManifest[]` declares
transitions implemented by the renderers. Import these types from
`@varendo/core/presentation`. Both registrations are validated when the app is
created. Patterns reuse the same resolver and validator as standard recipes.

Custom recipes receive `context.results`, all output descriptors, and
`context.result`, the first descriptor for compatibility. If a custom intent has
no matching recipe, a registered pattern must match. Data children remain
subject to the mounted resource's `presentation.allowedViews`.

## Observe an applied presentation

`onPresentation(receipt)` runs after a successful renderer update, including
container and media changes. Use it to update a view label or diagnostics panel.
`receipt.environment` contains the dimensions used by the resolver. Resize
reuses the current results; it does not request data or call a model.

```ts
const app = createAeliqoApp({
  resources,
  authority,
  onPresentation(receipt) {
    console.log(receipt.regionId, receipt.presentation.plan.rootId);
  },
});
```

Observer failures do not roll back a committed presentation. `app.subscribe`
continues to report runtime state; a runtime commit alone is not a DOM-ready event.

## Protect an unsaved draft

`onDraftExit(request)` gives the host a Save/Discard/Stay decision before
`app.render` replaces a dirty form. The request contains an immutable copy of
the drafts, the next intent, a revision, and an abort signal. Return
`{ status: 'stay' }` to keep editing, `{ status: 'discard' }` to permit replacement,
or `{ status: 'save', save: async ({ signal }) => outcome }` to run your own save.
A successful save returns `{ ok: true, value: undefined }`; a failure returns
an `Outcome` with diagnostics. Without a handler, a dirty exit returns
`needs-input` and retains the current draft.

New edits, a newer render, disposal, or revoked authority invalidate pending
exit work. Honor the supplied signal in host requests. A failed replacement
keeps the authorized previous UI and draft; a host save that already completed
is a business effect and is not undone automatically.

`renderer-ready` confirms the synchronous Region root update. It does not wait for asynchronous descendant components, network content, or browser paint. Custom view render callbacks run synchronously and must keep business effects in registered actions.

### Host renderer contract

A custom view and any nested Lit directive callbacks must be synchronous,
deterministic, and free of business effects. Capture immutable inputs in the
returned template; do not make a previous template depend on changing external
state. This lets a rejected update replay the last authorized template while
retaining its keyed children. Perform effects through registered actions.

A directive that mutates the DOM independently or throws while replaying a
previous template is outside this contract. The candidate remains unpublished,
but the renderer clears the affected region if restoration also fails. Fix the
host callback and remount the region before retrying. Varendo cannot roll back
arbitrary effects performed by application code.
