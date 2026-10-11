---
component: 'compound.breakdown'
title: 'Breakdown'
family: 'compound'
contract: 'Display host-prepared group metrics and contributing records; group selection is a host request.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Breakdown shows host-computed groups with values, record counts, and contributing rows. Use it when a total must stay traceable to the records behind it.

## When to use it

- The host has grouped metrics ready; each group needs a label, value, and count.
- Selecting a group should send its key to the host, not expand scope itself.
- Groups need their contributing records shown alongside the totals.
- Empty, partial, or stale groups need an honest displayed state.

## When to use a different component

- Use Comparison for a fixed set of chosen entities.
- Use Metric for one headline value without contributing records.
- Use Table when raw rows matter more than grouped totals.

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

Keep each group label beside its value and record count. Let groups wrap as the host column narrows.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Comparison](/components/compound.comparison/)
- [Metric](/components/data.metric/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
