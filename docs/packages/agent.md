# `@varendo/agent`

`@varendo/agent` connects an optional agent session to an existing Varendo
application. Its root entry exposes application tool endpoints and host-owned
sessions; protocol and model integrations stay on explicit subpaths.

## Main entry point

```ts
import { createAppToolEndpoint } from '@varendo/agent';

const endpoint = createAppToolEndpoint({
  runtime: app.runtime,
  render: app,
  regionId: 'people-main',
  goalEpoch: 'people-session-1',
  transport: 'mcp',
  expiresAt: Date.now() + 30 * 60_000,
});
if (!endpoint.ok) throw new Error(endpoint.diagnostics[0].message);
```

The endpoint exposes bounded context, render, and action tools for one paired
Region. Protected actions still require host policy and user confirmation.
Agent proposals cannot add a resource, action, permission, renderer, endpoint,
or executable code.

### Action continuity across MCP requests

MCP server factories create and close a fresh endpoint for discovery and each
tool call. Use `createAppToolSession` when an action preview must survive those
request boundaries. The trusted host owns one session for one authenticated
principal, Region, scope, goal, and expiry; it supplies fresh borrowed endpoints
to the server factory and confirms required actions through its own UI.

```ts
import { createAppToolSession } from '@varendo/agent';
import { createMcpHttpHandler } from '@varendo/agent/mcp';

const session = createAppToolSession({
  runtime: app.runtime,
  render: app,
  regionId: 'people-main',
  goalEpoch: 'people-session-1',
  transport: 'mcp',
  expiresAt: Date.now() + 30 * 60_000,
});
if (!session.ok) throw new Error(session.diagnostics[0].message);

const handler = createMcpHttpHandler({
  authenticate: authenticateThisPrincipal,
  createEndpoint({ authInfo }) {
    // This host function resolves identity from authenticated server state.
    const identity = authorizedPairingFor(authInfo);
    const endpoint = session.value.createEndpoint(identity);
    if (!endpoint.ok) throw new Error(endpoint.diagnostics[0].message);
    return endpoint.value;
  },
});
// Trusted UI, after the user reviews the preview:
await session.value.confirmAction(previewId);
// The host closes both resources when its authenticated session ends:
session.value.close();
await handler.close();
```

`authenticateThisPrincipal` verifies each request, and `authorizedPairingFor`
resolves its trusted `{ principalKey, scopeDigest }`. `createEndpoint(identity)`
rejects either identity mismatch without cancelling the original caller's
session. Resolve identity and select sessions using host authentication, never
tool arguments or a client-supplied workspace ID. Each borrowed endpoint still
closes independently.
Closing the host session cancels its retained previews and aborts its endpoints.
Expiry or an observed principal/scope change permanently fences the session,
including a subsequent return to the old scope. Action execution remains
subject to the runtime's fresh execute grant, confirmation, revocation, and
single-use receipt checks. `createAppToolEndpoint` continues to own and cancel
its previews when used directly.

A trusted `context.read()` adapter may add `customIntents` and `patterns` to
each routable resource in `varendo_context`. A custom intent entry contains its
registered version reference and JSON input schema. A pattern entry contains
its registered version reference, matching intent reference, and output roles.
Expose only entries that the paired render port can compile and resolve; this
metadata grants no new capability.

For a time-bounded resource, the trusted adapter may also provide
`queryConstraint` with a plain-language interpretation, the exact
`requiredFilter`, and an optional `supportedPeriod`. This lets a model use the
host's approved local-day boundary without guessing the current date. The host
must validate proposals against those constraints before rendering. The J2
attendance example verifies a proposed period, lowers it to a civil-day
filter, and rejects alternate filters or periods; the agent package does not
apply those rules automatically.

## Designed for model tool use

The tools are shaped so a model can succeed on its first call:

- `varendo_context` returns each resource's fields, meanings (measures), views,
  a `viewGuide` that explains what each view is for, the supported
  `timeGrains`, and `examples`: ready-to-send intents derived from the resource
  metadata, such as a list, a filter, a monthly trend, and a per-category
  breakdown.
- `varendo_render` documents every intent property. The model may omit
  `version`, `id`, and a measure `revision` that has only one value; the
  endpoint fills them before the strict intent parser runs. A trend's calendar
  and timezone default to the time field's declared policy.
- When an input names an unknown field, view, measure, filter value, or time
  grain, the diagnostic includes the valid choices available in the paired
  context when they are known. A measure entry must be an object such as
  `{"id":"hires"}`; a string entry is a shape error, not an unknown measure.
  Diagnostics use the tool's own property names.
- `renderer-ready` confirms that the host showed the view. `plan-committed`
  confirms only that the plan committed; do not say it is visible without a
  `renderer-ready` result.

`VARENDO_AGENT_INSTRUCTIONS` is a recommended system prompt for model hosts.
Append product guidance when needed; the tool boundary enforces the rules
either way.

```ts
import { VARENDO_AGENT_INSTRUCTIONS } from '@varendo/agent';
```

## Optional integrations

