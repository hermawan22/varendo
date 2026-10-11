# `@varendo/react`

`@varendo/react` provides React 19 bindings over the shared web implementation.
It does not add another renderer, data layer, or authorization boundary.

The package requires React 19, `react-dom` 19, and the matching
`@varendo/runtime` package. The runtime peer provides the public app and region
state types used by the React app API; `@varendo/web` is installed as a package
dependency.

## Main entry point

```tsx
import { AeliqoProvider, AeliqoRegion, useAeliqoRender } from '@varendo/react';
import type { AeliqoApp } from '@varendo/web/app';

export function PeopleRegion({ app }: { app: AeliqoApp }) {
  return (
    <AeliqoProvider app={app}>
      <AeliqoRegion regionId="people-main" resourceId="people" />
    </AeliqoProvider>
  );
}
```

Create the `AeliqoApp` at the application boundary and pass that instance into
the provider. The provider exposes the app to its descendants; the host still
owns the app's data and authority adapters. Call
`registerAeliqoReactElements()` from the client entry point when the page uses
custom elements directly. The app API from `@varendo/react/app` mounts and loads
its required shared elements through `createAeliqoApp`; it needs no separate
registration call. Standard app views load component families as needed, while
custom view callbacks load the full shared catalog for compatibility.

For an advanced, host-created runtime, pass `runtime` instead of `app`. The
provider accepts exactly one of those values and never disposes either one.

## Native React views and headless surfaces

For a small complete array already supplied by the application, the 0.5.0
line has a providerless path with no factory or explicit runtime. The historical
`0.5.0-rc.1` came from an earlier source revision and
does not include this path:

```tsx
import { AdaptiveSurface, useDataSurface } from '@varendo/react/surface';

type Person = { id: string; name: string; team: string };

export function People({ rows }: { rows: readonly Person[] }) {
  const surface = useDataSurface({ data: rows, getRowId: row => row.id });
  return <AdaptiveSurface surface={surface} />;
}
```

The hook creates its local runtime and default browse request after React
commits. Server rendering exposes meaningful read-only rows before hydration;
the client then reads through the same runtime source/evaluator path. Rows
must have a bounded consistent scalar shape and one real unique identity field.
An initially empty array needs an explicit Zod schema and `identity` field;
without them, the component shows empty-data guidance. This local path never
grants remote access. Replace the data prop with a new array to refresh while
retaining the controller address; mutate-in-place callers must change the
`version` option to request a fresh snapshot. Unsupported or invalid updates retain the last
committed rows and show a diagnostic.

For an advanced host-controlled surface, `@varendo/react/surface` adapts a real,
application-owned `SurfaceController` into the existing React tree. It does not
create a React root, add a second data engine, or accept view implementations
from a wire payload. The host creates the surface at its runtime boundary and
registers trusted local React components explicitly.

```tsx
import { AeliqoScope, ViewSurface, defineReactViews, useSurfaceState } from '@varendo/react/surface';
import type { SurfaceController } from '@varendo/runtime/surfaces';

const peopleViews = defineReactViews([
  {
    id: 'people.native-table',
    revision: '1',
    render: ({ snapshot }) => <p>{snapshot.phase}</p>,
  },
]);

export function PeopleNativeView({
  scope,
  surface,
}: {
  scope: import('@varendo/runtime/scopes').ScopeController;
  surface: SurfaceController<unknown, { readonly rows: readonly unknown[] }>;
}) {
  const rowCount = useSurfaceState(surface, snapshot => snapshot.state.rows.length);
  return (
    <AeliqoScope scope={scope}>
      <p>{rowCount} rows</p>
      <ViewSurface surface={surface} views={peopleViews} view={{ id: 'people.native-table', revision: '1' }} />
    </AeliqoScope>
  );
}
```

`AeliqoScope` attaches and detaches the supplied scope for committed React
lifecycle work, but never disposes it. It renders children only for an active,
authorized activation. Initial resolution, denied access, forced invalidation,
and disposal show a safe status without rendering the scoped children. During a
voluntary Save / Discard / Stay guard, the current scope and its React subtree
remain mounted; the requested selector is only pending. An accepted switch
remounts the scoped subtree under the new activation epoch, including A→B→A.
The host must call `scope.invalidate(...)` on logout or revocation; changing a
route prop alone does not fence access. `useSurfaceState` subscribes to one
controller with a selector, so unrelated controller updates do not rely on a
global React context broadcast. Advanced `AdaptiveSurface` requires trusted
presentation evidence to make an automatic choice from registered native
views. A host selector is treated as a pin through shared eligibility checks;
plain registration does not qualify a view. An unknown explicit `ViewSurface`
ref renders an accessible diagnostic instead of silently switching views.

