# Matrix, Timeline and CalendarGrid

Direct elements take `visualization`, the current authorized `context`, exact
`datasets`, a trusted `label`, `width`, `height` and `maxMarks`. Import
`defineTemporalElements` from the visualization temporal entry and call it once.
No query evaluator, runtime or model is created. All rows pass the core binder
and shared materializer before display. Revoked or stale bindings remove data.

Matrix preserves declared column order, scalar values, units, missing values and
stable row identities. Its accessible table has 25 rows per page; it never treats
visible row indices as semantic identities. Timeline uses exact temporal ordering
and offset geometry, rejects end-before-start intervals, and allocates separate
lanes for overlapping intervals. Missing endpoints remain in the exact table.
An interval endpoint touching another endpoint occupies a separate lane because
the wire contract does not declare half-open intervals. The 1,000 interval,
100,000 lane comparison and available-height budgets produce a disclosed data
alternative instead of hidden overlaps or dropped rows.

CalendarGrid groups instants using the declared IANA timezone and dates as civil
dates. It renders Gregorian/ISO calendar dates; unsupported calendars or invalid
platform timezones retain the exact table with a disclosure. `weekStartsOn`
selects the first weekday; omission uses the documented ISO Monday boundary.
The calendar shows up to 366 consecutive days, including days with no loaded
rows, without implying those dates have zero observations in the population.
Day counts mean loaded rows, not sums of the optional value measure. Exact
values and labels remain in the table. Missing dates remain in the table.

Keyboard-accessible selection buttons emit `aeliqo-visualization-select` with
`{source: 'user', identity, result}`. The event is a proposal to the application;
it does not execute an action. Matrix row movement preserves the focused keyed
button. Result replacement resets pagination. Every view displays loaded count,
coverage, approximate precision, period, filtering and warnings. Browser proof
covers Chromium, axe, exact values, keyboard selection, reordered rows, revoked
bindings and narrow RTL at 24px. Manual assistive-technology and broader release
matrices remain separate required evidence.
