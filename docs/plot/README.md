# Plot implementation work

The bounded shared geometry slice includes chart-family and final conformance work remain outstanding. The current direct `AeliqoPlotElement` accepts a typed unit plot, an authorized Result descriptor, and bounded rows. Its shared geometry renders through SVG or Canvas. It does not evaluate queries or instantiate a model. Layer, facet and concatenation shapes are parsed and bound. `compilePlotComposition` preserves their containment tree, creates bounded facet display partitions, and shares compatible scale domains without changing result references. The same component also accepts `spec`, `results` and `datasets` for actual layer, facet and inline/block concatenation rendering in SVG and Canvas. Each partition keeps its original source reference and loaded count; its table states how many rows belong to the display partition. Shared scales require matching scalar representations and semantic units.

Exact decimals and instants retain their original cell values. Geometry normalizes exact offsets before converting them to screen coordinates. Axis labels may be shortened visibly; full accessible labels and the paged data table retain exact values. Null and omitted nullable observations create gaps. Line/area input must be ordered by x; the implementation does not connect across a missing observation to make a smooth line.

A missing field, stale result reference, duplicate identity or wrong loaded count rejects the input. An unsupported visual combination, unsafe scale domain or exceeded mark budget retains a data-only alternative with an explanation. The default renderer is SVG; Canvas is explicitly selected and uses the same mark coordinates. Backing pixels, cells, rows and mark counts have independent bounds.

The host owns selection. Listen for `aeliqo-plot-select` and update `selectedIdentity` after accepting the result reference and identity. Ordinary keyboard selection has no model call. `PlotProjection` is a host display projection, not a query or an authorization grant; it cannot introduce unavailable identities.

Current checks include canonical JSON Schema parity, exact offset and gap tests, and actual Chromium SVG/Canvas coordinate and data-selection checks. This is not full catalog, screen-reader, performance or release acceptance.

The implementation uses the modular [D3 scales](https://d3js.org/d3-scale) and [shape generators](https://d3js.org/d3-shape/line), without D3 DOM mutation.
