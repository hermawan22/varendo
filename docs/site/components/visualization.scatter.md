---
component: 'visualization.scatter'
title: 'Scatter'
family: 'visualization'
contract: 'Two quantitative axes, declared units, stable point selection and noncausal interpretation.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Plot records as points on two numeric axes. Nearby points suggest correlation, not causation; exact values stay in the data table.

## When to use it

- Compare two measures per record, like cost versus usage.
- Spot clusters and outliers across many points.
- Select a point that stays tied to its source row.

## When to use a different component

- Use Relationship for declared edges between entities.
- Use Trend when one axis is time.

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

The plot and its data view stay in a scrollable viewport. Set dimensions from the host and keep point selection operable.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Relationship](/components/visualization.relationship/)
- [Trend](/components/visualization.trend/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
