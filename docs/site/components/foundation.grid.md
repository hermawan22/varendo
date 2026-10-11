---
component: 'foundation.grid'
title: 'Grid'
family: 'foundation'
contract: 'Arrange responsive regions without changing semantic/focus order.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Places children in the CSS grid you declare, without changing DOM or focus order. `columns` and `minItem` control how many columns fit.

## When to use it

- Cards, fields, or tiles that repeat in columns.
- Layouts that add or drop columns as the width changes.
- Grids where focus order must follow the DOM order.

## When to use a different component

- Use Stack for a single row or column.
- Use SplitPane when users must resize the two regions.

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

The item minimum controls how many columns fit. Check the smallest supported width before raising that minimum.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Stack](/components/foundation.stack/)
- [SplitPane](/components/foundation.split-pane/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
