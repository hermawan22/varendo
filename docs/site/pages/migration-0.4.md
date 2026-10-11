---
id: 'migration-0-4'
path: '/ship/migration-0.4/'
section: 'Releases'
title: 'Migrate from 0.4.2 to 0.5'
description: 'Move from Aeliqo 0.4.2 to the breaking 0.5.0 release line.'
---

<p class="lead">Move from 0.4.2 to 0.5 one boundary at a time. The existing app and Region path keeps working while you adopt scopes and surfaces.</p>

## Release line and compatibility

<aeliqo-release-status></aeliqo-release-status>

Aeliqo `0.5.0` is a breaking successor with public surface and scoped runtime
contracts. The historical `0.5.0-rc.1` came from an earlier source revision
and does not contain every change on this page. The `0.4.2` packages remain
available for older integrations.

The wire contract remains version `1`. The existing application/resource/Region
path is the compatibility adapter for applications that are not ready to move.
Do not install a mixture of `0.4.2` and `0.5.0` packages in one application.
Keep all Aeliqo packages on one exact release line.

Migrate one integration boundary at a time. Keep the existing app and Region
working. Add an explicitly owned scope and one surface, then move that screen's
rendering and optional agent pairing. Check the old and new paths against the
same host authority and data source before removing the old Region. The
[local data starter](/start/) is complete and copyable; the advanced snippets
below show the ownership points in an existing application.

## Move feature definitions to the new entry

The old resource path remains valid. New code can describe immutable data or
non-data features through the dedicated feature entry:

```ts
// Existing 0.4.2 path
import { defineResource } from '@aeliqo/core';

// 0.5.0 path
import { defineDataFeature, defineFeature } from '@aeliqo/core/features';
```

Data features lower through the existing resource, query, and authority
contracts. Non-data features describe typed capabilities and intents without
inventing rows or a second evaluator. Keep live rows, principals, credentials,
and host permissions outside the immutable definition.

## Add explicit surface ownership

Create each live surface through `@aeliqo/runtime/surfaces` and keep its scope,
identity, and data binding explicit. Scope transition contracts are available
from `@aeliqo/runtime/scopes` as types for the host-owned lifecycle adapter.
The following is an integration outline. The host supplies `resources`,
`authority`, `scope`, `peopleFeature`, `snapshot`, `coverage`, and `normalize`.
Copy the concrete binding from the [runtime package guide](/reference/packages/)
or the maintained fixtures before using it:

```ts
import { createAeliqoRuntime } from '@aeliqo/runtime';
import { createLocalDataBinding } from '@aeliqo/runtime/surfaces';

const runtime = createAeliqoRuntime({ resources, authority });
const binding = createLocalDataBinding({
  feature: peopleFeature,
  snapshot,
  initialState: { rows: [], selection: [] },
  coverage,
  normalize,
});
const surface = runtime.createSurface({
  scope,
  id: 'people-main',
  feature: peopleFeature,
  bindings: binding,
});
```

Surface construction is inert. Requests, scope attachment, disposal, and host
proposal acceptance are explicit. A workspace or client ID selects a scope; it
does not grant permission. Preserve host-owned authority and business effects.

React applications may adopt the native/headless binding from
`@aeliqo/react/surface`. It consumes a real application-owned controller and
does not create a second data or authorization engine. Existing React provider
and Region imports remain the compatibility path.

## Keep agent integration optional

The no-agent entries (`@aeliqo/core`, `@aeliqo/runtime`, `@aeliqo/web`, and
`@aeliqo/react`) do not import model transports, provider SDKs, or server-only
helpers. Add the scoped browser bridge only when the host explicitly enables
it:

```ts
import { connectAgent } from '@aeliqo/agent/browser';

const connection = connectAgent({ scope, client, targets: ['people-main'] });
```

The target list is an allowlist, not a permission grant. Rebind and reset the
connection when scope or target identity changes. Keep credentials in the host
model port; never put them in prompts or tool arguments.

## Migration checks

Build a clean consumer from packed artifacts and run the packaging
qualification fixture before requesting a release candidate. From the
repository root, run `pnpm test:release-tooling`. It checks the old 0.4 root
imports, the new feature/surface/browser entries, export targets, and legal
files. It also checks optional peers and the browser no-agent module graph. See
the [qualified support matrix](/ship/support-matrix/) for the tested framework,
browser, provider, and workload profiles. Unsupported or untested entries are
labelled there rather than inferred from a passing protocol test.