| Subpath                         | Responsibility                                         |
| ------------------------------- | ------------------------------------------------------ |
| `@varendo/agent/app`             | Application tool endpoints and host sessions; identical to the root entry |
| `@varendo/agent/mcp`             | MCP client and server adapters                         |
| `@varendo/agent/webmcp`          | Browser WebMCP capability adapter                      |
| `@varendo/agent/model`           | Provider-neutral model tool loop                       |
| `@varendo/agent/model/openai`    | OpenAI model adapter                                   |
| `@varendo/agent/model/responses` | Responses transport integration                        |
| `@varendo/agent/protocol`        | Lower-level Varendo agent protocol endpoint             |
| `@varendo/agent/capabilities`    | Host-owned capability registry and dispatch            |
| `@varendo/agent/session`         | Session scope, expiry, and lifecycle                   |
| `@varendo/agent/meaning`         | Meaning-related agent capabilities                     |
| `@varendo/agent/browser`         | Optional scoped bridge for explicit surface targets    |

## Scoped browser bridge (0.5)

`connectAgent` pairs a host-owned client to an already authorized scope and an
explicit target allowlist. The host registers each target with a live surface;
the bridge does not search the DOM or discover every surface in the runtime.
This entry belongs to the 0.5 release line. The historical `0.5.0-rc.1` was
built from an earlier revision; verify its export
map before attempting to use this entry from that package.

```ts
import { connectAgent, type AgentClient } from '@varendo/agent/browser';

const client: AgentClient = {
  kind: 'host-agent-client',
  registeredTargets: [{ id: 'people-main', surface: peopleSurface }],
};
const connection = connectAgent({
  scope: authorizedScope,
  client,
  targets: ['people-main'],
});
// The host disconnects this pairing when its screen or session ends.
connection.disconnect();
```

`peopleSurface` and `authorizedScope` above are application-owned values,
created through `@varendo/runtime/surfaces` and
`@varendo/runtime/scopes`. The snippet shows the bridge boundary; the complete
synthetic setup and cleanup are in `examples/vnext/journeys` and
`tests/vnext/fixtures/agent.ts`. A target's optional `render` callback may
acknowledge a renderer-ready revision; without it, a committed controller
request is not proof that a view rendered. When authority, activation epoch,
target, or principal changes, the old pairing is fenced and scoped conversation
continuity must reset. The target list grants no new data permission.

`connectAgent` accepts an optional `grants` ceiling of operation grants. The
pairing's effective authority is always the intersection of that ceiling and
the operations its registered tools require — a broader ceiling is clamped,
never unioned. `manual` pairings can never carry `model.egress`.

Install optional provider or transport dependencies only for the integrations
the host enables. Keep credentials in the host and outside prompts or tool
arguments.

## MCP HTTP OAuth issuer binding

The MCP HTTP adapter requires `@modelcontextprotocol/client` `2.2.0`.
For an OAuth provider, configure `policy.expectedIssuer` and bind all stored
client information and tokens to that same trusted issuer. Bundled providers
accept `expectedIssuer` in their constructor:

```ts
import { ClientCredentialsProvider } from '@modelcontextprotocol/client';
import { connectMcpHttpClient } from '@varendo/agent/mcp';

const client = await connectMcpHttpClient({
  url: 'https://tools.example.com/mcp',
  targetRegionId: 'people-main',
  goalEpoch: 'people-session-1',
  policy: {
    allowedOrigins: ['https://tools.example.com'],
    expectedIssuer: 'https://auth.example.com',
  },
  authProvider: new ClientCredentialsProvider({
    clientId: hostClientId,
    clientSecret: hostClientSecret,
    expectedIssuer: 'https://auth.example.com',
  }),
});
```

Custom OAuth providers must preserve the `issuer` fields passed to
`saveClientInformation()` and `saveTokens()`. Migrate legacy credentials without
an issuer using their independently trusted original issuer, or clear them and
sign in again. Missing or mismatched credential stamps are rejected before a
network request. Discovery cannot select another issuer for later credential
reads, and `skipIssuerMetadataValidation: true` is rejected. The endpoint origin
allowlist and redirect rejection remain in force. A simple static bearer
provider (`{ token: async () => hostToken }`) does not require an OAuth issuer.

Capability input and advisory metadata are copied and deeply frozen during
admission, before authorization awaits. Later caller mutations cannot change
the admitted payload, its byte budget, or its authority checks; the caller's
own objects remain mutable.

## Model profile configuration

Use `createOpenAICompatibleToolModel` for a generic Chat Completions endpoint.
Its `baseURL`, model ID, auth scheme, capabilities, and egress policy are
explicit configuration; the adapter never infers a provider or model from a
hostname or key format. `auth: { scheme: 'none' }` is limited to an explicit
loopback endpoint (`localhost`, `127.0.0.1`, or `[::1]`) whose exact origin is
in `policy.allowedOrigins`. HTTP additionally requires explicit insecure-HTTP
permission. Hosted
bearer and custom-header connections require a server-owned
`createOpaqueModelSecret` handle, and missing credentials fail closed.

The model connection is non-streaming and supports bounded retries,
cancellation, request/response limits, optional provider usage, and local input
token estimation. Declare only capabilities the endpoint actually supports;
protocol fixtures do not qualify model quality or live provider support.
