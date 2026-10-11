---
component: 'data.card-collection'
title: 'CardCollection'
family: 'data'
contract: 'Repeated compact records; preserve reading order, headings and bounded loading.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Show records as cards with a heading and optional fields in reading order. Selection and Load more are requests the application answers.

## When to use it

- Give each record a visual card with its own heading.
- Let people select cards by stable identity.
- Grow long collections through a bounded Load more action.

## When to use a different component

- Use RecordList for a denser text-first selection list.
- Use Table when comparing values across columns is the task.

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

Cards adapt to available width. Let field values wrap and keep each selection control reachable.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [RecordList](/components/data.record-list/)
- [Table](/components/data.table/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
