---
component: 'input.switch'
title: 'Switch'
family: 'input'
contract: 'Binary setting with visible label; changing setting is not implicit business submission.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

A labelled on/off setting built on a native checkbox with switch semantics. The host can set
`checked`; toggling updates that local property and emits a typed change. It is not an implicit
submission, and the host decides whether to persist the setting.

## When to use it

- A preference turns on or off with immediate visible effect.
- The setting is binary; there is no mixed state.
- The label should stay short and always visible.

## When to use a different component

- Use [Checkbox](/components/input.checkbox/) for a form choice or a state that can be mixed.
- Use [Form](/components/input.form/) when the change submits alongside other fields.

## Properties and defaults

{{varendo:properties}}

## Events

{{varendo:events}}

## States and failure handling

Relevant states:

{{varendo:states}}

{{varendo:outcome}}

Changing `checked` or replacing `validator` cancels validation for the
previous value and clears its validator-owned error. An independently supplied
host `error` survives the change. Late results after a reset or disconnect are
ignored.

## Keyboard, focus, and accessibility

Keyboard behavior:

{{varendo:keyboard}}

Exposed semantics:

{{varendo:semantics}}

## Responsive behavior

Keep explanatory copy outside the short switch label. Preserve the control target when its parent narrows.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Checkbox](/components/input.checkbox/)
- [Form](/components/input.form/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
