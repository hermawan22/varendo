# Tree, Treemap and Relationship

Import the shared elements from `@varendo/web/visualization/hierarchy`, or the thin
React bindings from `@varendo/react/visualization`. `registerVarendoElements()`
registers all twelve visualization families. Direct components accept a typed
`visualization`, an authorized binding `context`, and bounded `datasets` keyed by
exact ResultRef. They perform no query, model call or source discovery.

Tree and Treemap require one row per stable node and explicit compatible parent
keys. Missing parents, cycles and inconsistent composite keys are rejected.
Treemap requires an authorized additive meaning and uses leaf values only for
area; parent totals do not double-count descendants. Zero weights have zero
area and no invisible interactive marks. Exact decimal weights determine ratios;
unsafe or unreadably small geometry falls back to the exact table.

Relationship requires the host's explicit registered relationship mapping.
Source and target namespaces stay separate, and materialized edges must respect
the declared cardinality. Its selection identifies the edge row, not an endpoint.
All graphics emit cancelable `varendo-visualization-select` events with a canonical
row identity and exact ResultRef. The host retains execution authority.

Each view includes coverage, precision, warnings and an exact-value table.
Dense or over-budget graphics retain paged data (25 rows per page). SVG marks,
scroll regions and table selections support keyboard use. Same-scope updates
retain keyed focus; changed scopes clear selection and revoked contexts clear
content. Full labels remain in the table when graphical labels are abbreviated.

Verification includes actual SVG namespaces and bounds in Chromium, native
keyboard selection, partial coverage, revocation, paging and focus refresh,
360px RTL at 24px text, automated accessibility, and public-registration SSR.
This does not establish manual assistive-technology or cross-browser release
certification; those gates remain separate.
