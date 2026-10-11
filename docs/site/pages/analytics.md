---
id: 'analytics'
path: '/guides/analytics/'
section: 'Guides'
title: 'Analytics and time'
description: 'Declare analytical meanings, periods, denominators, completeness, and eligible trend views.'
---

<p class="lead">A chart is trustworthy only when your app defines what its numbers mean. Varendo evaluates registered meanings and carries their time period, time policy, population, and coverage into the result the view uses.</p>

## When you need this

- Users should see a trend or comparison, not a table of raw rows.
- A number needs a declared unit, denominator, or time period.
- Missing data must never plot as a confident zero.

## 1. Register the meaning

Define the entity fields and their roles first, then register the measure and its allowed aggregation. A count, a sum, and a ratio are different meanings even when they read the same rows. A daily ratio divides the summed numerator by the summed denominator for each day. Averaging individual percentages would change the meaning. A request may only name registered fields, meanings, relations, and operations authorized for that resource.

```ts
const workforceHeadcount = defineResource({
  id: 'workforce-headcount',
  revision: 'headcount-1',
  label: 'Monthly workforce headcount',
  identity: ['id'],
  rowGrain: ['month'],
  schema: z.object({ id: z.string(), month: z.iso.date(), headcount: z.number().int() }),
  fields: {
    id: { label: 'Snapshot ID', hidden: true },
    month: { label: 'Month', role: 'time' },
    headcount: { label: 'Month end headcount', role: 'measure' },
  },
  measures: {
    'month-end-headcount': {
      label: 'Month end headcount',
      explanation: 'Employees active at the end of each month. Never sum across time.',
      aggregate: 'sum',
      field: 'headcount',
      semiAdditiveOver: ['month'],
    },
  },
  presentation: { allowedViews: ['table', 'trend'], preferred: { analyze: 'trend' } },
});
```

`measures` covers counts, distinct counts, and sums. Each entry becomes a
reviewed meaning whose output type comes from the schema; `semiAdditiveOver`
marks snapshot values that must never be added across those fields. For ratios,
denominators, or host capabilities, declare a full `meanings` entry instead.
An analyze request references a measure as `{ id: 'month-end-headcount', revision: '1' }`.

See [semantic contracts](/concepts/semantics/) and [resource metadata](/guides/resources/).

## 2. Make the time window explicit

Choose a registered temporal field, a calendar, a timezone, a time bucket, and a visible period. A period is a half-open interval — a record exactly on the end boundary belongs to the next period. Declare the timezone on the field and the query's time bucket; never infer it from the browser clock. Period offsets and DST-aware period execution are not supported by the local evaluation path — filter with explicit date ranges instead.

## 3. Send an analyze request

An `analyze` request names the registered meaning and the declared time policy. This request asks for the headcount trend:

**analyze request**

```json
{
  "version": "1",
  "id": "monthly-headcount",
  "kind": "analyze",
  "resource": "workforce-headcount",
  "measures": [{ "id": "month-end-headcount", "revision": "1" }],
  "time": { "field": "month", "grain": "month", "calendar": "gregorian", "timezone": "UTC" },
  "preferredView": "trend",
  "sort": [{ "field": "month", "direction": "asc" }]
}
```

The measure must be a registered meaning on that resource at that revision. An ad-hoc aggregate like "average of headcount" is not accepted. Send it with `app.render` or `surface.request`.

## 4. Pick an eligible view

The resolver may choose `trend` when the result has a compatible time field, a registered measure, and a renderer. `preferredView` is a hint, not a bypass. When a request names two metrics and needs a choice, the status is `needs-input`. See [adaptive regions](/guides/adaptive-region/).

Run **Monthly headcount** in the [playground](/playground/?scenario=people) to see this request committed as a trend.

## What can go wrong

- Unknown or ambiguous metrics need a registered default or an explicit clarification. The request fails or returns `needs-input`.
- Mixed units, an incompatible time period, an unsupported aggregation, or a missing denominator cannot be faked into a plausible chart.
- A period with no observations stays marked missing. A partial period is not complete coverage.
- Cancellation and late results cannot replace a newer committed view. A failed update keeps the previous result only while it stays authorized; scope revocation clears it.
- A server adapter must enforce the same authorization and coverage claims before returning data. See [HTTP data](/guides/http-data/).

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/concepts/semantics/"><span>Semantic contracts</span><small>Model units, measures, and temporal policy.</small><b aria-hidden="true">→</b></a><a href="/examples/"><span>Runnable examples</span><small>See analyze requests in working apps.</small><b aria-hidden="true">→</b></a></nav>
