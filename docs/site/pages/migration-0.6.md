---
id: 'migration-0-6'
path: '/ship/migration-0.6/'
section: 'Releases'
title: 'Migrate from 0.6 to 0.7'
description: 'Pin the OAuth issuer, migrate stored credentials, and retain application action previews across authenticated MCP requests.'
---

<aeliqo-release-status></aeliqo-release-status>

## Update the packages together

Use **0.7.1** for every Aeliqo package and check the [package publication status](/reference/packages/)
before installing it. The breaking change affects MCP HTTP clients that use
OAuth. The wire contract version remains `1`; resource definitions, data
adapters, React bindings, headless runtime rendering, and static bearer
authentication remain available.

## Pin the trusted OAuth issuer

When calling `connectMcpHttpClient` with an OAuth `authProvider`, configure
`policy.expectedIssuer` with the authorization server your host trusts. A
missing issuer now rejects the connection before transport discovery. Keep
issuer metadata validation enabled; `skipIssuerMetadataValidation: true` is
rejected.

```ts
import { connectMcpHttpClient } from '@aeliqo/agent/mcp';

const client = await connectMcpHttpClient({
  url: 'https://tools.example.com/mcp',
  targetRegionId: 'people-main',
  goalEpoch: 'people-session-1',
  authProvider: trustedOAuthProvider,
  policy: {
    allowedOrigins: ['https://tools.example.com'],
    expectedIssuer: 'https://identity.example.com',
  },
});
```

Choose the issuer from trusted host configuration, not tool arguments or
unverified discovery metadata. Use HTTPS without credentials, query parameters,
or fragments. Insecure HTTP is permitted only for a loopback issuer when the
host explicitly enables `allowInsecureLoopback`.

Stored client information and tokens must include an `issuer` stamp matching
`policy.expectedIssuer`. Migrate existing credentials only when you can verify
their original issuer; otherwise clear the client information and tokens and
authenticate again. Do not stamp an unknown legacy token with the new issuer
merely to make it pass validation. Discovery of another issuer or a mismatched
stored credential fails closed.

For custom OAuth providers, preserve the `issuer` passed to
`saveClientInformation()` and `saveTokens()` when persisting credentials.
Bundled providers accept `expectedIssuer` in their constructor as well as the
policy above.

Static bearer providers, including the standalone local example, do not need
an OAuth issuer. See the [agent package guide](https://github.com/Arconath/aeliqo/blob/main/docs/packages/agent.md)
for the complete client options.

## Retain action previews across authenticated requests

`createAppToolSession` is an additive host API for MCP action previews that
must survive fresh request endpoints. The trusted host owns one session for a
fixed authenticated principal, Region, scope, goal, and expiry. Resolve each
request's `{ principalKey, scopeDigest }` from authenticated server state and
pass it to `session.createEndpoint(identity)`. A client workspace ID or tool
argument cannot establish this identity.

Close each borrowed endpoint after its request, and close the session when
its authenticated pairing ends. Confirmation belongs to the trusted host UI.
Expiry or an observed principal/scope change permanently fences the session;
returning to an old scope does not revive it. Direct `createAppToolEndpoint`
usage remains available and owns its own preview lifecycle. Follow the
[MCP guide](/agents/mcp/) for request and session ownership.

## Keep the existing presentation contracts

Continue handling `onDraftExit` and `needs-input` before replacing an unsaved
form. A `renderer-ready` receipt means the task and presentation were published
together; use `onPresentation` for successful container adaptation. Registered
layouts continue to use `stateMappings` and an owned `context.incumbent` for
explicit state transfer.

App mounting now registers its base elements synchronously and loads the
needed component families before publication. Custom extension renderers use
the full catalog fallback. Await the render receipt; do not assume that an
unrendered component family was registered during app mounting. Hosts that
need the complete standalone catalog can still call `registerAeliqoElements`
explicitly. Failed loading preserves the previous authorized result, and
cancellation or changed authority prevents stale work from publishing.
