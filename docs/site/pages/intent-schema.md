---
id: "intent-schema"
path: "/reference/intent-schema/"
section: "Reference"
title: "Intent schema"
description: "Fields, defaults, validation, and examples for browse, detail, create, edit, compare, analyze, and custom intent envelopes."
---

<p class="lead">Send one of these envelopes to <code>app.render</code> or <code>aeliqo_render</code>. Unknown fields and unregistered values are rejected before any data is read.</p>
<h2>Shared fields</h2><div class="doc-table"><table><thead><tr><th>Field</th><th>Behavior</th></tr></thead><tbody><tr><th><code>version</code></th><td>Contract version; currently <code>"1"</code>.</td></tr><tr><th><code>id</code></th><td>Bounded request identity used for receipts and supersession.</td></tr><tr><th><code>kind</code></th><td>One standard kind or <code>custom</code>.</td></tr><tr><th><code>resource</code></th><td>Registered resource ID. Unknown values are rejected.</td></tr><tr><th><code>preferredView</code></th><td>Optional preference limited to allowed registered views; omitting it enables default adaptive choice.</td></tr></tbody></table></div>
<h2>Browse</h2>

**Intent**

```json
{
  "version": "1",
  "id": "active-people",
  "kind": "browse",
  "resource": "people",
  "fields": ["name", "team"],
  "filter": { "op": "compare", "field": "active", "comparison": "eq", "value": true },
  "sort": [{ "field": "name", "direction": "asc" }],
  "page": { "size": 25 }
}
```

<h2>Detail and compare</h2><p>Identity objects must contain exactly the resource identity fields. Compare accepts bounded identities and fields and preserves simultaneous comparison requirements during presentation.</p>
<h2>Create and edit</h2><p>Create opens the registered creation form. Edit additionally requires exact resource identity; current values and entity revision come from the trusted form-state adapter.</p>
<h2>Analyze</h2><p>Measures must reference registered meanings. Dimensions, filters, period, temporal field, grain, calendar, timezone, sort, and limit are validated against the Catalog and query contract.</p>
<h2>Machine schema</h2><aeliqo-source data-label="Generated intent JSON Schema" data-path="packages/core/schemas/intent.schema.json"></aeliqo-source>
<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/concepts/intent/"><span>Intent concepts</span><small>Understand the application and agent boundary.</small><b aria-hidden="true">→</b></a><a href="/agents/quickstart/"><span>Send from an agent</span><small>Use the exact same schema through <code>aeliqo_render</code>.</small><b aria-hidden="true">→</b></a></nav>
