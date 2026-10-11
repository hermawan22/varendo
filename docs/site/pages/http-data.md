---
id: 'http-data'
path: '/guides/http-data/'
section: 'Guides'
title: 'HTTP data service'
description: 'Keep authenticated identity, credentials, source policy, and private records in the application server.'
---

<p class="lead">The browser sends a limited query. Your server authenticates the request, applies current policy, and runs it against a private source.</p>

## When you need this

- Records or credentials must stay on the server.
- You already have an HTTP layer that can serve `POST` endpoints.
- You want the browser to hold a `DataService` that talks to your backend.

<div class="boundary-diagram" role="img" aria-label="A browser request reaches an authenticated application service before the private source"><div>Browser region<small>Request + cancellation</small></div><span aria-hidden="true">→</span><div>Application service<small>Identity + policy</small></div><span aria-hidden="true">→</span><div>Private source<small>Authorized execution</small></div></div>

<aside class="doc-callout" data-tone="warning"><strong>Never trust wire authority</strong><p>Anything arriving in a request is data — user IDs, grants, policies, credentials, endpoint URLs. None of it is authority. Derive trusted context inside the host.</p></aside>

## 1. Wrap your data service

`createDataHttpHandler` turns any `DataService` into a fetch-style handler. It serves `POST` requests at `/adc/describe`, `/adc/plan`, and `/adc/execute` by default.

```js
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createDataHttpHandler } from '@varendo/runtime/data';

const handleData = createDataHttpHandler({
  service: peopleData, // your DataService — local or custom
  authenticate: (request) => authorizeRequest(request), // your session check
});

createServer(async (req, res) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const request = new Request(`http://localhost:3000${req.url}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req),
    duplex: 'half',
  });
  const response = await handleData(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body === null) res.end();
  else Readable.fromWeb(response.body).pipe(res);
}).listen(3000);
```

Any HTTP layer that can hand the handler a `Request` and send back its `Response` works. Pass request limits with `maxRequestBytes`, `maxRequestMilliseconds`, and `maxConcurrentRequests`.

## 2. Connect from the client

`createHttpDataService` is the browser half of the same protocol. Bind it to the resource like any other data service.

```ts
import { createHttpDataService } from '@varendo/runtime/data';
import { createAeliqoApp } from '@varendo/web/app';

const peopleData = createHttpDataService({ baseUrl: 'https://api.example.com' });

const app = createAeliqoApp({
  resources: [{ resource: people, data: peopleData }],
  authority, // your trusted adapter — see the permissions guide
});
```

You should see: the region renders views over remote rows. The wire carries `plan` and streamed `execute` events. A successful HTTP response alone is not proof the query was authorized or complete — the result stream carries that evidence.

## 3. Authenticate inside the host

The `authenticate` callback runs on every request. Read your own session — cookie, token, or mTLS identity — and return the signed-in user. Return a denial `Outcome` when there is none.

Never copy permissive fixture authentication into production. A production host derives the signed-in user from its own trusted session. It uses its own private source adapter and maps failures to explicit diagnostics.

## Check the whole protocol

<div class="doc-checklist"><ul><li>Discovery exposes only the metadata the authenticated session may see.</li><li>Filter, sort, pagination, nulls, units, revisions, partial results, and errors each have an explicit mapping.</li><li>Request abort reaches the database or upstream request.</li><li>Malformed or over-budget messages fail closed.</li><li>Server authorization is checked again before reads and writes.</li></ul></div>

## 4. Declare coverage honestly

The service catalog declares the supported fields, predicates, relationships, metrics, stable ordering, page size, and pagination mode. Reject anything outside that contract with a structured diagnostic. Do not fetch an entire remote source to fake a missing operation.

A page of rows is partial coverage. An unknown or estimated population stays marked that way. A complete global aggregate counts only when the accepted plan's trusted aggregate shape pins it. Descriptor evidence alone cannot create that exception.

Continuation cursors are opaque application data. Bind each cursor to the signed-in user's partition, the full target, and the normalized query and ordering. Also bind the catalog, the source revision, semantic and policy revisions, the consistency mode, and an expiry. Snapshot pagination pins one source revision. Live keyset pagination continues after the last stable identity value — it is not an offset with a new name.

## What can go wrong

- Malformed or over-budget messages fail closed. A non-`POST` request fails with `data.method`.
- Transport, content-type, and correlation failures surface as `data.http-*` diagnostics, not partial data.
- A cursor from another user partition or a stale plan fails with `data.stale-cursor` or `data.expired-plan`.
- Server authorization is checked again before reads and writes — cache never grants access.
- Request abort must reach the database or upstream call, or cancelled work keeps running.

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/guides/permissions/"><span>Authority adapter</span><small>Unify evaluator, region, action, and agent context.</small><b aria-hidden="true">→</b></a><a href="/ship/"><span>Production checks</span><small>Verify source isolation and failure handling.</small><b aria-hidden="true">→</b></a></nav>
