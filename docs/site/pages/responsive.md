---
id: 'responsive'
path: '/guides/responsive-behavior/'
section: 'Guides'
title: 'Responsive behavior'
description: 'Adapt registered views from container conditions without another model call or silent information loss.'
---

<p class="lead">The default policy weighs the task, field meanings, and allowed views against the region's own container. It never relies on the viewport alone.</p>

## When you need this

- A region changes size and its view must change with it.
- You want to know which view a request picks, and why.
- You need to limit which views adaptation may choose.

## 1. Read the default policy

Each task has a ranked candidate list. A container at least 640 px wide counts as wide; anything narrower counts as narrow.

<div class="doc-table"><table><thead><tr><th>Need</th><th>Wide (≥640px)</th><th>Narrow (&lt;640px)</th></tr></thead><tbody><tr><th>Browse</th><td>Table first, then cards, list, or trend</td><td>Cards first, then table, list, or trend</td></tr><tr><th>Detail</th><td>Detail view</td><td>Same candidates in the same order — size alone does not create a split layout</td></tr><tr><th>Create/edit</th><td>The registered form</td><td>The same registered form; each form view owns its internal responsive layout</td></tr><tr><th>Compare</th><td>Two-pane split when a fresh compare request names exactly two identities</td><td>A single equivalent view; a mounted view does not upgrade to the split when widened</td></tr><tr><th>Analyze</th><td>Bar or trend when the result supports it, else table</td><td>Same candidates in the same order</td></tr></tbody></table></div>

<aside class="doc-callout" data-tone="note"><strong>Table does not always become cards</strong><p>If simultaneous column comparison matters, an accessible horizontally scrollable table may be the correct narrow view. The task contract wins over a cosmetic breakpoint.</p></aside>

## 2. Limit what adaptation may pick

The resource's `presentation` policy is the only list adaptation may choose from. A narrow container can only select an allowed view. A `preferred` entry ranks the choice — it never forces one.

**resource.ts**

```ts
const people = defineResource({
  // schema, identity, fields…
  presentation: {
    allowedViews: ['table', 'cards'], // narrow containers may only pick 'cards'
    preferred: { analyze: 'trend' }, // a preference, never a bypass
  },
});
```

A resource that allows only `table` stays a table on every container.

## 3. Know what triggers adaptation

A region re-resolves its view when a new request renders, or when its own container crosses a size boundary. A media preference change — pointer, hover, reduced motion, forced colors — also triggers it. Running an action or mutating data does not re-pick the view — send a new request when the presentation should change. On a page with several regions, the host orchestrates them; each region watches its own container.

## 4. Respect the transition guards

Adaptation merges rapid resize signals and waits through active typing, IME composition, drag, and dirty draft transitions. If no equivalent allowed view exists, the region keeps its current valid presentation.

## What can go wrong

- Widening an already-mounted compare view does not produce the two-pane split — the split needs a fresh compare request.
- A `preferred` view that is not in `allowedViews` is ignored.
- If every allowed view fails eligibility, the render returns `unsupported` and the previous valid view stays.

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/guides/adaptive-region/"><span>Adaptive Region</span><small>Use the lifecycle and inspect selected recipes.</small><b aria-hidden="true">→</b></a><a href="/guides/custom-views/"><span>Custom views</span><small>Add a domain-specific renderer without changing core.</small><b aria-hidden="true">→</b></a></nav>
