---
component: 'foundation.stack'
title: 'Stack'
family: 'foundation'
contract: 'Arrange children in logical reading order with tokenized spacing.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Lays out children in reading order with the direction, gap, alignment, and wrap you set. Children keep their own semantics and focus order.

## When to use it

- Spacing items evenly along one row or column.
- Toolbars, button rows, or stacked form sections.
- Gaps and alignment from design tokens, not ad-hoc margins.

## When to use a different component

- Use Grid when items need rows and columns.
- Use SplitPane when two regions must be user-resizable.

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

Choose wrap or a different direction at the host breakpoint. Child order remains their DOM order.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Grid](/components/foundation.grid/)
- [SplitPane](/components/foundation.split-pane/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
