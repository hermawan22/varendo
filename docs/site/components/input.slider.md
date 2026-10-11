---
component: 'input.slider'
title: 'Slider'
family: 'input'
contract: 'Bounded quantity with keyboard and text alternative; steps and units are declared.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

A native range control paired with an editable numeric field for one bounded quantity. The host can
set `value`; either control updates that local property and shows its unit. `min`, `max`, and `step`
constrain edits, while the host decides what to retain or persist.

## When to use it

- People adjust a quantity inside declared bounds, such as volume or confidence.
- A range is useful, but people also need to enter an exact value directly.
- The current value and unit should stay visible beside the track and numeric field.

## When to use a different component

- Use [NumberField](/components/input.number-field/) when a range control would not help people choose the value.
- Use [Form](/components/input.form/) when the value submits alongside other fields.

## Properties and defaults

{{aeliqo:properties}}

## Events

{{aeliqo:events}}

## States and failure handling

Relevant states:

{{aeliqo:states}}

{{aeliqo:outcome}}

Changing `value` or `unit` or replacing `validator` cancels validation for the
previous value and clears its validator-owned error. An independently supplied
host `error` survives the change. Late results after a reset or disconnect are
ignored.

## Keyboard, focus, and accessibility

Keyboard behavior:

{{aeliqo:keyboard}}

Exposed semantics:

{{aeliqo:semantics}}

## Responsive behavior

Give the track its own row in narrow forms. Keep its numeric label and unit visible as the viewport shrinks.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [NumberField](/components/input.number-field/)
- [Form](/components/input.form/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
