---
id: 'webmcp'
path: '/agents/webmcp/'
section: 'AI agents'
title: 'WebMCP (experimental)'
description: 'Detect native browser support and register bounded tools only when the current browser exposes the required capability.'
---

<p class="lead">WebMCP lets a browser agent call Varendo's registered tools on the page. The agent proposes an intent; the same application validates it and renders the result. The public Playground needs no API key.</p>

## 1. Enable the browser experiment

Varendo's native journey was tested with Chromium **153.0.8010.12** and the
`WebMCPTesting` flag. Browser support is experimental; a version number alone
does not mean the API is enabled.

1. Open `chrome://flags/#enable-webmcp-testing` in Chrome.
2. Set **WebMCP for testing** to **Enabled**, then relaunch.
3. Open the [Playground](/playground/) and choose **Browser agent**.

The setup status should say **Browser API available**. If it says unavailable,
check the flag, browser policy, and the document's permissions. Manual tasks
remain available in every supported browser.

Production sites can instead enroll for a domain-specific origin-trial token.
Enrollment and deployment are owned by the site maintainer; this guide does
not imply that an origin trial is enabled on every Varendo domain. See
[Chrome's setup instructions](https://developer.chrome.com/docs/ai/webmcp).

## 2. Register and call the tools

1. Choose **Enable WebMCP**. The status should report **registered 3 tools**.
2. Copy the example prompt and give it to your browser agent. It must be able
   to discover and invoke WebMCP tools in the current tab. Enabling the flag
   alone does not install an agent.
3. Ask the agent to show Engineering employees. The result changes on the page;
   **Inspect** shows the accepted request, result, and chosen presentation.
4. Try the workspace and entire-page demos. The connection stays active while
   the same endpoint targets the current registered demo.
5. Choose **Disconnect** or **Reset playground** to unregister the tools and
   cancel work owned by that connection.

The website does not call a model. Your browser agent owns its model,
credentials, and any model charges. For a desktop MCP client or server-side
BYOK, [run the local example](/agents/mcp/).

<h2>Detect support in your app</h2>

Call `detectWebMcp` with the real `document`. It reports support when the
document exposes `modelContext.registerTool`. The adapter never reads globals
itself; you pass the document in. Mark the evidence `native` only when the
browser supplied the capability.

**capability.ts**

```ts
import { detectWebMcp, registerWebMcpTools } from '@varendo/agent/webmcp';

const hostDocument = typeof document === 'undefined' ? undefined : document;
const capability =
  hostDocument === undefined ? detectWebMcp() : detectWebMcp({ document: hostDocument, evidence: 'native' });
if (capability.supported) {
  const registration = await registerWebMcpTools({ endpoint, document: hostDocument, evidence: 'native' });
  // Retain registration.value.adapter and close it with the session.
} else {
  showManualControls();
}
```

<h2>Keep a manual fallback</h2><p>The same resource must remain fully usable through buttons, filters, forms, and routes. Native registration is an optional communication surface, not a dependency for rendering or authorization.</p>
<h2>Read the evidence correctly</h2>

| Evidence    | What it proves                                                                                                 | What it does not prove                                |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Native      | A supported browser registered, discovered, executed, cancelled, unregistered, and rejected a late Varendo tool | Support in every browser channel or enterprise policy |
| Simulated   | The adapter maps discovery, annotations, cancellation, receipts, and lifecycle to an injected test host        | Browser implementation availability                   |
| Unavailable | The current document exposes no supported `modelContext` host                                                  | A failure in buttons, forms, MCP, or BYOK             |

Chrome's [imperative API guidance](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
defines tool registration, discovery, execution cancellation, and disposal.
As of Chrome 153, unregistering a tool does not cancel work already in flight,
so Varendo also checks the endpoint lifecycle after execution and rejects late
results. Cross-origin tools additionally require the browser `tools`
Permissions Policy and explicit origin exposure.
<aside class="doc-callout" data-tone="warning"><strong>Experimental status</strong><p>WebMCP is still experimental and its browser API can change. Keep native, simulated, and unavailable evidence separate in test reports and product copy.</p></aside>
<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/agents/"><span>Agent overview</span><small>Compare MCP, BYOK, and WebMCP.</small><b aria-hidden="true">→</b></a><a href="/guides/adaptive-region/"><span>Manual Region path</span><small>Keep the full interface functional without an agent.</small><b aria-hidden="true">→</b></a></nav>
