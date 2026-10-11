---
id: 'adaptive-region'
path: '/guides/adaptive-region/'
section: 'Guides'
title: 'Adaptive Region lifecycle'
description: 'Mount once, render typed intent, observe sanitized state, and dispose all work with the host surface.'
---

<p class="lead">A Region is the unit of evaluation, presentation, and cleanup. Newer requests replace older ones only inside the same Region.</p>

## When you need this

- You mount and drive a region through the app API directly.
- You need to watch render status or show your own loading UI.
- You must release all pending work when a screen unmounts.

## 1. Mount the region once

`app.mount` attaches a region to an element and starts container observation. It fetches nothing until you render.

```ts
const mounted = app.mount({ target, regionId: 'main', resourceId: 'people' });
if (!mounted.ok) throw new Error(mounted.diagnostics[0].message);
```

Region IDs are unique within the app. A failed mount returns diagnostics instead of an element.

## 2. Send a request

`app.render` validates the input, reads current authority, compiles, evaluates, picks a view, commits, and returns the outcome.

```ts
const receipt = await app.render({
  regionId: 'main',
  intent: { version: '1', id: 'browse-people', kind: 'browse', resource: 'people' },
});
```

`receipt.status` is one of the values in the table below. A newer request in the same region supersedes an older one still in flight.

## 3. Watch region state

`app.subscribe` reports sanitized lifecycle state — phase, result references, and diagnostics — never materialized rows.

```ts
const unsubscribe = app.subscribe('main', (state) => renderStatus(state.phase));
```

## 4. Dispose all work

```ts
unsubscribe();
app.unmount('main'); // cancel and release one region
app.dispose(); // release every region, listener, and pending render
```

Calls after `dispose` fail closed. Dispose is safe to call more than once.

## Read the result status

<div class="doc-table"><table><thead><tr><th>Status</th><th>Meaning</th></tr></thead><tbody><tr><th><code>renderer-ready</code></th><td>Runtime evidence committed and the renderer accepted the validated presentation — not proof of browser paint or user attention.</td></tr><tr><th><code>needs-input</code></th><td>The request is valid but needs a user choice or form input.</td></tr><tr><th><code>denied</code></th><td>Current trusted authority rejected the operation.</td></tr><tr><th><code>cancelled</code></th><td>A newer render, abort signal, unmount, or disposal superseded the request.</td></tr><tr><th><code>unsupported</code></th><td>No valid registered contract can perform the request.</td></tr><tr><th><code>failed</code></th><td>A limited internal or adapter failure occurred; inspect diagnostics and recovery.</td></tr></tbody></table></div>

## What can go wrong

- An invalid presentation keeps the previous view while it remains authorized.
- Revocation is different from failure — data the user may no longer see is cleared, not retained.
- A focused or dirty-draft control defers a resize replacement; the newest measurement applies after the guard ends.

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/reference/app-api/"><span>App API reference</span><small>Review exact methods, ownership, and lifecycle.</small><b aria-hidden="true">→</b></a><a href="/concepts/safety/"><span>Commit safety</span><small>See revision and read-set validation.</small><b aria-hidden="true">→</b></a></nav>
