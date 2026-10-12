# Varendo

Varendo turns typed requests into views of application data. Describe a dataset
once, then request a list, a filtered result, a monthly trend, or a per-team
chart. Varendo validates the request, evaluates the permitted data, and selects
a registered view that fits the answer and the space available on screen.

The host application owns identity, permissions, data access, routes, and
business effects. Start with one region in an existing screen; registered
workspaces and pages can follow when you need several results together.

The same path works from application code or an optional agent. Agent input
cannot supply HTML, executable code, permissions, or an unregistered view.

[Documentation](https://hermawan22.github.io/varendo/) · [Playground](https://hermawan22.github.io/varendo/playground/) · [Component catalog](https://hermawan22.github.io/varendo/components/)

## Quick start

All five `@varendo` packages are published at **0.1.0**. The stable release passed
installed registry consumers and source-bound provenance verification. See the
[package guide](https://hermawan22.github.io/varendo/reference/packages/) for installation
and the [release record](docs/STATUS.md) for acceptance evidence.
For the React example below, use React 19.2 or a newer 19.x release and install matching
Varendo package versions:

```sh
npm install --save-exact \
  @varendo/core@0.1.0 \
  @varendo/runtime@0.1.0 \
  @varendo/web@0.1.0 \
  @varendo/react@0.1.0
```

The [React quickstart](https://hermawan22.github.io/varendo/start/) registers one local People
dataset and asks four questions: everyone, one team, hires per month, and hires
per team. It renders tables and charts without a model or backend. The
[registered app tutorial](https://hermawan22.github.io/varendo/start/registered-app/)
extends that setup with application-owned permissions and actions.

Never mix Varendo package versions in one application.

If React already owns a complete read-only array, the local surface API gives
you a smaller setup:

```tsx
import { AdaptiveSurface, useDataSurface } from '@varendo/react/surface';

export function People({ rows }: { rows: readonly { id: string; name: string }[] }) {
  const surface = useDataSurface({ data: rows, getRowId: (row) => row.id });
  return <AdaptiveSurface surface={surface} />;
}
```

Follow the [local data guide](https://hermawan22.github.io/varendo/guides/local-data/) for
this API's setup and limits, or the [React package guide](docs/packages/react.md)
for its full contract. If your screen already chooses its views and owns its
interaction state, use [standalone components](https://hermawan22.github.io/varendo/start/standalone-components/)
directly. Register an app when requests need shared resource definitions,
permission checks, actions, or automatic view selection.

The common application entry points are:

```ts
import { defineResource } from '@varendo/core';
import { createAeliqoRuntime } from '@varendo/runtime';
import { registerAeliqoElements } from '@varendo/web';
import { createAeliqoApp } from '@varendo/web/app';
import { AeliqoProvider, AeliqoRegion } from '@varendo/react';
import { createAppToolEndpoint } from '@varendo/agent';
```

The optional agent entry point additionally requires `@varendo/agent@0.1.0`.
Each package root contains its primary API. Component families, query planning,
transport adapters, and other advanced APIs use explicit package subpaths.

## Packages

| Package            | Responsibility                                                       |
| ------------------ | -------------------------------------------------------------------- |
| `@varendo/core`    | Wire contracts, resource definitions, and intent compilation         |
| `@varendo/runtime` | Data, authority checks, Results, Regions, actions, and runtime state |
| `@varendo/web`     | Shared web components, browser registration, and adaptive app facade |
| `@varendo/react`   | React provider, Region, hooks, and family wrappers                   |
| `@varendo/agent`   | Bounded app tools and optional MCP, WebMCP, and model adapters       |

The public component library supports host token customization. The Varendo site
uses the same canonical token source and provides system, light, and dark themes.

## Try it

- [Playground](https://hermawan22.github.io/varendo/playground/): choose an intent manually or
  connect a browser agent through experimental WebMCP. Try a component, an
  analytical workspace, and a page with a registered header and sidebar.
- [MCP and BYOK locally](https://hermawan22.github.io/varendo/agents/mcp/): clone the standalone
  [`examples/local-agent`](examples/local-agent/) app. It exposes HTTP and stdio
  tools; an optional host model uses the same bounded loop. Startup makes no
  model calls, and credentials stay in the Node process.

Agent transports and model ports are independent of the rendering runtime.
Your app can use Varendo without an agent or supply a compatible agent/model
adapter without changing its data and permission rules.

## Examples

- [`examples/quickstart`](examples/quickstart/src/app.ts) is the complete
  resource-to-Region integration used by the documentation.
- [`examples/vnext/page-goal`](examples/vnext/page-goal/main.ts) grows one
  mounted Region from a component to a workspace and a registered page. Follow
  the [step-by-step tutorial](https://hermawan22.github.io/varendo/guides/workspace/).
- [Framework examples](docs/examples/platform.md) cover Vanilla, React, and
  Vue hosts.
- [The vertical slice](docs/examples/vertical-slice.md) follows a
  Task through evaluation, Result storage, and presentation.
- [The reference host](docs/examples/reference-host.md) implements
  the synthetic HTTP data contract behind an application-owned server.

## Development

Follow [CONTRIBUTING.md](CONTRIBUTING.md#local-setup) for the complete setup.
Use Node.js `24.20.0`, pnpm `11.24.0`, Python 3, and Go `1.27.2`. The full
check also needs the Playwright browsers installed:

```sh
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm check
```

On macOS, plain `pnpm exec playwright install chromium firefox webkit` is enough;
`--with-deps` also installs the required system libraries on Linux.

See [AGENTS.md](AGENTS.md) for repository boundaries and the verification
matrix. Technical guides are maintained under [`docs/`](docs/README.md).
Current published versions and open work are in [docs/STATUS.md](docs/STATUS.md).

## Security and license

Report sensitive vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/hermawan22/varendo/security/advisories/new).
For reproducible non-sensitive defects, see [SUPPORT.md](SUPPORT.md). Do not
include credentials, customer records, or proprietary data in examples or
issues.

Varendo is licensed under [Apache License 2.0](LICENSE). See [NOTICE](NOTICE)
and [TRADEMARKS.md](TRADEMARKS.md) for attribution and project-name guidance.

## Attribution and migration

Varendo preserves the Apache-2.0 Aeliqo adaptive UI framework from [Arconath/aeliqo](https://github.com/Arconath/aeliqo), source `3b5328dc717de0bb6aad57e8f17a4b9aa5f89f79`. Original copyright notices, ADRs and release records remain attributed to their contributors. The original repository, published packages and production services are unchanged. See the [migration guide](docs/site/pages/migration-varendo.md) and [current status](docs/STATUS.md) for compatibility and release boundaries.
