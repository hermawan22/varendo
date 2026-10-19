# `@varendo/web`

`@varendo/web` contains the shared Lit implementation, custom elements, browser
registration, adaptive recipes, and the browser application facade.

## Component entry point

```ts
import { registerVarendoElements } from '@varendo/web';
import { createVarendoPresentationRegistry } from '@varendo/web/region';

registerVarendoElements();
const registry = createVarendoPresentationRegistry();
```

The package root and component subpaths can be used without the runtime
package. Import the application facade separately when an application needs
the default runtime and adaptive recipes:

```ts
import { createVarendoApp } from '@varendo/web/app';

const app = createVarendoApp({ resources, authority });
```

`createVarendoApp` composes the runtime with registered renderers and standard
recipes. It does not create authority or infer application permissions. The
`@varendo/web/app` subpath requires the matching `@varendo/runtime` package.
Registration is explicit so server module evaluation does not touch
`customElements`.

Mounting an app registers the region, table, and chart. Rendering and container
adaptation load other component families needed by the validated plan before
publishing the result. Automatic resize and media updates wait for an in-flight
presentation, then apply the latest environment. A loading or incompatible-version
failure returns `web.app.registration` and retains the previous valid result. Applications that
use custom view callbacks load the full shared catalog when that view is
selected, so callbacks can keep using compound elements and their children.
Calling `registerVarendoElements()` still registers the complete catalog eagerly;
use it for direct custom-element usage.

## Adaptive recipe policy

The application facade derives a presentation policy from each mounted
resource's `presentation.allowedViews`. Standard recipes author deterministic
canonical candidates and configurations; the shared core resolver performs the
single eligibility and ranking decision before any runtime or renderer commit.
The same validation applies to custom recipe candidates. For example, a
resource that allows only `table` stays in `data.table` even when a narrow
container would otherwise make cards more suitable.

Direct recipe consumers can pass the optional policy explicitly:

```ts
import type { RecipeContext, RecipePresentationPolicy } from '@varendo/web';

const presentationPolicy: RecipePresentationPolicy = {
  allowedRepresentations: ['data.table'],
};

const context: RecipeContext = {
  intent,
  task,
  result,
  current,
  environment,
  availableViews,
  presentationPolicy,
};
```

`allowedRepresentations` contains canonical renderer IDs such as `data.table`,
not resource aliases such as `table`. `RecipePresentationPolicy` is also
available from `@varendo/web/recipes`. The property is optional for direct recipe
consumers; `createVarendoApp` always supplies it for data tasks.

When the preferred representation is a trend, the standard recipe binds only
requested result fields. It prefers a field with the semantic `time` role and
requires exactly one requested numeric `measure`. Multiple eligible time or
measure fields return a `web.recipe.needs-input.*` diagnostic so the application
can ask for a choice instead of plotting an arbitrary numeric field.

Analyze requests can also select the registered `bar` representation when a
categorical dimension and one numeric measure are available. Compare requests
with two identities use the bounded split-pane composition when the container is
wide enough; each child detail is pinned to one requested identity from the same
authorized result. Narrow layouts retain the simultaneous table comparison. The
split is not an implicit permission grant: the resource's allowed views, renderer
registry, operation and result bindings must all permit it.

Standard data views use a 24px hysteresis band around the 640px container
breakpoint during automatic resize: a wide view changes below 616px, and a
narrow view changes above 664px. An explicit render evaluates the current size
immediately. Registered workspace/page patterns receive every measured size;
the standard breakpoint band does not constrain their layouts.

Repeating a comparison evaluates a fresh result and transfers each existing
child to its same registered identity. A custom recipe must likewise declare
`stateTransfer` entries when it replaces result references or changes a layout.
For unchanged node IDs, roles, and representations, use the registered
`varendo.state.identity` mapping at revision `1`. Other transitions require an
appropriate registered mapping; omitting one rejects the update and keeps the
previous valid presentation.

An explicit view pin is a hard gate and never falls through to another recipe
candidate. A preferred view remains a ranking input and may fall back only to a
fully eligible candidate. Direct `RecipeDefinition.build` calls remain a
source-compatible candidate-authoring API; they are not a commit decision.

## Registered workspaces and pages

Use `createVarendoApp({ resources, authority, patterns, stateMappings, views })`
when a registered intent needs more than one result or a whole page layout.
`patterns` uses `PresentationPatternManifest` and `stateMappings` uses
`PresentationStateMappingManifest`, both exported by `@varendo/core/presentation`.
These trusted registrations are validated and copied when the app is created.
Duplicate IDs and mappings to unknown views are rejected.

A recipe receives `context.results`, the complete array of authorized output
descriptors. `context.result` remains the primary descriptor for existing recipes.
The `results` property is optional in the type so direct recipe callers remain
compatible; the app always supplies a frozen array.

