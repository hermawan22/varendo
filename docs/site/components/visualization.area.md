---
component: 'visualization.area'
title: 'Area'
family: 'visualization'
contract: 'Temporal area/stack with compatible additive measures; reject misleading nonadditive stacking.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Show change over time as a filled area so magnitude stands out. Stacking requires measures that add together legitimately.

## When to use it

- Emphasize total magnitude over time, not only direction.
- Stack series that sum to a meaningful total.
- Keep missing values treated as the spec declares.

## When to use a different component

- Use Trend for change over time as a line without fill.
- Use Scatter to compare two measures per record.

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

The plot and its data view stay in a scrollable viewport. Set dimensions from the host and retain the declared missing-value treatment.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Trend](/components/visualization.trend/)
- [Scatter](/components/visualization.scatter/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
