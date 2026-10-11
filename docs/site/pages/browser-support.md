---
id: "browser-support"
path: "/ship/browser-support/"
section: "Releases"
title: "Browser support"
description: "Separate required web-platform behavior, verified journey coverage, and experimental WebMCP availability."
---

<p class="lead">Check which browser features Varendo requires and which journeys are verified. WebMCP stays a separate, opt-in capability.</p>

The web package targets current evergreen browsers with Custom Elements, Shadow
DOM, ES modules, `AbortController`, `ResizeObserver`, and modern CSS. The public
site and component library are exercised in Chromium, Firefox, and WebKit.

## Browser behavior

- Components use native controls where they fit and preserve keyboard access.
- Reduced motion and forced colors follow the matching browser preferences.
- Layout adapts to container width and text direction rather than user-agent
  detection.
- Server imports do not register custom elements or read browser globals. Call
  `registerAeliqoElements()` at the client entry point.

## Optional WebMCP

WebMCP is experimental and depends on native browser support. When the browser
does not expose the capability, the playground reports that state. Buttons,
filters, forms, and structured intents stay available.

| Result                      | Release evidence                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Required interface behavior | Chromium, Firefox, and WebKit browser suites, keyboard checks, accessibility checks, and reviewed captures at 360, 768, and 1440 pixels |
| Simulated WebMCP contract   | Injected host tests for registration, the three standard tools, rendering, cancellation, disposal, and late denial                      |
| Native WebMCP               | Separate opt-in headed Chrome probe; record the browser version, flag state, and observed native lifecycle                              |
| Unavailable fallback        | Capability detection reports unavailable while the complete interface remains usable without an agent                                   |

Run `pnpm test:protocol-webmcp:native` only for native evidence. A simulated
pass must not be presented as browser support. See [WebMCP](/agents/webmcp/)
for the API and evidence limits.
<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/agents/webmcp/"><span>WebMCP</span><small>Implement capability detection and manual fallback.</small><b aria-hidden="true">→</b></a><a href="/ship/"><span>Release gate</span><small>Review the full browser and accessibility matrix.</small><b aria-hidden="true">→</b></a></nav>
