---
id: 'agents'
path: '/agents/'
section: 'AI agents'
title: 'Connect an agent'
description: 'Pair MCP, experimental WebMCP, or a host-supplied model with one authorized application session and Region.'
---

<p class="lead">Add an agent only when your product wants language-driven UI. Varendo itself stays deterministic: your code can send the same intent with no model.</p>
<h2>Pick a way to connect</h2>
<div class="decision-grid"><article><h3>Browser agent</h3><p>Enable experimental WebMCP in the public Playground. A browser agent calls the page's tools; manual controls stay available.</p><a href="/agents/webmcp/">Try WebMCP →</a></article><article><h3>MCP client</h3><p>Run the standalone local example and connect an MCP client through HTTP or stdio.</p><a href="/agents/mcp/">MCP setup →</a></article><article><h3>Your model</h3><p>Run a bounded tool loop in your Node host. Configure the endpoint, protocol, model, and authentication; keys stay on the server.</p><a href="/agents/byok/">BYOK setup →</a></article></div>
<p>The runtime does not depend on a model provider. MCP and WebMCP connect agents through tools; <code>ToolModelPort</code> connects a host-selected model protocol. The supplied Chat Completions and Responses adapters require those wire formats. A different protocol can implement the same port without changing your data or rendering code.</p>
<h2>Know the three tools</h2><div class="doc-table"><table><thead><tr><th>Tool</th><th>Purpose</th><th>Cannot do</th></tr></thead><tbody><tr><th><code>varendo_context</code></th><td>Discover resources, fields, meanings, views, and actions visible to this session.</td><td>Read undisclosed rows or acquire grants.</td></tr><tr><th><code>varendo_render</code></th><td>Submit an intent through validation, evaluation, recipe selection, and Region commit.</td><td>Send HTML, JavaScript, SQL, or module URLs.</td></tr><tr><th><code>varendo_act</code></th><td>Preview or request execution of a registered business action.</td><td>Confirm itself or bypass server authorization.</td></tr></tbody></table></div>
<h2>Read a tool call</h2><p><code>varendo_render</code> accepts the same intent envelope your code sends. This call asks the paired Region to browse permitted People rows:</p>

**varendo_render input**

```json
{
  "version": "1",
  "id": "browse-engineering",
  "kind": "browse",
  "resource": "people",
  "fields": ["name", "team"],
  "filter": { "op": "compare", "field": "team", "comparison": "eq", "value": "Engineering" }
}
```

<p>The tool returns a trusted receipt. <code>renderer-ready</code> means the browser acknowledged the commit. <code>denied</code> means current authority rejected the request.</p>
<h2>Trust the boundary</h2><p>The agent proposes. The runtime validates. The Region commits. Your agent never emits executable UI, and you confirm consequential actions yourself.</p>
<aside class="doc-callout" data-tone="boundary"><strong>What “AI cannot hallucinate UI” means</strong><p>A model may still misunderstand valid language. Varendo guarantees that unknown resources, fields, actions, views, functions, stale proposals, over-budget payloads, and unauthorized operations are rejected before execution. It does not guarantee perfect interpretation.</p></aside>
<p>Discovery can show that a requested concept is unavailable. Answer truthfully instead of forcing unrelated data on screen. The local runner labels model-only prose as a draft and leaves the Region unchanged.</p>
<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/agents/quickstart/"><span>Agent quickstart</span><small>Pair one endpoint with an existing app.</small><b aria-hidden="true">→</b></a><a href="/concepts/safety/"><span>Safety model</span><small>Understand validation and proof boundaries.</small><b aria-hidden="true">→</b></a></nav>