For a custom intent without a matching recipe, the resolver requires a matching
registered pattern. Every child must satisfy the resource's `allowedViews`,
result bindings, and required operations. Register data views explicitly, such
as `data.metric` for a summary. A structural custom view can provide host-owned
header or sidebar content; it must declare no data result or operations and the
`structure` role. That registration does not authorize reading additional data.

Mount and render these layouts using the same `app.mount` and `app.render` calls
as a single component. Container changes run the existing presentation resolver
without another data request or model call. A missing required output or invalid
pattern leaves the previous presentation visible and returns a diagnostic.

The [workspace guide](https://hermawan22.github.io/varendo/guides/workspace/) explains host
ownership and the registered attendance example.

## Component entry points

Import an individual element or family from its subpath. For example:

```ts
import { VarendoButtonElement } from '@varendo/web/button';
import { VarendoTextFieldElement } from '@varendo/web/text-field';
import { VarendoBarElement, VarendoTrendElement } from '@varendo/web/visualization/cartesian';
```

Family exports include `foundation`, `inputs`, `navigation`, `feedback`, `data`,
`plot`, `visualization`, and `compound`. Region registration and low-level
rendering live under `@varendo/web/region`; server rendering lives under
`@varendo/web/server`. Utility subpaths cover `@varendo/web/register`
(`registerVarendoElements`, `VARENDO_WEB_VERSION`), `@varendo/web/events` (typed
selection events), `@varendo/web/styles` (theme styles and locale context),
`@varendo/web/table` and `@varendo/web/chart` (element classes and stable row
keys), `@varendo/web/region/adaptation` (region adaptation internals), and the
`@varendo/web/foundation/manifest` and `@varendo/web/inputs/manifest` family
manifests.

`<varendo-chart>` is the low-level series chart. It renders a responsive SVG
with labeled axes and grid lines, plus a collapsible table with the exact
values. Set `points` for one series or `series` for multiple series.
The chart uses English labels by default. Set `lang="id"` or an Indonesian locale
such as `lang="id-ID"` for Indonesian chart controls and accessible labels;
region trend charts use the validated presentation locale automatically.
Application titles, series labels, and scope names remain host-authored.
The scope annotation remains visible in either language. The catalog
visualizations such as `<varendo-trend>` provide semantic views for
registered resources and meanings.

## Styling and browser behavior

Plot and Cartesian marks use `--varendo-visualization-series1` through `series6`.
Quantitative marks and their keys share `--varendo-visualization-quantitative-start`
and `--varendo-visualization-quantitative-end`. Canvas repaints after component or
inherited theme changes and system color changes, using the same colors as SVG.

Components use the library's public design tokens and exposed shadow parts.
Applications can set those tokens on a host to match their own design system.
The public Varendo site and the component package are generated from the same
token source. The site follows the system color scheme by default and offers
persistent light and dark choices. Applications can keep that behavior or set
the public tokens on a host for their own theme.

The shared elements emit typed, cancelable interaction events where an action is
user initiated. Treat event detail as input and recheck application authority
before performing a business effect.

### Draft exits and presentation updates

`onDraftExit` is the host's Save/Discard/Stay boundary for a dirty form. It
receives immutable drafts, the next intent, a revision, and an `AbortSignal`.
Without a decision, replacement returns `needs-input`. Revocation and stale
work cannot override this boundary. See the [application API](https://hermawan22.github.io/varendo/reference/app-api/)
for the decision shape.

A successful current standard form action clears its unchanged submitted drafts
and resets those fields to the registered form defaults. A new create form is
empty unless the trusted `formState` supplied defaults. New edits made while
the action was running remain dirty; failed or ambiguous actions retain their
drafts. The host requests the edit form again to load freshly saved values and
a current entity revision from `formState`.

Responsive adaptation waits while an action preview or execution is pending,
then resumes for the current region after cancellation or completion. A host
request or revoked authority continues to fence the older action.

`onPresentation` observes a `RendererReadyReceipt` after the DOM update,
including adaptation caused by container or media changes. Use it for visible
view labels and diagnostics. It does not grant permissions or trigger models.

The app prepares the next presentation before publishing its task. Unsupported
targets and synchronous root-renderer failures preserve the prior authorized
state and UI; revoked content is cleared. `renderer-ready` covers the Region
root update, not asynchronous descendant work or browser paint.

### Host renderer contract

A custom view and any nested Lit directive callbacks must be synchronous,
deterministic, and free of business effects. Capture immutable inputs in the
returned template; do not make a previous template depend on changing external
state. This lets a rejected update replay the last authorized template while
retaining its keyed children. Perform effects through registered actions.

A directive that mutates the DOM independently or throws while replaying a
previous template is outside this contract. The candidate remains unpublished,
but the renderer clears the affected region if restoration also fails. Fix the
host callback and remount the region before retrying. Varendo cannot roll back
arbitrary effects performed by application code.
