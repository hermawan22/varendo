---
component: 'input.text-area'
title: 'TextArea'
family: 'input'
contract: 'Multiline editing preserves draft, selection and composition across unrelated updates.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

A labelled multi-line text area that keeps caret position and IME composition intact across updates.
The host can set `value` to supply or revise the draft; user edits update that local property and emit
typed change and commit events. The host owns application validation and persistence.

## When to use it

- You need more than one line of text, such as notes or a description.
- The field needs a label and a visible starting height.
- The host owns validation and persistence of the committed text.

## When to use a different component

- Use [TextField](/components/input.text-field/) when only one line is valid.
- Use [Form](/components/input.form/) when the text submits alongside other fields.

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

Rows set the starting height. Keep the draft readable when the form narrows and preserve line breaks as it grows.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [TextField](/components/input.text-field/)
- [Form](/components/input.form/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
