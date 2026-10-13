# Data components

The data family is one shared Lit implementation with direct imports under
`@varendo/web/data`. It renders host supplied values and scopes; it does not
execute a query, infer a metric, or create a region/runtime. Each component
accepts the same explicit loading, partial, stale, error and unavailable
states where those states apply.

`Metric` renders one validated value with its unit and visible scope. Numeric
values keep an unbroken left-to-right reading order with local keyboard scrolling
when needed. A custom `displayValue` is treated as text with automatic direction
so localized prose is not forced into numeric formatting.
`Delta` requires an explicitly compatible baseline. Its `absolute`, `relative`
and `percentage-point` modes remain distinct. A missing baseline is unavailable;
a zero baseline is valid for absolute and percentage-point changes, but relative
change is unavailable because its denominator would be zero. Terminating decimal ratios
remain exact; repeating ratios are unavailable instead of being silently
rounded. `KeyValue` uses a native definition list. `Detail` keeps the selected
record's stable identity and renders declared fields even when a field is
missing.

Semantic percentage-point deltas require both fields to declare
`unit: {dimension: 'ratio', symbol: '1'}`: stored values are fractions, so
`0.12` to `0.15` is a change of `3 pp`. A `%` display label alone cannot establish
that storage convention. Currency, bare numbers and ambiguous percent units
are rejected for percentage-point mode. Absolute and relative currency changes
remain available; a relative change displays `%` without a currency suffix.
Typed `current.identityValues` and `baseline.identityValues` can select
different observations of the same field. Contradictory shared/side selectors
or aliases are rejected.

`RecordList` and `CardCollection` derive selection keys from declared identity
fields. Render position is never an identity. Selection events are proposals;
the host owns `selectedKeys`, permissions and the result reference. Cards have
an explicit bounded **Load more** event and disclose the current scope.

`Table` uses a native `table` by default. `mode="grid"` is an explicit
interactive mode with roving cell keyboard navigation and explicit row and
column positions. Sorting and paging emit typed requests for the host.
Virtualization is host controlled: `virtualStart` addresses the loaded `rows`
window, and a keyboard move beyond the mounted window emits
`varendo-table-window` so the host can provide the requested window. The host
also updates `virtualStart` in response to its own scroll or pointer window
logic; the component does not pretend that a bounded slice is the whole
source. Non-finite values are sanitized, and at most 100 body rows including
overscan are mounted. Focus follows a stable identity when rows reorder and
uses a deterministic visible row when the focused identity is removed. Known
loaded/total counts remain visible in the scope text and ARIA row count. Exact
decimal cells remain display strings.

`FilterBuilder` builds the canonical typed predicate vocabulary, shows the
inherited scope, and emits only after the user activates **Apply**. Field
options may include the complete core `semanticType`; when only the convenience
`type` is supplied, entered values are still validated before emission. Unknown
fields, invalid dates and unsafe integers are rejected. Typing and IME
composition update a local draft and never execute a query. Supported compound
clauses remain visible individually; inherited predicates are visibly read-only.
Mixed nested predicates or predicates for another entity remain read-only with
Apply disabled rather than being reduced to a different meaning. Membership
values use a lossless JSON array when necessary to preserve commas, empty
strings and typed null values. `SelectionSummary`
distinguishes observed identity selection from a server predicate selection so
it cannot imply that loaded rows represent an unobserved global set.

The region data adapter is the boundary between these direct views and a
validated presentation. The public
`createVarendoPresentationRegistry({data: bindings, resolveEntity})` installs all
eight additional data manifests alongside the existing table manifest, using
the same core presentation validator. Each binding contains an application
authorized `Result` descriptor together with its exact loaded rows. It checks
the ResultRef, loaded/population counts, declared scalar types and units, field
labels, row grain and stable identity tuples before a node can render. It does
not aggregate rows, discover a source, or turn a loaded page into a population.
Scalar views (`Metric`, `Delta`, `KeyValue`, and `Detail`) require one row or an
explicit identity tuple; `Delta` requires two declared numeric observations
with compatible units and delegates arithmetic to `calculateVarendoDelta`.
Collection views retain the authorized rows and identity fields. Filter,
selection, page, sort, load-more and keyboard-window requests are sent to a
host callback; only registered selection and filter ports produce canonical
core interaction payloads. Page and window requests remain typed host requests
because the core wire contract has no implicit viewport or sort operation.

The components prefer native lists, definition lists, tables, buttons, form
controls and visible focus. The shared styles include wrapping, RTL-safe
logical sizing, forced-colors focus and reduced-motion-compatible controls;
application tokens supply the final visual values. Browser and screen-reader
review remains part of the product release gate.

Register the authorized materialization before validating a presentation:

```ts
import {createVarendoPresentationRegistry} from '@varendo/web';
import type {VarendoDataBinding} from '@varendo/web';

export function registryForPeople(binding: VarendoDataBinding) {
  return createVarendoPresentationRegistry({
    data: [binding],
    resolveEntity: result => result.ref.outputId === 'people' ? 'person' : undefined,
  });
}
```

The registry takes an immutable snapshot. Recreate it for a new authorized
result revision. Pass the registry to the core validator, then supply the
validated presentation and current `{ref, rows}` materialization to
`<varendo-region>`. Rows never enter the presentation wire graph. The renderer
checks the current descriptor and exact ResultRef again; clearing the region
removes the displayed data. Host requests use the region's `onDataRequest`
callback. The lower-level `createVarendoDataRegistry` helper remains available
for direct adapter use; it does not replace the canonical presentation graph.

When registration includes custom host scope annotations, also pass that
`scope` with the current `{ref, rows, scope}` materialization. Count annotations
are checked against the Result; they cannot hide the loaded row count.
Likewise, if registration supplies custom `columns`, include those columns in
the current materialization. Omitting them selects the default Result columns;
a resulting change to validated field coverage is rejected.

The host remains responsible for authorization of the current row payload and
must advance the ResultRef when its content changes. A matching reference is
not an authorization grant. The standalone renderer validates the supplied
materialization and refuses changes to the validated field/operation coverage;
it cannot authenticate a host's assertion about business data. The optional
`createVarendoDataPresentationRegistry` bridge also retains its original row
snapshot and refuses different row content under the same reference, while
allowing row order to change.

Focused local checks for this slice are:

```sh
pnpm exec vitest run --config tests/data-components/vitest.config.mjs
pnpm exec playwright test --config tests/data-components/playwright.config.mjs
pnpm test:data-semantic
pnpm test:data-semantic:browser
pnpm test:data-components:consumers
```

The installed consumer also measures JavaScript bundles for all nine direct
entries, including and excluding Lit. It checks the existing Metric and Table
budgets and rejects planner, runtime, visualization or agent modules in the
rendered component bundles. These measurements do not establish browser parse,
execution or whole-page performance; those remain separate release checks.
