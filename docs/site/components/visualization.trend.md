---
component: 'visualization.trend'
title: 'Trend'
family: 'visualization'
contract: 'Temporal metric series, declared grain, gaps and exact accessible summaries.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Show how a measure changes over time as a line. Gaps stay visible; exact values live in the paired data table.

## When to use it

- Track a measure like revenue or signups over time.
- Show change at the grain the spec declares.
- Keep missing periods visible as gaps, not filled points.
- Let people select a point tied to its source row.

## When to use a different component

- Use Area when filled magnitude or stacking is the point.
- Use Metric for one current value without a time axis.

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

The plot and its data view stay in a scrollable viewport. Set width and height from the host and retain the labelled data view.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Area](/components/visualization.area/)
- [Metric](/components/data.metric/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
