---
component: 'visualization.relationship'
title: 'Relationship'
family: 'visualization'
contract: 'Declared edges/cardinality only; deterministic bounded layout with accessible adjacency view.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Draw declared edges between entities as a graph, with an edge table that keeps endpoint fields and selection reachable.

## When to use it

- Show declared connections such as reports-to or depends-on.
- Preserve edge direction and count from the supplied data.
- Use the edge table to inspect endpoint fields when the graph is crowded.

## When to use a different component

- Use Tree for a strict parent-child hierarchy.
- Use Scatter for two numeric axes; point position implies no link.

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

At container widths of 30rem or less, exact-data rows become stacked records so labels remain readable inside narrow desktop panels as well as mobile pages. The graphic keeps its declared dimensions inside a focusable scroll region instead of shrinking its text to fit. Tab to the region to access its overflow; exact values remain available below.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Tree](/components/visualization.tree/)
- [Scatter](/components/visualization.scatter/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
