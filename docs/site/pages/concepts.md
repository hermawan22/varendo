---
id: 'concepts'
path: '/concepts/'
section: 'Reference'
title: 'How Varendo works'
description: 'Follow one intent through Catalog, Task, Result, Recipe, Experience, and Region without treating model output as UI code.'
---

<p class="lead">Varendo separates what the user wants from how your interface presents it. Each stage narrows behavior and attaches evidence. Read the flow once; every other page refers back to it.</p>
<ol class="concept-flow"><li><span>01</span><div><h3>Resource and Catalog</h3><p>Describe entities, fields, stable identity, relationships, meanings, and available operations.</p></div></li><li><span>02</span><div><h3>Intent</h3><p>A bounded request: browse People, inspect one Product, edit a Ticket, or analyze a registered measure.</p></div></li><li><span>03</span><div><h3>Task</h3><p>The pure compiler turns intent into required outputs, operations, fields, form bindings, and an optional view preference.</p></div></li><li><span>04</span><div><h3>Result</h3><p>Evaluation returns rows plus identity, scope, grain, precision, completeness, lineage, and revision.</p></div></li><li><span>05</span><div><h3>Recipe and Experience</h3><p>Registered policy selects a view that satisfies the Task, environment, accessibility, and host constraints.</p></div></li><li><span>06</span><div><h3>Region commit</h3><p>The runtime rechecks authority and read revisions, transfers valid state, then commits or keeps the previous safe UI.</p></div></li></ol>
<h2>Follow one request</h2><p>Given a registered <code>people</code> resource, this input travels through every stage above and returns a typed receipt:</p>

**render call**

```ts
const receipt = await app.render({
  regionId: 'people-main',
  intent: {
    version: '1',
    id: 'browse-engineering',
    kind: 'browse',
    resource: 'people',
    fields: ['name', 'team'],
    filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
  },
});
// receipt.status is 'renderer-ready', 'needs-input', 'denied', 'cancelled',
// 'unsupported', or 'failed' — never an unbounded promise of pixels.
```

<p>A button, route, test, or agent sends the same shape. Each stage can narrow it or stop it; none can widen it into unregistered behavior.</p>
<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/concepts/intent/"><span>Intent contract</span><small>See the six standard intents and extension path.</small><b aria-hidden="true">→</b></a><a href="/concepts/safety/"><span>Safety model</span><small>Understand the non-bypassable validation gates.</small><b aria-hidden="true">→</b></a></nav>
