---
id: 'custom-views'
path: '/guides/custom-views/'
section: 'Guides'
title: 'Custom views'
description: 'Register a trusted application renderer with an exact presentation manifest and lifecycle.'
---

<p class="lead">A custom view is trusted application code. An agent may request a registered view, but cannot install one, supply its import path, or render its own HTML.</p>

## When you need this

- The standard views cannot express your domain — for example, a reading layout for articles.
- You can declare exactly what the view needs in a manifest.
- You are willing to own the renderer and its empty and failure states.

## 1. Define the view

`defineView` pairs a versioned identity with a presentation manifest and a `render` function. The manifest declares the result and operations the view may use; `render` receives an authorized result and returns a Lit template.

This article renderer is the same one the [Knowledge example](/examples/knowledge/) registers. Its top-level `ref` and `manifest.ref` must match exactly.

```ts
import { defineView } from '@varendo/web/recipes';
import { html } from 'lit';

export const knowledgeArticleView = defineView({
  ref: { id: 'demo.knowledge-article', revision: '1' },
  manifest: {
    ref: { id: 'demo.knowledge-article', revision: '1' },
    configSchema: { id: 'demo.knowledge-article.config', revision: '1' },
    roles: ['article'],
    operations: [{ id: 'data.read', revision: '1' }],
    result: 'required',
    children: { min: 0, max: 0 },
    visibility: 'leaf',
    extension: true,
    resolveConfig: (values) => ({
      ok: true,
      value: {
        values,
        fields: ['title', 'topic', 'excerpt', 'content'],
        ports: [],
        operations: [{ id: 'data.read', revision: '1' }],
      },
    }),
  },
  render: ({ result }) => {
    const article = result?.rows[0];
    if (article === undefined) return html`<p>No article was found.</p>`;
    return html`<article>
      <p>${String(article.topic)}</p>
      <h2>${String(article.title)}</h2>
      <p>${String(article.excerpt)}</p>
      <p>${String(article.content)}</p>
    </article>`;
  },
});
```

You should see: a view definition with one matching identity, a declared manifest, and a renderer. This is a complete view, not a complete app. The host still supplies the resource, data service, authority, request, and region. Install `lit` alongside the Varendo packages to run it.

## 2. Register the view

Pass the view in the `views` option where you create the app, alongside its resources and authority.

```ts
import { createVarendoApp } from '@varendo/web/app';

const app = createVarendoApp({ resources, authority, views: [knowledgeArticleView] });
```

Also list the view ID in the resource's `allowedViews` — a request can only pick views the resource allows. Run the view in the [Knowledge playground](/playground/?scenario=knowledge) or copy the full [Knowledge example](/examples/knowledge/).

## 3. Let it earn selection

A view is eligible only when the validated task, result, presentation policy, and manifest agree. The optional `assess` callback on the manifest may add a synchronous, pure, size-limited quality score. It never replaces eligibility checks.

## Check the extension contract

<div class="doc-checklist"><ul><li>Use a stable namespaced ID and revision in both references.</li><li>Declare the configuration schema, roles, operations, result requirement, child limits, and visibility.</li><li>Set <code>extension: true</code> — the renderer is trusted host code, not model output.</li><li>Resolve configuration with declared fields, ports, and operations.</li><li>Render an explicit empty or failure state when the authorized result lacks the expected row.</li><li>Register state mappings when a transition must preserve selection, draft, focus, or navigation state.</li></ul></div>

A view that can express its needs through the existing contracts belongs in your application code — no core change. See [adaptive regions](/guides/adaptive-region/) for selection and [state ownership](/concepts/state-ownership/) for transitions.

## Use native React views

With `@varendo/react/surface`, register a trusted React component through `defineReactViews`. Use `render` for an already loaded component or `load` for a route-split module.

```tsx
import { defineReactViews } from '@varendo/react/surface';

const views = defineReactViews([
  {
    id: 'people.native-detail',
    revision: '1',
    load: () => import('./PeopleDetail.js').then((module) => module.default),
  },
]);
```

The native adapter renders inside your React tree, so context, portals, and controlled inputs keep their normal ownership. Automatic selection still needs a registered presentation candidate and committed result evidence. While a new view loads, the previous authorized view stays mounted. If loading fails, that view remains usable and the adapter offers Retry. Make failed imports retryable, and bump the view revision when its implementation changes. See the [@varendo/react package guide](/reference/packages/) for the full surface API.

## What can go wrong

- A `ref` that does not match `manifest.ref`, or a missing `extension: true`, throws at definition time.
- A `load` that rejects leaves the previous authorized view mounted with a Retry control. Revocation or a new scope removes it at once — no stale renderer stays.
- A missing expected row must render your own empty state; do not assume `result.rows[0]` exists.

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/examples/knowledge/"><span>Knowledge example</span><small>See this view in a working app.</small><b aria-hidden="true">→</b></a><a href="/guides/adaptive-region/"><span>Adaptive Region</span><small>Understand how views are selected and committed.</small><b aria-hidden="true">→</b></a></nav>
