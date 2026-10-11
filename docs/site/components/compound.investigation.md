---
component: 'compound.investigation'
title: 'Investigation'
family: 'compound'
contract: 'Trend, baseline, event timeline and detail; associations never imply causes.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Investigation arranges a trend, baseline metric, event timeline, and record detail in one scope. Use it when evidence about an entity must be reviewed together without implying cause.

## When to use it

- An entity needs trend, baseline, and event evidence viewed in one place.
- The host supplies the visualization specs, datasets, and detail record.
- Missing trend or event data must surface an explicit message.
- Associations may be shown but never presented as causes.

## When to use a different component

- Use Explorer for routine browse, filter, and selection work.
- Use Trend or Timeline alone when one evidence view is enough.
- Use Detail when only the record fields matter, without evidence panels.

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

Stack baseline, evidence, and detail in reading order. Avoid separate horizontal panels that hide the shared scope.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Explorer](/components/compound.explorer/)
- [SearchResults](/components/compound.search-results/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
