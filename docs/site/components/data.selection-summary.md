---
component: 'data.selection-summary'
title: 'SelectionSummary'
family: 'data'
contract: 'Disclose selected identities or server predicate scope; never imply unobserved global selection.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Show what is selected: picked record keys or a server-side filter. Clear selection sends a request for the application to handle.

## When to use it

- Show a selected count next to a table or list.
- Distinguish chosen records from a server-side selection scope.
- Offer a clear action the host confirms.

## When to use a different component

- Use FilterBuilder when people need to change the filter itself.
- Use Table when browsing and selecting rows is the main task.

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

Let the count, scope, and clear action wrap together. Keep the scope associated with the selected count.

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
