---
id: 'resources'
path: '/guides/resources/'
section: 'Guides'
title: 'Define resources'
description: 'Describe runtime shape, stable identity, business meaning, forms, and allowed presentations in one application-owned definition.'
---

<p class="lead">A resource describes one kind of data — its fields, their types, a stable identity, and which views may show it.</p>

## When you need this

- You connect your own rows to Varendo, from a local array or a server.
- You want filters, forms, and charts to respect your field names and types.
- You need to control which views a request may use.

## 1. Describe one record

Create `people.ts`. Give the resource an ID, a revision, a label, and a Zod schema for one row.

**people.ts**

```ts
import { defineResource } from '@varendo/core';
import { z } from 'zod';

export const people = defineResource({
  id: 'people',
  revision: 'people-1',
  label: 'People',
  identity: ['id'],
  schema: z.object({
    id: z.string(),
    name: z.string(),
    team: z.enum(['Design', 'Engineering', 'Operations']),
    location: z.string(),
  }),
  fields: {
    id: { label: 'Person ID' },
    name: { label: 'Name' },
    team: { label: 'Team', role: 'dimension' },
    location: { label: 'Location' },
  },
  presentation: { allowedViews: ['table', 'cards', 'detail'] },
});
```

You should see: a `people` resource with a four-field schema and three allowed views.

## 2. Name the identity field

`identity` lists the fields that make each row unique. Varendo uses it to keep selection, detail views, and revisions stable. It is never a display label and never inferred from row order.

## 3. Label what fields mean

`fields` attaches readable labels and roles. A `role` such as `dimension`, `measure`, or `time` says which fields group rows, which hold numbers, and which carry dates.

## 4. Limit the views

`presentation.allowedViews` lists every view a request may pick. A resource that allows only `table` stays a table at every size. `preferred` ranks allowed views; it never adds a view you did not list.

## 5. Close the value sets

Zod `enum` and `literal` values join the contract. A filter must send the exact registered value — `Engineering`, not `engineering`. A request with an unknown value is rejected before any query runs.

## Add business meaning

A field type says how a value is stored, not what it means. Definitions such as "absence rate" belong in reviewed `meanings` on the resource, with their units, aggregation rules, and time policy. Varendo never assumes a number can be summed or a date forms a trend. Generated date fields use a Gregorian, UTC, day-level policy unless field metadata supplies a different semantic type. See [analytics](/guides/analytics/) and [semantic contracts](/concepts/semantics/).

## Use an existing catalog

Already maintain a richer data contract? Pass `catalog` and `entity` instead of `revision`, `identity`, and `meanings`. The Zod schema still covers the entity's fields so records stay checkable.

## What can go wrong

- A nested object, getter, or function in the schema fails with `resource.unsupported-schema`. Project nested content into flat scalar fields, or bind it to a [custom view](/guides/custom-views/).
- Metadata for a field the schema does not declare fails with `resource.unknown-field`.
- A declared `values` entry that fails the schema fails with `resource.field-values`.
- Change `revision` whenever the contract changes. Requests pin meaning by revision.

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/concepts/semantics/"><span>Semantic meaning</span><small>Model units, measures, time periods, and temporal policy.</small><b aria-hidden="true">→</b></a><a href="/guides/data/"><span>Connect data</span><small>Bind the resource to a data service.</small><b aria-hidden="true">→</b></a></nav>
