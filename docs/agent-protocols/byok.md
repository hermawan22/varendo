# Application-owned BYOK model port

`@varendo/agent/model` exports `ToolModelPort` and `runToolModel`. The model port
only counts input tokens and proposes text/function calls. Every proposed call
uses the same registered capability dispatcher as the manual, MCP and WebMCP
paths. The loop contains no query evaluator or provider-specific planner.

Create an expiring `createAgentToolEndpoint` from `@varendo/agent/protocol` with
`transport: 'byok'`, an explicit region/goal/principal, trusted host authority,
and the capability registry. Pass that endpoint, the host-approved prompt,
`goal: 'chat' | 'experience'`, and an explicit `ToolModelBudget` to the loop.
No page contents, host context, catalog, records or credentials are collected
automatically. Authorized capability results become bounded tool messages.

The loop checks current model egress before token counting, before generation,
after generation, and around tool calls. Token counting may itself contact a
provider. Separate operation grants still control evaluation, meaning activation,
presentation and business actions. A changed principal, goal or authorization
scope stops the loop. Model quality has no effect on those checks.

Budgets limit turns, model requests (counting included), tool calls, elapsed time,
input/output/total generation tokens, request/response bytes and repeated calls.
Input counting plus reserved maximum output tokens must fit before generation.
Provider-reported usage is checked afterward. These limits bound request and
token consumption; the application owns provider pricing and a monetary spend
limit. No SDK retry is enabled in the reference port. Cancellation propagates to
the provider and tool boundary, but cannot undo an already completed remote
request or business transaction. Inspect partial/recovery capability receipts.

A chat completion returns `textDraft`; it is unverified prose, not a validated
numerical narrative. Apply the existing claim/evidence policy before presenting
it as a fact. An experience request finishes successfully only with an actual
`renderer-ready` capability receipt. A model saying it updated the screen yields
`no-commit`. Renderer readiness identifies the committed region revision; it
does not certify browser paint or human attention.

Applications may provide an opt-in `policy.requiredOperationSequence`. Each
milestone names an operation and explicit positive receipt states. While a
milestone is pending, the loop exposes only tools for that operation. A host may
explicitly select `providerToolChoice: 'required'` as an adherence hint when its
endpoint supports it; the portable default is `auto`. Final text remains blocked
until trusted dispatcher receipts satisfy the sequence in order; model prose,
tool names and result values cannot advance it. Premature text or an out-of-order
proposal receives bounded repair feedback, and an out-of-order proposal is not
dispatched. The policy never adds a grant, bypasses the existing scope rechecks,
or proves that a shape-valid task matches the user's intent.

This final-text gate belongs to the application-owned BYOK loop. MCP and WebMCP
hosts own their agents' prose surfaces; an application that requires the same
guarantee there must gate its own display/finalization on session-scoped trusted
receipts. Varendo's protocol adapter can enforce capability invocation but cannot
prevent an external host from printing text outside that boundary.

## Optional official OpenAI reference

`@varendo/agent/model/openai` exports `createOpenAIToolModel`. Install the exact
optional `openai` peer version recorded in the agent package, create the official
SDK client on a trusted server, and supply an explicit model ID. The reference
uses Responses function tools and input-token counting, disables retries,
parallel tool calls, truncation, storage and streaming, and passes full bounded
function-call/output correlation on every turn. Other providers implement the
normalized port rather than replacing the semantic executor.

The default agent, protocol and model entries do not import a provider SDK.
API keys belong to the host-created SDK client and are never placed in tool
arguments, returned receipts or logs. The OpenAI port requires
`environment: 'trusted-server'`; set it only in the server-owned model
composition root. The agent package does not inspect `window` or other DOM
globals to infer where it is running.

The official SDK HTTP exchange is tested against a local protocol fixture.
Synthetic model tests cover containment, permissions, cancellation and budgets.
Neither establishes real natural-language reasoning or live provider support.
A credentialed held-out evaluation still requires explicit budget authorization.

## OpenAI-compatible Responses transport

`@varendo/agent/model/responses` supplies
`createOpenAICompatibleResponsesToolModel` for a trusted server that owns an
OpenAI-compatible Responses endpoint. It is deliberately provider-agnostic:
applications configure `environment: 'trusted-server'`, the HTTPS base
endpoint, explicit model ID, opaque credential reference, credential resolver,
and request policy independently. The
transport never selects a provider or model from credential contents, a reference
format, or an endpoint hostname.

Create opaque secrets with `createOpaqueModelSecret(secret, 'trusted-server')`
only on the trusted server. The resolver receives the opaque reference and an
abort signal, and returns a
credential only within the server request. Credentials, authorization headers,
endpoint URLs, and provider response bodies are never placed in a model receipt or
transport error. The request policy requires `maxRetries: 0`, explicit timeout and
byte limits, and `stream: false`. The transport performs no retry itself. Caller
cancellation and timeout reach credential resolution and `fetch`; an already
completed remote request cannot be undone.

It implements `responses/input_tokens` counting and non-streaming
`responses` completion with Responses function-call proposals. `ToolModelPort`
does not expose streaming events and this transport does not buffer or emulate
them; a request policy that enables streaming is rejected. Parsed tool proposals
remain untrusted and must pass `runToolModel` plus the same capability/egress
boundary as every other BYOK port. This local protocol compatibility is not proof
that a provider has been evaluated for task quality or that every
OpenAI-compatible endpoint implements the same optional features.

## Generic Chat Completions profiles

`@varendo/agent/model` also exports the provider-neutral
`createOpenAICompatibleToolModel` connection. Supply the endpoint, model,
authentication scheme, capability list, and egress policy independently:

```ts
const model = createOpenAICompatibleToolModel({
  baseURL: 'http://127.0.0.1:8787/v1',
  model: 'local-tool-model',
  auth: { scheme: 'none' },
  capabilities: ['tool-calls', 'input-token-estimate', 'request-cancellation'],
  policy: {
    allowExternalEgress: true,
    allowInsecureHttp: true,
    allowedOrigins: ['http://127.0.0.1:8787'],
  },
});
```

The no-auth scheme is an explicit allowlisted local/self-hosted profile. It is
not selected when a hosted credential is missing; bearer and custom-header
profiles require a server-owned opaque secret. HTTPS is required unless the
host explicitly enables insecure HTTP, and the connection refuses URL
credentials, redirects, arbitrary header overrides, and an unallowlisted
origin. The adapter sends `max_tokens` and `stream: false` for Chat
Completions. Endpoints without usage reporting use bounded host estimates, and
input-token counting is optional; a missing counting endpoint is not silently
invented.

The source-tested profiles are synthetic localhost Chat Completions exchanges
for no-auth, custom-header, tool-call correlation, malformed/oversized
responses, timeout and bounded retry behavior, plus the separate non-streaming
Responses adapter. These fixtures establish protocol compatibility only. No
provider quality, latency, or live model support is implied. Live qualification
requires an approved endpoint/model, synthetic corpus, credential access, and
an explicit request/spend ceiling; without those permissions it remains an
unqualified blocker rather than a skipped success.