For a route-split native view, register a trusted loader in place of `render`:

```tsx
const peopleViews = defineReactViews([
  {
    id: 'people.native-detail',
    revision: '1',
    load: () => import('./PeopleDetail.js').then(module => module.default),
  },
]);
```

The loader returns a React component and is called after commit, not while
defining the registry or rendering on the server. `ViewSurface` and the
resolver-backed native `AdaptiveSurface` keep the previous authorized view
mounted while a new view loads. A failure leaves that view usable and shows a
retry control; retry calls the registered loader again. If a dynamic import
failure is cached by the host's module loader, supply a retryable loader or a
fresh module route. Initial loading shows a status or the supplied fallback.
Denial, disposal, a changed activation target, or loss of eligibility removes
the old view immediately. The loader is application code; neither a model nor
a wire payload may choose its import path. Keep a view definition immutable for
one ID and revision; increment the revision when its implementation changes.

For a feature bound to an application scope, mount `AeliqoProvider` with the
host runtime, then `AeliqoScope` with its host scope. A descendant can use
`useSurface(feature, { id, bindings })`. The hook reads those nearest owners,
creates the controller only after commit, makes the first request then, and
returns `undefined` until the controller exists. A data feature starts with browse; a
capability feature starts from its typed `bindings.initialIntent`. Supply a
stable surface ID within an activation and bindings for that activation:

```tsx
import { AeliqoProvider } from '@varendo/react/app';
import { AeliqoScope, useSurface } from '@varendo/react/surface';
import type { DataFeatureDefinition } from '@varendo/core/features';
import type { AeliqoRuntime } from '@varendo/runtime/app';
import type { ScopeController } from '@varendo/runtime/scopes';
import type { DataSurfaceBindings } from '@varendo/runtime/surfaces';

type OrdersState = { readonly rows: readonly { readonly id: string }[] };

function Orders({ feature, bindings }: {
  feature: DataFeatureDefinition;
  bindings: DataSurfaceBindings<OrdersState>;
}) {
  const surface = useSurface(feature, { id: 'orders-main', bindings });
  return <p>{surface?.getSnapshot().phase ?? 'Preparing orders'}</p>;
}

export function OrdersWorkspace({ runtime, scope, feature, bindings }: {
  runtime: AeliqoRuntime;
  scope: ScopeController;
  feature: DataFeatureDefinition;
  bindings: DataSurfaceBindings<OrdersState>;
}) {
  return <AeliqoProvider runtime={runtime}>
    <AeliqoScope scope={scope}><Orders feature={feature} bindings={bindings} /></AeliqoScope>
  </AeliqoProvider>;
}
```

This example only shows controller creation; use `useSurfaceState` in a child
component to subscribe to changing controller state. Keep feature definitions
immutable and create new scope-specific bindings for a new activation. A
callback holding an old controller remains bound to its old address and cannot
act in a later activation. Changing the binding reference within an activation
does not replace the controller; use the runtime's source update contract for
data changes. The existing factory overloads of `useSurface` and
`useDataSurface` remain available for application-authored factories and
dispose only the controllers they create. A providerless local hook nested
inside an application-owned scope fails visibly instead of creating a parallel
authority context.

## Component wrappers

React wrappers are available from family subpaths such as
`@varendo/react/foundation`, `@varendo/react/inputs`,
`@varendo/react/navigation`, `@varendo/react/feedback`,
`@varendo/react/data`, `@varendo/react/plot`,
`@varendo/react/visualization`, and `@varendo/react/compound`. SSR helpers are
available from `@varendo/react/ssr`.

## Lifecycle

Keep one app instance per application security context. Mount Regions under the
provider and let their React lifecycle release their subscriptions on unmount.
Dispose the app from the owner that created it. The root exports provider,
Region, and lifecycle hooks; component wrappers stay on family subpaths.
