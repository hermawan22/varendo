---
component: 'input.number-field'
title: 'NumberField'
family: 'input'
contract: 'Locale-aware editing separates display text from exact numeric value; do not silently round money.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

The host can set the exact `value` as a decimal string. Typing updates the local `text` draft and
emits it with a canonical `value` only when valid within the declared minimum, maximum, and step; the
host decides what to persist.

## When to use it

- You need an exact numeric value, such as money or a measured quantity.
- People type digits that should display in their own locale.
- The value must respect declared minimum, maximum, or step bounds.

## When to use a different component

- Use [Slider](/components/input.slider/) when an approximate position in a range is enough.
- Use [DateField](/components/input.date-field/) when the value is a calendar date.

## Properties and defaults

{{aeliqo:properties}}

## Events

{{aeliqo:events}}

## States and failure handling

Relevant states:

{{aeliqo:states}}

{{aeliqo:outcome}}

Changing `value` or `text` or replacing `validator` cancels validation for the
previous value and clears its validator-owned error. An independently supplied
host `error` survives the change. Late results after a reset or disconnect are
ignored.

Minimum, maximum, and step checks use exact decimal arithmetic. Signed zero,
including `-0.00`, compares equally to `0`; its sign and decimal places remain
in the value and displayed text.

## Keyboard, focus, and accessibility

Keyboard behavior:

{{aeliqo:keyboard}}

Exposed semantics:

{{aeliqo:semantics}}

## Responsive behavior

Leave room for the localized value and unit. Check the editable draft at 200% text so digits are not clipped.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Slider](/components/input.slider/)
- [DateField](/components/input.date-field/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
