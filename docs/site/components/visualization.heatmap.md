---
component: 'visualization.heatmap'
title: 'Heatmap'
family: 'visualization'
contract: 'Two dimensions and one measure; accessible exact cell values and readable color key.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Show a measure across two dimensions as colored cells with a readable key. Exact cell values stay in the data table.

## When to use it

- Find hot spots across two categories, like team by weekday.
- Scan many cells at once through color.
- Keep exact cell values reachable without reading color.

## When to use a different component

- Use Matrix when exact table values matter more than color.
- Use CalendarGrid when one axis is calendar days.

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

The plot and its data view stay in a scrollable viewport. Preserve both dimension labels when the host narrows the view.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Matrix](/components/visualization.matrix/)
- [CalendarGrid](/components/visualization.calendar-grid/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
