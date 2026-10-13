---
id: 'byok'
path: '/agents/byok/'
section: 'AI agents'
title: 'Bring your own model'
description: 'Connect a provider through a trusted local host while keeping credentials outside the browser.'
---

The standalone local agent example can connect a provider model to the same
People directory used by MCP. Credentials stay in the trusted Node process.
The browser sends a prompt to its own host and receives a bounded receipt.
The public Playground has no model prompt or provider key input.

## Install and run without a model first

Follow the exact [standalone install steps](/agents/mcp/#install-a-standalone-copy).
Open the printed URL and confirm that the People directory renders. The
**Optional server model** section says no model is configured. Default startup
makes no paid requests and MCP already works.

Stop the host with Ctrl+C. From the copied `varendo-local-agent` directory:

```bash
cp .env.example .env.local
```

Edit **.env.local** with your own provider configuration:

```dotenv
VARENDO_MODEL_BASE_URL=https://your-provider.example/v1/
VARENDO_MODEL=your-tool-capable-model
VARENDO_MODEL_PROTOCOL=openai-compatible-chat
VARENDO_MODEL_AUTH_SCHEME=bearer
VARENDO_MODEL_API_KEY=your-local-secret
VARENDO_MODEL_CAPABILITIES=tool-calls,usage,request-cancellation
```

The endpoint must implement the selected wire protocol; a model name alone
does not establish compatibility. Set the base URL expected by your provider,
including any required `/v1/` path. Never put credentials in the URL, source
files, prompts, or browser storage. `.env.local` is ignored by Git and is read
only by the Node startup command.

## Choose an explicit protocol and authentication profile

| Setting                            | Supported values and constraints                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VARENDO_MODEL_PROTOCOL`            | `openai-compatible-chat` for Chat Completions; `openai-compatible-responses` for the Responses adapter                                                     |
| `VARENDO_MODEL_AUTH_SCHEME`         | `bearer`; `header` with `VARENDO_MODEL_AUTH_HEADER`; or `none` for a local endpoint                                                                         |
| `VARENDO_MODEL_CAPABILITIES`        | A comma-separated list including `tool-calls`; supported entries also include `usage`, `request-cancellation`, `input-token-estimate`, and `request-retry` |
| `VARENDO_ALLOW_INSECURE_MODEL_HTTP` | Set to `1` only for an HTTP loopback development endpoint; remote endpoints require HTTPS                                                                  |

The Responses profile requires HTTPS bearer authentication and rejects
`request-retry`. For `header` authentication provide the exact header name
required by your compatible server. For `none`, omit both key and auth header;
the endpoint must be local. Declare capabilities your provider supports.
Incomplete or inconsistent configuration stops startup with an explicit error.

The implementation uses `ToolModelPort` through the public
`@varendo/agent/model` protocol adapters and `runToolModel`. A different wire
protocol requires an application-owned `ToolModelPort` adapter; changing the
base URL does not make incompatible providers interchangeable.

## Send a bounded prompt

Restart from the same directory:

```bash
pnpm dev
```

Open **http://127.0.0.1:4174/** and wait for Connected. The prompt is now enabled.
Sending it may incur charges from your provider and sends registered metadata
and approved tool results to that provider. Startup still sends nothing.

Enter **Show People as cards.** and choose **Send to local agent**. The model
must read `varendo_context` before rendering; the host enforces that sequence.
The browser validates the proposed intent and commits it through the same app
API as manual rendering. Cards should appear and the prompt receipt reports
how the loop stopped. A text draft alone is not evidence of a UI change.

The host permits at most four turns, model requests, and tool calls per prompt,
with a 45-second total budget, 2,000 output tokens, 36,000 total tokens, and
128 KB input/output limits. It sends non-streaming requests without automatic
retries. The browser pairing expires after 15 minutes. **Disconnect** cancels
pending work and releases the session; start a new session to continue.

## Recover and extend

If startup fails, check the explicit protocol, model, URL, authentication and
capability values together. If the provider rejects a request, verify it
supports that protocol's tool format. An unknown field or unsupported intent
must fail without replacing the last valid render. See
[agent recovery](/agents/recovery/) for expiry and uncertain outcomes.

`runner/model-config.mjs` validates trusted configuration and
`runner/model-adapter.mjs` constructs the model port. Adapt those host files
when adding another provider protocol. Keep URLs, credentials and capabilities
outside tool input. The browser bundle does not read `.env.local`, and model
credentials are never returned by session or prompt routes.

The example is a single-user loopback development host. A shared application
must supply authentication, scoped permissions, origin checks, rate/cost limits,
and its retention policy. No hosted model relay is included.

<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/agents/mcp/"><span>MCP transport</span><small>Connect an external client to the same session.</small><b aria-hidden="true">→</b></a><a href="/agents/recovery/"><span>Agent recovery</span><small>Handle expiry and rejected proposals.</small><b aria-hidden="true">→</b></a></nav>
