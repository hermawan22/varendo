---
component: 'visualization.timeline'
title: 'Timeline'
family: 'visualization'
contract: 'Dated events/intervals with timezone semantics, explicit overlaps and chronological alternative.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Order dated events or intervals chronologically. Overlapping intervals get separate lanes; exact dates stay in the data table.

## When to use it

- Show events or spans in chronological order.
- Display overlapping intervals in separate lanes.
- Keep exact start and end times readable beside the graphic.

## When to use a different component

- Use CalendarGrid for a calendar-shaped layout of dates.
- Use Trend for a continuous measure over time.

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

At 7rem or less, each selection label moves above its button. The button text stays on one line, including when text is enlarged.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [CalendarGrid](/components/visualization.calendar-grid/)
- [Trend](/components/visualization.trend/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
