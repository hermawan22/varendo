---
component: 'compound.explorer'
title: 'Explorer'
family: 'compound'
contract: 'Filter plus collection plus selected detail using shared parameter/selection state.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Explorer combines a filter bar, record list, and detail pane into one view with shared scope. Use it when browsing and inspecting records belong on the same screen.

## When to use it

- A record collection needs filter controls and a detail pane sharing one selection.
- Choosing a row should reveal its detail in place instead of navigating away.
- Filter and selection changes must reach the host as proposals, not silent mutations.
- The host owns rows, selection, and detail; the panels only coordinate them.

## When to use a different component

- Use RecordList alone when the view needs no filters or detail pane.
- Use Table when users scan many rows instead of inspecting one record.
- Use separate FilterBuilder, RecordList, and Detail when the app already owns panel layout.

## Properties and defaults

{{aeliqo:properties}}

## Events

{{aeliqo:events}}

## States and failure handling

Relevant states:

{{aeliqo:states}}

{{aeliqo:outcome}}

## Keyboard, focus, and accessibility

Keyboard behavior:

{{aeliqo:keyboard}}

Exposed semantics:

{{aeliqo:semantics}}

## Responsive behavior

Stack filters, records, and detail in reading order on narrow hosts. Preserve the shared scope and selected identity when panels move.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [FilterBuilder](/components/data.filter-builder/)
- [Table](/components/data.table/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
