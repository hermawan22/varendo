# Cartesian visualization family

The web package exposes six owned Lit elements for the `VisualizationSpec@1`
Cartesian families: `aeliqo-trend`, `aeliqo-bar`, `aeliqo-area`,
`aeliqo-scatter`, `aeliqo-histogram` and `aeliqo-heatmap`.

Each element accepts an authorized `visualization` specification, its binding
`context`, and exact loaded `datasets`. The element performs only the pure
binding, bounded row materialization and shared PlotSpec geometry pass. It does
not fetch data, execute a query, aggregate source rows or call a model. The
host remains responsible for supplying the exact Result reference and rows.

Every surface keeps the exact loaded data in a native table below the graphic.
Scope, coverage, periods, filters, precision and histogram observation limits
come from the Result descriptor. A geometry or budget failure retains that
table as the data-only alternative. Selection emits the composed
`aeliqo-visualization-select` event with the stable row identity and exact
`ResultRef`; the host may reflect the accepted selection through
`selected-identity` and `selectedResult`.

The family-specific contract is enforced before geometry is exposed:

- Trend requires a declared temporal grain and preserves gaps in a metric
  series.
- Bar uses a quantitative zero baseline and renders negative values on the
  correct side of it.
- Area requires the authorized additive meaning pinned to its value field;
  `stack: "zero"` requires a series dimension and stacks positive and negative
  values independently.
- Scatter keeps two quantitative axes and exact point rows.
- Histogram consumes executor-produced start/end/value rows, checks ordered
  non-overlapping positive-width bins, nonnegative count/density values and an
  explicit zero baseline, and discloses that bins do not prove source
  observation coverage.
- Heatmap requires two distinct ordinal grain dimensions and a quantitative
  color field. Duplicate dimension pairs remain data-only instead of being
  silently overwritten.

The shared geometry is bounded by the plot budgets: 10,000 loaded rows,
100,000 cells/work units, 50,000 marks, 4,000,000 pixels and bounded
composition groups. SVG is the default graphic; the exact table remains the
accessible fallback for unsupported or over-budget geometry.
