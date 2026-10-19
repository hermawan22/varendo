---
component: 'foundation.grid'
title: 'Grid'
family: 'foundation'
contract: 'Arrange responsive regions without changing semantic/focus order.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

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

The item minimum controls how many columns fit. Check the smallest supported width before raising that minimum.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Stack](/components/foundation.stack/)
- [SplitPane](/components/foundation.split-pane/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
