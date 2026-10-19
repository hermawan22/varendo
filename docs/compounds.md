# Semantic compounds

Varendo compounds are controlled compositions of the existing web primitives. They provide a convenient standalone surface while preserving the same typed result, scope, identity and interaction contracts as manual composition. A compound emits proposals; the application remains authoritative for data, selection, drafts, navigation and actions.

The eight compound elements are:

- `<varendo-explorer>` combines a typed filter, a stable-identity record collection and selected detail.
- `<varendo-comparison>` keeps a host-owned compare set and renders compatible metrics simultaneously.
- `<varendo-breakdown>` renders bounded groups through the shared table primitive and contributing records. Metrics are host evaluated (`value`/`displayValue`); the web component never divides, rounds or invents a ratio from source statistics.
- `<varendo-investigation>` combines trend, baseline, event timeline and detail. Its copy states that association is not a causal claim.
- `<varendo-search-results>` shows query state, a scoped result count and a collection. A result revision that does not match the query revision is presented as stale.
- `<varendo-record-editor>` wraps the existing form boundary, checks native/custom field validity at save time and emits explicit save/cancel proposals carrying entity, revision and captured draft values.
- `<varendo-form-flow>` exposes task steps with named step slots, controlled draft/validation state and reversible navigation before commit. Forward jumps and final commit validate every traversed step.
- `<varendo-quality-panel>` displays source, freshness, completeness and provenance, and labels unsupported claims instead of asserting them.

Each compound has a recipe helper ending in `PresentationRecipe`. Supply `parts` as configured shared primitive nodes, exact task `coverage`, any registered interaction `links`, preconditions, and `validation: {context, registry}`. The helper returns an `Outcome` after the real canonical presentation validator accepts the expanded `layout.stack` tree. It does not invent task needs, materializations, binding revisions, permissions, or interaction mappings. `VARENDO_COMPOUND_REFS` identifies authoring macros; those names are not renderer representations. The returned plan uses existing registered primitives, and the host follows the ordinary evaluate/present/commit path. A rejected macro preserves the current presentation.

Every result-bearing view should provide an exact `ResultRef`, semantic entity and scope. Row indexes are never used as identity. Comparison and breakdown windows are bounded before they reach a renderer. For SSR, import the compound classes and render a deterministic host-resolved state; register custom elements explicitly in the browser.
