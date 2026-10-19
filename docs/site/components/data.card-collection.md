---
component: 'data.card-collection'
title: 'CardCollection'
family: 'data'
contract: 'Repeated compact records; preserve reading order, headings and bounded loading.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

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

{{varendo:properties}}

## Events

{{varendo:events}}

## States and failure handling

Relevant states:

{{varendo:states}}

{{varendo:outcome}}

## Keyboard, focus, and accessibility

Keyboard behavior:

{{varendo:keyboard}}

Exposed semantics:

{{varendo:semantics}}

## Responsive behavior

Cards adapt to available width. Let field values wrap and keep each selection control reachable.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [RecordList](/components/data.record-list/)
- [Table](/components/data.table/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
