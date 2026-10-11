---
component: 'compound.comparison'
title: 'Comparison'
family: 'compound'
contract: 'A stable compare-set with compatible metrics and simultaneous comparison affordances.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Comparison places a small set of chosen entities side by side across supplied metrics. Use it when people must weigh a few records at once.

## When to use it

- A bounded set of entities needs the same metrics shown side by side.
- The host has declared the metrics compatible in units and grain.
- Compare-set changes must reach the host as a typed proposal.
- Values are precomputed; the view must not recalculate them or infer causes.

## When to use a different component

- Use Breakdown to compare host-defined groups instead of chosen entities.
- Use Table when users need to scan or sort the underlying records.
- Use Metric for a single value with no compare set.

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

Keep every compared entity and metric in view. Stack comparison rows or allow a local scroll area instead of dropping values.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Breakdown](/components/compound.breakdown/)
- [Table](/components/data.table/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
