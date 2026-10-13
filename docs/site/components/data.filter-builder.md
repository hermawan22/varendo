---
component: 'data.filter-builder'
title: 'FilterBuilder'
family: 'data'
contract: 'Typed predicates, AND/OR/null handling, visible inherited scope and explicit query application.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Build filter clauses from allowed fields and operators. Apply emits a request; the application authorizes and runs the query.

## When to use it

- Let people compose typed field clauses with AND/OR logic.
- Keep inherited filters visible next to the local draft.
- Delay execution until an explicit Apply request.

## When to use a different component

- Use SelectionSummary to report the active selection instead of editing it.
- Use Table to browse and sort the filtered rows.

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

Stack field, operator, and value controls when space is limited. Keep Apply reachable and preserve the active draft.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [SelectionSummary](/components/data.selection-summary/)
- [Table](/components/data.table/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
