---
component: 'data.record-list'
title: 'RecordList'
family: 'data'
contract: 'Scannable records with identity-based selection and reachable additional fields.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Show records in a compact, scannable list. Selection emits stable record keys; the application applies them.

## When to use it

- Browse records where reading order matters more than columns.
- Let people select one or more records by stable identity.
- Expose extra fields on demand while rows stay compact.

## When to use a different component

- Use Table when sorting, paging, or comparing columns is the task.
- Use CardCollection when each record needs a heading and card layout.

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

Keep rendered row counts bounded for long lists. Preserve stable identity and the selected state as the list width changes.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [CardCollection](/components/data.card-collection/)
- [Table](/components/data.table/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
