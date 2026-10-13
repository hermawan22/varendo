---
component: 'visualization.histogram'
title: 'Histogram'
family: 'visualization'
contract: 'Declared binning, count/density labeling and missing-population disclosure.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Show executor-produced bins for one numeric measure. Scope text reports bin-delivery coverage; it does
not establish source-observation coverage or count missing or out-of-bin observations.

## When to use it

- Show the distribution of one measure, like order size.
- Work with bins that have declared boundaries.
- Label counts or density without implying missing rows were counted.

## When to use a different component

- Use Bar when categories already exist instead of numeric bins.
- Use Heatmap to compare a measure across two dimensions.

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

The plot and its data view stay in a scrollable viewport. Set dimensions from the host and keep bin boundaries labelled.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Bar](/components/visualization.bar/)
- [Heatmap](/components/visualization.heatmap/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
