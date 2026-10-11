---
id: 'navigation'
path: '/guides/navigation/'
section: 'Guides'
title: 'Navigation'
description: 'Keep the host router in control while Varendo preserves selection and back context across adaptive views.'
---

<p class="lead">Navigation is a host adapter, not a workflow engine. A view may request a registered route; your app owns the URL, guards, history, and loading.</p>

## When you need this

- A row, link, or breadcrumb in a view should open one of your app's routes.
- Back and forward must restore the same region state.
- A wide master-detail view that splits into list plus detail must keep its context.

## 1. Declare the routes

Navigation targets are versioned references, not free URLs. A view may request only the routes its manifest declares, and only when the session holds the `navigation.propose` grant. Unknown or undeclared destinations are rejected before your router sees them.

## 2. Map requests to your router

Write a small adapter that translates a requested route into your router's calls:

**navigation.ts**

```ts
const navigation = {
  open: ({ resourceId, identity }) => router.push(resourceRoute(resourceId, identity)),
  back: () => router.back(),
};
```

`router` is your app's router. The adapter decides whether to follow the request — it can refuse unknown or unauthorized destinations.

## 3. Preserve context across layouts

A wide master-detail view may become a list then a detail on a narrow container. The selected identity, filter, scroll position, and a discoverable Back action must survive that change.

<div class="doc-checklist"><ul><li>Back and forward restore the equivalent region state.</li><li>Unknown or unauthorized destinations are rejected by the host.</li><li>A route change cancels obsolete evaluation and renderer loading.</li><li>Focus moves to the new page or detail heading and returns predictably.</li></ul></div>

## What can go wrong

- A request for a route the manifest does not declare is rejected — no navigation happens.
- Revoked access during a pending navigation fences the request; do not navigate to stale data.
- A route change must cancel in-flight evaluation, or a late result can commit into the wrong screen.

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/guides/responsive-behavior/"><span>Responsive behavior</span><small>See the default cross-container policy.</small><b aria-hidden="true">→</b></a><a href="/concepts/state-ownership/"><span>Selection ownership</span><small>Understand which state transfers between views.</small><b aria-hidden="true">→</b></a></nav>
