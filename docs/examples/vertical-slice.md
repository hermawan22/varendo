# HR data to an interactive view

This private example exercises the production packages with synthetic HR source
records. The application defines reviewed absence meanings, source relationships,
permissions, and a typed task. The reusable evaluator computes a five-employee
ranking and weekly trends for that same population. The pure compiler selects a
composition without a preset; the runtime stages and commits it; shared web
elements render it.

From the repository root, run `pnpm build:runtime`, `pnpm build:platform`, then
`pnpm --filter @varendo/vertical-slice dev`. Select an employee and use **Swap view
order** to rearrange the existing views without rerunning the queries. The host
owns its styles and may set the shared component tokens to match its design.

`pnpm test:vertical` checks independent expected arithmetic, local/serialized-HTTP
parity, fixed and live cohort behavior, missing observations, selection, queryless
reordering, stale proposals, and revoked data. `pnpm test:vertical:browser`
exercises actual rendering and the `/ssr` test route. That route proves unknown
environment server rendering and hydration with preserved table DOM and a typed
selection callback. Its hydrated callback is a receipt test; it does not recreate
a client runtime session.

The browser example uses the local service. The HTTP integration test serializes
through the real HTTP handler in-process; it does not use a deployed backend.
Detail-query drill-down and model invocation are outside this example's scope.
