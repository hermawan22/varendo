---
id: "migration"
path: "/ship/migration-0.3/"
section: "Releases"
title: "Migrate from 0.3 to 0.4"
description: "Update package roots, component imports, removed aliases, and agent requests for Aeliqo 0.4."
---

<p class="lead">Move your 0.3 integration to 0.4 one boundary at a time. Update package imports first, then replace removed elements, then update agent requests.</p>

## What changes in 0.4

Aeliqo 0.4 is a breaking release with five public packages. Common APIs move to
package roots; specialized APIs remain available through explicit subpaths.
The public site is one application and has one fixed visual style. The component
library continues to accept host theme tokens.

The 0.4 release removes the `@aeliqo/devtools` workspace package and the Studio
application. It also removes the compatibility React wrappers `AeliqoInput` and
`AeliqoChart`, and the legacy `<aeliqo-input>` custom element. Existing npm
artifacts remain available, but new applications should use the five packages
documented in the [package map](/reference/packages/).

## Update package entry points

Keep all Aeliqo packages on exactly `0.4.2`. The root imports below are the
recommended path for common work:

```ts
import { compileIntent, defineResource, parseCatalog } from '@aeliqo/core';
import { createAeliqoRuntime } from '@aeliqo/runtime';
import { createAeliqoApp } from '@aeliqo/web/app';
import { registerAeliqoElements } from '@aeliqo/web';
import { AeliqoProvider, AeliqoRegion, useAeliqoRender } from '@aeliqo/react';
import { createAppToolEndpoint } from '@aeliqo/agent';
```

Move specialized imports to their owning subpath. In 0.3, these helpers were
available from the core root:

```ts
// Aeliqo 0.3
import { createQueryFunctionRegistry, validatePresentationPlan } from '@aeliqo/core';
```

In 0.4, import each capability from its owner:

```ts
// Aeliqo 0.4
import { createQueryFunctionRegistry } from '@aeliqo/core/expressions';
import { validatePresentationPlan } from '@aeliqo/core/presentation';
import { createLocalDataService } from '@aeliqo/runtime/data';
import { createActionRegistry } from '@aeliqo/runtime/actions';
import { AeliqoInputChangeEvent } from '@aeliqo/web/inputs';
import { AeliqoTextFieldElement } from '@aeliqo/web/text-field';
import { AeliqoTextField } from '@aeliqo/react/inputs';
```

The `0.3` comment describes the old import locations; use only the `0.4`
imports when updating code. The [`@aeliqo/core` guide](/reference/packages/) and
individual package guides list every supported root and subpath.

The web app facade moved to `@aeliqo/web/app`. The `@aeliqo/web` root remains
available for element registration and recipe APIs without installing the
optional runtime integration.

## Replace the legacy input element

Replace `<aeliqo-input>` with the component matching the input's semantics.
For a text value, use `<aeliqo-text-field>`. Replace `hint` with `description`
and use the typed change event:

```html
<aeliqo-text-field
  label="Display name"
  name="displayName"
  description="Shown to other members"
  value="Ada Lovelace"
></aeliqo-text-field>
```

```ts
const field = document.querySelector('aeliqo-text-field');
field?.addEventListener('aeliqo-input-change', (event) => {
  if (!(event instanceof AeliqoInputChangeEvent)) return;
  const proposal = event.detail;
  // Validate and store the proposal through the application's form boundary.
});
```

For number, date, search, choice, and multi-line values, use the corresponding
component from the [input family](/components/). The old `AeliqoInput` React
wrapper and `AeliqoFieldChangeDetail` alias are removed. React applications can
use the typed family wrapper or the custom element directly.

## Update agent requests

The modern agent protocol requires a `taskId` on task-scoped requests and uses
the current protocol revision. Remove legacy configuration and requests that
omit the task identity. Obtain task and Region identifiers from the paired app
endpoint; do not derive them from prompt text. The host still owns confirmation,
authorization, credentials, and the final business effect.

## Verify one integration at a time

Start with a read-only Region. Check its permitted fields, current authority,
empty and error states, responsive view, and keyboard path. Then migrate
registered actions and agent transport. The [quickstart](/start/) contains a
complete 0.4 application, and the [playground](/playground/) exercises the same
public runtime with synthetic data.
