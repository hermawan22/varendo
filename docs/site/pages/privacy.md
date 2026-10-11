---
id: 'privacy'
path: '/legal/privacy/'
section: 'About'
title: 'Privacy'
description: 'How the public documentation and synthetic playground handle data.'
---

<p class="lead">The public playground uses synthetic data and works without a model provider.</p>

## Local state

Filtering, structured intents, and evaluation run in the browser. Playground state is local to the session and can be reset. Exports must never include provider keys or private records.

## Optional analytics

If production analytics are enabled, the site asks before loading them. Aggregate events exclude form content, URL query parameters, credentials, and direct identity.

## Connected agents

The local runner keeps a BYOK key in the user-run host process. The public Playground has no browser provider-key field and makes no direct model request. A prompt entered after pairing with the local runner goes to that same-origin host, which owns provider egress and credentials. See [BYOK](/agents/byok/) for setup and failure behavior. MCP integrations use the host configured by their operator, which must disclose provider egress and protect credentials. Native WebMCP follows browser capability and policy.

## External links

Opening GitHub, npm, or another external service sends a request to that destination.
