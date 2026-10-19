---
component: 'input.checkbox'
title: 'Checkbox'
family: 'input'
contract: 'Native checked/indeterminate state; group ownership and submitted value are explicit.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

A native checkbox for one checked value, with an explicit indeterminate display. The host can set
`checked`; a user change updates that local property, clears indeterminate, and emits a typed change.
The host decides what to retain or persist.

## When to use it

- You need a yes/no answer inside a submitted form.
- One item can be included or excluded on its own.
- The group needs an indeterminate state, such as a partial selection.

## When to use a different component

- Use [Switch](/components/input.switch/) for a preference that takes effect outside form submission.
- Use [RadioGroup](/components/input.radio-group/) when the person must pick exactly one named option.

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

Let the label wrap beside the control without shrinking its target. Keep the text associated when fields stack.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Switch](/components/input.switch/)
- [RadioGroup](/components/input.radio-group/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
