# Semantic visualization presentations

`@varendo/web` exposes twelve visualization representations through the
semantic region registry. The registry is the host boundary between a core
`VisualizationSpec` and a Lit element; it does not invent a query, aggregate
rows, or infer a source capability.

Each authorized binding contains one primary `Result`, the exact result
descriptors and catalog declarations needed by the visualization, and bounded
materialized datasets keyed by exact `ResultRef`. A presentation config has
one wire value, `{ visualization: spec }`. The registry parses that value,
binds it with core `bindVisualizationSpec`, and materializes every referenced
result before returning fields, ports, and operations. Histogram declarations,
relationship endpoint projections, and approved meanings therefore remain
explicit host inputs.

Selection is available only when the host supplies a trusted entity resolver.
The renderer accepts the existing `varendo-visualization-select` event only
after parsing its bounded wire detail, checking its source, exact result
reference, loaded identity, and declared selection port. It emits the core
`InteractionPayload` through `onSemanticInteraction`; row positions, labels,
and arbitrary event properties never become authority. Retained selection is
read by exact node, port, and `ResultRef` identity.

The twelve registered views are `trend`, `bar`, `area`, `scatter`, `histogram`,
`heatmap`, `matrix`, `timeline`, `calendar-grid`, `tree`, `treemap`, and
`relationship`. They render the existing elements with typed `.visualization`,
`.context`, and `.datasets` properties. A stale descriptor, changed context or
dataset snapshot, malformed event, or config whose derived ports and fields do
not match the registered manifest renders nothing and emits no interaction.

The canonical semantic node binds one exact Result. A multi-output Task uses
separate presentation nodes for its separate grains/results; a single semantic
visualization node rejects a PlotSpec spanning several ResultRefs. Direct
visualization elements can still consume supported multi-result PlotSpecs with
explicit datasets. This restriction prevents primary-result field coverage or
selection ports from claiming authority over a secondary result.

Use `createVarendoPresentationRegistry({visualizations: bindings, resolveEntity})`
and provide each region result's `visualizationContext` for its reviewed catalog,
histogram or relationship metadata. Region rows remain the one materialization
source. Read-only nodes disable selection and ignore retained selection state;
selectable nodes require the exact entity, node, port and ResultRef.
