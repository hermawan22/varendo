---
component: 'visualization.bar'
title: 'Bar'
family: 'visualization'
contract: 'Comparable quantitative categories; baseline and negative values correctly represented.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Compare a measure across categories with bars. Negative values and the baseline stay visible; exact values sit in the data table.

## When to use it

- Compare one measure across named categories.
- Show values that cross zero, like profit or variance.
- Rank categories by an exact number.

## When to use a different component

- Use Histogram for a numeric measure split into declared bins.
- Use Area for magnitude change over time.

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

The plot and its data view stay in a scrollable viewport. Set dimensions from the host and keep category labels readable.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Histogram](/components/visualization.histogram/)
- [Area](/components/visualization.area/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
