---
component: 'data.metric'
title: 'Metric'
family: 'data'
contract: 'One validated value or aggregate with units, scope and unavailable state.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Show one labeled value with its unit and scope. A missing value reads as unavailable, never as an invented zero.

## When to use it

- Show a single KPI, count, or total on a dashboard.
- Report a value the application already computed and validated.
- Attach a unit, description, and scope to a number.
- Show an unavailable state when the value is missing.

## When to use a different component

- Use Delta to compare a current value against a baseline.
- Use Trend to show how a value changes over time.

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

Let long labels and formatted values wrap instead of clipping. Keep the unit visually associated with the value at text zoom.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Delta](/components/data.delta/)
- [Trend](/components/visualization.trend/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
