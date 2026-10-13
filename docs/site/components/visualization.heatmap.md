---
component: 'visualization.heatmap'
title: 'Heatmap'
family: 'visualization'
contract: 'Two dimensions and one measure; accessible exact cell values and readable color key.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

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

The plot and its data view stay in a scrollable viewport. Preserve both dimension labels when the host narrows the view.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Matrix](/components/visualization.matrix/)
- [CalendarGrid](/components/visualization.calendar-grid/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
