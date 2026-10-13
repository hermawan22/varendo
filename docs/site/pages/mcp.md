---
id: 'mcp'
path: '/agents/mcp/'
section: 'AI agents'
title: 'MCP'
description: 'Connect an MCP client to the bounded Varendo endpoint through a trusted local host.'
---

MCP lets an external client request a UI change through your application's
registered resources and views. The standalone local example renders a People
directory and connects that browser session to a loopback Node host. Both
Streamable HTTP and stdio use the same three public Varendo tools. A successful
render returns `renderer-ready` after the browser commits it.

## Install a standalone copy

Use Node.js **24.20.0**, pnpm **11.24.0**, and Git. These commands copy only the
example out of the source checkout; its dependencies use exact registry
versions rather than workspace links. This checkout targets the unpublished
0.2.0 candidate; its registry install works only after 0.2.0 is published.
See the [package guide](/reference/packages/) for the exact-version installation contract:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/hermawan22/varendo.git varendo-source
git -C varendo-source sparse-checkout set examples/local-agent
cp -R varendo-source/examples/local-agent ./varendo-local-agent
cd varendo-local-agent
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install
pnpm dev
```

`pnpm dev` typechecks and builds the Vanilla/Vite UI, then starts the Node
host. The example pins `@varendo/core`, `runtime`, `web`, and `agent` to **0.2.0**.
Keep its `pnpm-workspace.yaml` when copying it: this gives the independent
installation its own workspace boundary.

The terminal prints the browser URL, HTTP endpoint with a bearer token, and
stdio command. Open **http://127.0.0.1:4174/**. You should see Ada Lovelace,
Grace Hopper, and Margaret Hamilton, plus **Connected — MCP is ready**.
Keep this page open while the client works. Startup makes no model request;
the optional model prompt remains disabled until server configuration exists.

The public [Playground](/playground/) supports manual controls and WebMCP.
Use this standalone example for local MCP and server model connections.

## Connect an MCP client

For a client that accepts Streamable HTTP, use the printed token:

```json
{
  "mcpServers": {
    "varendo-local": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:4174/mcp",
      "headers": { "Authorization": "Bearer <printed-token>" }
    }
  }
}
```

For a client that launches a stdio child process, use an **absolute path** to
your copied example. `node` must resolve to the pinned Node installation:

```json
{
  "mcpServers": {
    "varendo-local": {
      "command": "node",
      "args": ["/absolute/path/varendo-local-agent/runner/mcp-stdio.mjs"],
      "env": {
        "VARENDO_LOCAL_URL": "http://127.0.0.1:4174",
        "VARENDO_MCP_TOKEN": "<printed-token>"
      }
    }
  }
}
```

The stdio bridge uses stdout only for MCP frames. Leave the Node host running;
the child connects to it over loopback. The token stays in the terminal and
client configuration, never the page. Use `VARENDO_LOCAL_PORT=4175 pnpm dev`
if port 4174 is occupied, and update the client URL to the printed address.

## Render a different view

Ask your client: **Show People as cards.** It should discover these tools,
call `varendo_context`, then call `varendo_render` with a bounded intent:

```json
{
  "version": "1",
  "id": "people-cards",
  "kind": "browse",
  "resource": "people",
  "fields": ["name", "team"],
  "preferredView": "cards"
}
```

| Tool             | Purpose                                                                     | Evidence                                      |
| ---------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| `varendo_context` | Discover current registered resources, fields, meanings, actions, and views | An `accepted` context receipt                 |
| `varendo_render`  | Validate and render a structured intent                                     | `renderer-ready` after browser acknowledgment |
| `varendo_act`     | Propose a registered application action                                     | A staged receipt subject to host policy       |

The People example registers no business actions. Discovering `varendo_act`
does not grant permission to execute an action. Unknown fields and views fail validation and
leave the last valid UI intact. No agent HTML or code is executed.

## Understand the example files

- `src/app.ts` registers People and monthly workforce data through public
  resource, data-service, and app APIs, starting from the quickstart example.
- `src/session.ts` creates the bounded `createAppToolEndpoint` pairing.
- `src/local-host.ts` carries calls and acknowledgments over a same-origin event
  stream; `runner/broker.mjs` owns the expiring host pairing.
- `runner/server.mjs` serves the built UI and uses `@varendo/agent/mcp` for HTTP.
  `runner/mcp-stdio.mjs` adapts stdio to that same session.

The host binds only to loopback, validates Host and Origin, requires a
same-origin bootstrap header, and issues a 15-minute HttpOnly SameSite cookie.
It limits pending calls to two, individual calls to 15 seconds, and validates
bounded acknowledgments. Disconnect and expiry reject late results and close
the pairing. Choose **Start a new session** and reconnect the client after
expiry. Restarting the host generates a new bearer token.

## Host-session and OAuth changes in 0.7

Varendo 0.7.0 includes security corrections and a new host-owned
`createAppToolSession` that retains action previews across
fresh MCP requests. Each request must supply its authenticated principal and
scope to `session.createEndpoint(identity)`; confirmation belongs to the
trusted host UI. Close the session when authentication ends. A client workspace
ID or tool argument cannot establish this identity.

OAuth HTTP clients must configure `policy.expectedIssuer`. Stored client
information and tokens must carry the same issuer stamp; migrate legacy
storage only from a trusted issuer or clear it and authenticate again.
Issuer-validation bypasses are rejected. Static bearer authentication, including
the standalone example above, remains supported.

See the canonical [agent package guide](https://github.com/hermawan22/varendo/blob/main/docs/packages/agent.md)
for the source API and the [0.6 to 0.7 migration guide](/ship/migration-0.6/)
for the breaking OAuth change. Candidate source is separate from verified
package publication.

## Recover from connection problems

If a client gets `401`, open the local UI, confirm it says Connected, and use
the current terminal token. If the UI says Disconnected, start a new session.
If the build reports missing dependencies, run `pnpm install` inside the
copied example with the pinned toolchain. Do not connect the public hosted
Playground to this local host; the browser session and host must share an origin.

A remote deployment needs its own HTTPS, user authentication, scoped sessions,
rate limits and MCP authorization implementation. The loopback development
host is not a shared deployment template. See the public
`@varendo/agent/mcp` APIs in the [package map](/reference/packages/).

<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/agents/byok/"><span>Bring your own model</span><small>Add an optional bounded server model loop.</small><b aria-hidden="true">→</b></a><a href="/agents/recovery/"><span>Agent recovery</span><small>Handle expiry, failure, and uncertain outcomes.</small><b aria-hidden="true">→</b></a></nav>
