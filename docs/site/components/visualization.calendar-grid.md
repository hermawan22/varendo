---
component: 'visualization.calendar-grid'
title: 'CalendarGrid'
family: 'visualization'
contract: 'Calendar-aligned values/events with an explicit week start and exact values beyond color.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Place loaded rows on Gregorian calendar days. Tiles show row counts and up to three row labels; the
data table carries exact values and remaining rows. `weekStartsOn` defaults to Monday.

## When to use it

- Spot daily patterns like activity by weekday or week.
- Show loaded rows on real calendar days with an optional week-start override.
- Keep exact values and rows available in the data table.

## When to use a different component

- Use Timeline for sequence or elapsed time instead of calendar cells.
- Use Heatmap for two chosen dimensions rather than calendar days.

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

At container widths of 30rem or less, exact-data rows become stacked records so labels remain readable inside narrow desktop panels as well as mobile pages.

At 7rem or less, each selection label moves above its button. The button text stays on one line, including when text is enlarged.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Timeline](/components/visualization.timeline/)
- [Heatmap](/components/visualization.heatmap/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
