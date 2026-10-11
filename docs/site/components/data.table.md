---
component: 'data.table'
title: 'Table'
family: 'data'
contract: 'Native table first; separate interactive-grid mode; sorting, paging, selection, virtualization and precise values.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Show rows and columns in a native table, with an opt-in grid mode for cell navigation. Sorting, paging, and selection are requests the application answers.

## When to use it

- Compare exact values across many columns.
- Sort or page rows while the host owns the data.
- Select rows by stable identity.
- Handle large result sets through bounded pages or virtualization.

## When to use a different component

- Use RecordList for compact browsing without column comparison.
- Use SelectionSummary to report a selection rather than display rows.

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

Use the table’s bounded page or virtualization controls with wide data. Keep a scroll path or choose a compact view before labels become unreadable.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [RecordList](/components/data.record-list/)
- [SelectionSummary](/components/data.selection-summary/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
