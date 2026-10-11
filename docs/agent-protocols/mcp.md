# MCP adapter

The Varendo MCP adapter is a protocol boundary around the host-owned
`AgentToolEndpoint`. It translates MCP tool discovery and calls into the same
endpoint used by the direct, WebMCP and BYOK routes. It does not create a
principal, decide grants, execute arbitrary code, or select the last connected
browser tab.

The adapter uses the official MCP TypeScript SDK 2.0.0 and pins clients to the
supported protocol revision, `2026-07-28`. The adapter exposes one protocol
contract so discovery, calls, and receipts follow the same request lifecycle.

## Local stdio

Create a new endpoint for discovery and for every call. The endpoint owns the
pairing, expiry, region, goal epoch, grants and dispatcher admission:

```ts
import { createMcpStdioServer } from '@varendo/agent/mcp';

createMcpStdioServer({
  createEndpoint: () => createPairedEndpoint(),
  name: 'my-aeliqo-server',
  version: '1.0.0',
  maxBufferSize: 10 * 1024 * 1024,
});
```

The `version` field identifies the application MCP server, not the installed
Varendo package or wire-contract version.

The stdio process must reserve stdout for MCP frames. Diagnostics belong on
stderr or in bounded receipts; secrets must never be printed to either stream.
`maxBufferSize` is enforced by the SDK transport before a frame reaches the
endpoint.

An application-owned agent can connect with the official stdio client:

```ts
import { connectMcpStdioClient } from '@varendo/agent/mcp';

const endpoint = await connectMcpStdioClient({
  server: { command: 'my-aeliqo-server', args: [] },
  targetRegionId: 'region-1',
  goalEpoch: 'goal-7',
});

const tools = await endpoint.discover();
const receipt = await endpoint.invoke('summary', { query: 'active' }, {
  requestId: 'request-42',
});
endpoint.close();
```

The client bypasses the SDK's private tool-list cache on every discovery. This
keeps revocation and scope changes visible. Tool metadata is treated as
untrusted wire data and must contain an Varendo capability reference and exact
operation; the adapter never invents missing authority. A tool call must refer
to a tool from the endpoint's latest successful discovery, and the returned
receipt must repeat that tool's capability and operation binding.

## Authenticated Streamable HTTP

HTTP requires an application-owned authentication gate. The gate may be the
official SDK `requireBearerAuth` helper backed by the application's verifier,
or an equivalent trusted resource-server middleware. The adapter receives only
the verified `AuthInfo`; it never reads a principal from tool arguments or
forwards an inbound token to another service.

```ts
import {
  createMcpHttpHandler,
  type McpHttpAuthGate,
} from '@varendo/agent/mcp';

const authenticate: McpHttpAuthGate = applicationBearerGate;
const handler = createMcpHttpHandler({
  authenticate,
  allowedHostnames: ['mcp.example.com'],
  allowedOriginHostnames: ['app.example.com'],
  resourceServerUrl: new URL('https://mcp.example.com/mcp'),
  issuer: 'https://issuer.example',
  createEndpoint: ({ authInfo, requestInfo }) =>
    createAuthenticatedEndpoint({ authInfo, requestInfo }),
});

export default handler;
```

`allowedHostnames` and `allowedOriginHostnames` use the official SDK DNS
rebinding and Origin guards. `resourceServerUrl` checks the RFC 8707 resource
audience carried by verified authentication, while `issuer` checks the
application verifier's issuer stamp in `AuthInfo.extra`. Expired or malformed
authentication is rejected before endpoint discovery. OAuth registration,
issuer discovery, tenant identity and token storage remain application
responsibilities.

Connect through the official Streamable HTTP client and supply an
application-owned bearer provider:

```ts
import { connectMcpHttpClient } from '@varendo/agent/mcp';

const endpoint = await connectMcpHttpClient({
  url: 'https://mcp.example.com/mcp',
  policy: { allowedOrigins: ['https://mcp.example.com'] },
  authProvider: { token: () => applicationAccessToken() },
  targetRegionId: 'region-1',
  goalEpoch: 'goal-7',
});
```

The client requires HTTPS and refuses HTTP redirects. A local development or
test server may opt into plain HTTP only on `localhost`, `127.0.0.1`, or `::1`
with `policy: {allowInsecureLoopback: true}`. `allowedOrigins`, when supplied,
contains exact origins and rejects a mismatched endpoint before authentication.

Request cancellation is forwarded through the SDK's per-request signal. A
closed or expired endpoint rejects late calls, and every discovery/call creates
a fresh host endpoint so private metadata is not retained across revocation.

## Wire and evidence boundaries

MCP tool definitions carry only bounded schemas and a capability binding marker;
the marker is metadata, not a grant. Tool inputs, `_meta`, result text and
structured content are untrusted and bounded. Receipt correlation requires the
caller request ID, target region, goal epoch and MCP transport to agree.

The official SDK references are [the TypeScript SDK v2]
(https://ts.sdk.modelcontextprotocol.io/v2/), [the protocol-version guide]
(https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md),
and [MCP authorization]
(https://modelcontextprotocol.io/specification/latest/basic/authorization).

Adapter tests cover actual SDK stdio child processes, the supported protocol
revision, Streamable HTTP, auth expiry/audience/issuer/origin rejection,
cancellation, malformed and oversized payloads, fresh endpoint construction,
and absence of secrets in protocol output. Live external identity providers,
tenant policy and paid-provider reasoning remain separate application evidence
gates.
