# Visualization contract

`VisualizationSpec@1` adds family semantics around the existing `PlotSpec@1`.
It is an additive, opt-in contract; existing plot specifications and
`data.trend@1` remain compatible. A contract entry is not, by itself, evidence
that its renderer is included in a particular package release.

Trend, Bar, Area, Scatter, Histogram and Heatmap reuse the plot grammar. Matrix
uses explicit columns, preserving arbitrary scalar values and row/column
association. Tree and Treemap use explicit composite node and parent keys.
Relationship uses catalog entity identities and a declared relation. Timeline
and CalendarGrid use typed temporal fields. There are no arbitrary coordinates,
styles, scripts, execution ports or self-declared approval in the wire shape.
Captions, units and scope come from the authorized Result and trusted host
presentation metadata; this wire contract does not invent narrative claims.

`bindVisualizationSpec(spec, {results, catalog, relationships, histograms})` is a pure binding
pass. Result references must match exactly; identities and grain refer to
actual declared fields. It preserves loaded/population counts, coverage,
precision, warnings, periods, filters and evidence without turning them into
access grants. The host supplies authorized descriptors and remains responsible
for business truth. No data is fetched, aggregated or sent to a model.

Area and Treemap require an active reviewed additive meaning from the authorized
Catalog, pinned by the Result field's derivation and compatible scalar/unit
metadata. A meaning with an omitted output grain is context-polymorphic; an
explicit meaning grain must match the materialized field. Relationship endpoint
identity types are compared independently of the edge Result row grain. Nonadditive and currently unsupported semi-additive magnitudes are
rejected. Area stacking must name a series dimension; ordinary PlotSpec remains
available for other approved mark uses. Histogram receives executor-produced
bin boundaries and count/density values; it never bins raw rows in a renderer.
A trusted `VisualizationHistogramBinding` pins the bin fields, boundary and
count/density meaning to the exact ResultRef; a wire label alone cannot turn an
arbitrary integer into a population count. Its rectangular plot names both x
endpoints and an explicit y baseline field.
The histogram Result counts bins, not underlying source observations. Complete
bin delivery must never be presented as complete source-population coverage.
Without explicit source evidence, the accessible summary states that observation
coverage and missing/outside-bin counts are unknown. Heatmap requires both grain
dimensions and a numeric color measure.

Relationship join keys are not necessarily endpoint identities. An authorized
host therefore supplies an exact `VisualizationRelationshipBinding` for the
ResultRef, relation revision and source/target projected fields. The wire spec
must match this declaration. Projected fields correspond in order to each
Catalog entity's identity fields, not its join keys. The renderer must still
validate edge cardinality. Neither matching scalar types nor a relation name
alone proves that arbitrary row columns are its endpoints.

The materialization/geometry pass must check all supplied rows before exposing
marks or interactions: exact loaded count, allowed fields and scalar values,
unique non-null identity tuples and bounded cells. Histogram bins must be
ordered, non-overlapping, start-inclusive/end-exclusive, nonnegative in count or
density, and based on zero; underflow/overflow/missing observations must stay
visible in the Result scope. Hierarchy checks include duplicate nodes, partial
parent keys, missing parents, cycles and bounded depth. Treemap magnitudes are
nonnegative; an explicit leaf-value policy prevents parent/subtree double
counting. Relationship geometry checks one-to-one/many-to-one/one-to-many
cardinality and namespaced endpoint identities. Timeline checks endpoint order
and exposes overlap lanes; calendar rendering uses declared temporal policy
and explicit or locale-derived week boundaries. Unsupported calendar realizations
must disclose a data-only alternative rather than silently switch calendars.

Geometry budgets retain the plot limits: 10,000 loaded rows, 100,000 cells/work
units, 50,000 marks, 4,000,000 pixels and bounded display groups. Safe density
fallbacks retain exact accessible data and scope. No silent row dropping,
rounding, invisible per-row DOM expansion or force simulation is permitted.

Ordinary property-like field IDs such as `constructor` and `toString` remain
valid; absent nullable fields are read as null using own-property checks. The
wire-reserved key `__proto__` cannot be a materialized field ID; the host must
supply a safe alias while retaining the original display label.
