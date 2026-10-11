---
component: 'visualization.area'
title: 'Area'
family: 'visualization'
contract: 'Temporal area/stack with compatible additive measures; reject misleading nonadditive stacking.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

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

The plot and its data view stay in a scrollable viewport. Set dimensions from the host and retain the declared missing-value treatment.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Trend](/components/visualization.trend/)
- [Scatter](/components/visualization.scatter/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
