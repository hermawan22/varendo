---
id: 'data'
path: '/guides/data/'
section: 'Guides'
title: 'Data adapters'
description: 'Connect local records, the Varendo HTTP protocol, or an application adapter without leaking credentials or inventing REST semantics.'
---

<p class="lead">Every resource binding supplies a data service. The runtime plans and runs the same query contract no matter where the rows live.</p>

## When you need this

- You are choosing where records live: a local snapshot, your server, or another store.
- You must keep credentials or raw records off the client.
- You need one query contract across sources.

## 1. Pick the boundary

<div class="decision-grid"><article><h3>Local snapshot</h3><p>Use when rows are already authorized and limited, in the browser or a worker.</p><a href="/guides/local-data/">Local guide →</a></article><article><h3>Application server</h3><p>Use the Varendo HTTP contract when records or credentials must stay on the server.</p><a href="/guides/http-data/">HTTP guide →</a></article><article><h3>Custom source</h3><p>Implement the small <code>DataService</code> interface and map filtering, sort, pagination, results, errors, and cancellation yourself.</p></article></div>

## 2. Implement three methods

A custom source implements the same `DataService` interface the built-in adapters use:

**data-service.ts**

```ts
import type { DataService } from '@varendo/runtime/data';

const service: DataService = {
  // Return only the catalog this signed-in user may see.
  describe: (request, context) => describeAllowedCatalog(request, context),
  // Accept the normalized query or reject it with a diagnostic.
  plan: (request, context) => planAuthorized(request, context),
  // Stream result events; stop when context.signal aborts.
  execute: (request, context) => executeAgainstSource(request, context),
};
```

`describe` and `plan` resolve to an `Outcome` — a value or a list of diagnostics. `execute` returns an async stream of result events: a `descriptor`, `batch` events with rows, then `complete` or `error`. The [HTTP guide](/guides/http-data/) shows a working client and server pair.

## 3. Map failures, not only rows

There is no `rest('/api/employees')` shortcut. A generic REST call cannot know your API's pagination, permissions, null handling, revisions, or error model. Write the adapter deliberately and test each mapping.

## Check the required behavior

<div class="doc-checklist"><ul><li>Validate every remote response before it becomes a result.</li><li>Preserve source revision, scope digest, identity, time period, precision, and completeness.</li><li>Pass request cancellation through to the real source work.</li><li>Enforce row, byte, column, request, and materialization limits.</li><li>Clear data that is no longer authorized when the signed-in user or scope changes.</li></ul></div>

## Audit without leaking data

The local audit exporter accepts fixed event shapes and limited numeric observations. Keep record payloads, prompts, credentials, query strings, and direct identity out of audit events.

## What can go wrong

- A response that fails validation must become a diagnostic, not silent partial rows.
- A cancelled request that still runs wastes work and can overwrite newer state.
- Responses that exceed their limits are rejected — enforce them at the source, not after.

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/guides/permissions/"><span>Permissions</span><small>Supply trusted context to every evaluation and commit.</small><b aria-hidden="true">→</b></a><a href="/concepts/safety/"><span>Safety model</span><small>Understand why browser validation does not replace server authorization.</small><b aria-hidden="true">→</b></a></nav>
