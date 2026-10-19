---
component: 'visualization.tree'
title: 'Tree'
family: 'visualization'
contract: 'Explicit hierarchy, cycle validation, stable expansion and equivalent text navigation.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Show a declared parent-child hierarchy as a tree. A structured data view keeps every node reachable without the graphic.

## When to use it

- Show org charts or nested categories with declared parents.
- Let people expand levels while selection stays stable.
- Offer a text outline when the graphic is too dense.

## When to use a different component

- Use Treemap when area should encode a value.
- Use Relationship for directed edges that are not strict parent-child.

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

At container widths of 30rem or less, exact-data rows become stacked records so labels remain readable inside narrow desktop panels as well as mobile pages. The graphic keeps its declared dimensions inside a focusable scroll region instead of shrinking its text to fit. Tab to the region to access its overflow; exact values remain available below.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Treemap](/components/visualization.treemap/)
- [Relationship](/components/visualization.relationship/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
