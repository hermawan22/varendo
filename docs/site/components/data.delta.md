---
component: 'data.delta'
title: 'Delta'
family: 'data'
contract: 'Explicit compatible baseline; zero denominator and percentage-point versus relative change distinguished.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Show the change between a current value and a baseline, as absolute, relative, or percentage-point. Incompatible inputs read as unavailable, not a misleading number.

## When to use it

- Compare this period against a baseline or a previous period.
- Show change as an absolute, relative, or percentage-point difference.
- Report movement where both values share the same unit and meaning.

## When to use a different component

- Use Metric when only one value exists, with no baseline to compare.
- Use Table when comparing many current-versus-baseline pairs at once.

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

Keep current and baseline context with the change. Stack the values at narrow widths rather than dropping either one.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Metric](/components/data.metric/)
- [Table](/components/data.table/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
