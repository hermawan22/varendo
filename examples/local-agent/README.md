# Varendo local agent example

A People directory that an AI agent can drive through the same validated
intents as the buttons on the page. Use it to try MCP (Streamable HTTP or
stdio) and an optional bring-your-own-key model on your own machine. The
public Playground covers manual controls and WebMCP only.

```bash
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install
pnpm dev
```

Open http://127.0.0.1:4174/ and follow the terminal output. Startup makes no
model request. Requires Node.js 24.20.0 and matching `0.1.0` packages. This
checkout targets the 0.1.0 candidate; check the
[package publication status](https://hermawan22.github.io/varendo/reference/packages/)
before installing its registry dependencies.

- [MCP guide](https://hermawan22.github.io/varendo/agents/mcp/): install a standalone copy
  and connect an MCP client over HTTP or stdio.
- [Bring your own model](https://hermawan22.github.io/varendo/agents/byok/): configure a
  provider in `.env.local`; the key stays in the Node process.

The host binds to loopback only and is a development example, not a
deployment template.
