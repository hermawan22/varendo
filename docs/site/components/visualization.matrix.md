---
component: 'visualization.matrix'
title: 'Matrix'
family: 'visualization'
contract: 'Entity-feature comparison preserving row/column association and useful comparison at narrow width.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Compare records across the declared feature columns in a native table. Exact cell values remain
available; include an identity field in the columns when readers need it visible.

## When to use it

- Compare entities across several fields side by side.
- Keep each cell tied to its row and column.
- Show exact values rather than color-encoded cells.

## When to use a different component

- Use Heatmap when color should summarize cell values.
- Use Relationship for declared edges between entities.

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

At container widths of 30rem or less, the matrix keeps readable minimum column widths and scrolls horizontally inside its exact-data region. The surrounding page does not need to scroll sideways.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Heatmap](/components/visualization.heatmap/)
- [Relationship](/components/visualization.relationship/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
