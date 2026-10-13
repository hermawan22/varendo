---
component: 'visualization.scatter'
title: 'Scatter'
family: 'visualization'
contract: 'Two quantitative axes, declared units, stable point selection and noncausal interpretation.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

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

The plot and its data view stay in a scrollable viewport. Set dimensions from the host and keep point selection operable.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Relationship](/components/visualization.relationship/)
- [Trend](/components/visualization.trend/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
