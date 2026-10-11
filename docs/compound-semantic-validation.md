# Canonical compound semantic validation

The acceptance fixture in `tests/compound-semantic/` exercises every current
canonical macro through the host-owned presentation registry and the shared
presentation validator:

| Macro          | Registered primitive path                  |
| -------------- | ------------------------------------------ |
| Explorer       | filter builder, record list, detail, table |
| Comparison     | visualization matrix                       |
| Breakdown      | metric, record list                        |
| Investigation  | trend, timeline, detail                    |
| Search results | search field, record list                  |
| Record editor  | form                                       |
| Form flow      | form                                       |
| Quality panel  | detail                                     |

The fixture also checks an identity-equivalence selection link, result scope
and operation coverage rejection, stale input binding rejection, SSR of the
expanded plan, and Chromium rendering plus filter and selection events from
the same validated plan.

Validated on 2026-09-09 with:

```text
pnpm -s exec vitest run -c tests/compound-semantic/vitest.config.mjs
pnpm -s exec tsc -p tests/compound-semantic/tsconfig.json --noEmit
pnpm -s exec playwright test --config tests/compound-semantic/playwright.config.mjs
```

Results: 13 Vitest tests passed, the semantic fixture typecheck passed, and 2
Chromium tests passed.
