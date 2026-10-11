---
id: 'semantics'
path: '/concepts/semantics/'
section: 'Reference'
title: 'Semantic contracts'
description: 'Separate technical field types from business definitions, units, aggregation, grain, and temporal policy.'
---

<p class="lead">Semantics are what fields mean — not their types. “Number” cannot tell you whether a value is a sum, an average, a ratio, a currency, or a trend. Semantic metadata stops a valid-looking query from making an invalid claim.</p>
<h2>Preserve meaning in the Result</h2><div class="doc-checklist"><ul><li>Stable entity identity and authorized population scope.</li><li>Row or aggregation grain.</li><li>Unit, precision, null behavior, and completeness.</li><li>Temporal field, calendar, timezone, and bucket grain when applicable.</li><li>Catalog, source, policy, and Result revisions.</li><li>Lineage from registered meaning and query operations.</li></ul></div>
<h2>Read a registered meaning</h2><p>This is the month-end headcount meaning from the maintained quickstart fixture. It is a reviewable contract, not a SQL fragment. It fixes the output kind and grain, the aggregation rule, and the missing-value policy.</p>

**resource.ts**

```ts
const workforceHeadcount = defineResource({
  id: 'workforce-headcount',
  // schema, identity, fields…
  meanings: [
    {
      id: 'month-end-headcount',
      revision: '1',
      label: 'Month end headcount',
      explanation: 'Employees active at the end of each month. Never sum across time.',
      output: { value: 'integer', nullable: false, grain: ['month'] },
      implementation: {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: { id: 'core.aggregate.sum', revision: '1' },
          arguments: [{ kind: 'field', ref: 'headcount' }],
        },
      },
      dependencies: [],
      functionRegistryDigest: 'core-query-2',
      origin: 'manual',
      lifecycle: 'active',
      scope: 'workspace',
      authority: 'approved',
      aggregation: 'semi-additive', // compare across months; never total them
      aggregationDimensions: ['month'],
      missingPolicy: 'reject', // missing rows fail instead of faking coverage
    },
  ],
});
```

<h2>Compare additive and ratio meanings</h2><p>Absence days can be summed. Absence rate is a ratio with a defined numerator, denominator, population, period, and precision. Varendo accepts analysis only when the requested meaning and grain are registered and compatible.</p>
<h2>Respect missing data</h2><p>Null is not zero. Partial is not exact. Sampled is not complete. The Result contract keeps these distinctions available to the recipe, so the UI cannot silently overstate evidence.</p>
<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/guides/resources/"><span>Resource metadata</span><small>Declare field roles and connect an existing Catalog.</small><b aria-hidden="true">→</b></a><a href="/concepts/safety/"><span>Semantic validation</span><small>See how invalid operations are rejected.</small><b aria-hidden="true">→</b></a></nav>
