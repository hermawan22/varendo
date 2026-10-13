---
component: 'input.text-field'
title: 'TextField'
family: 'input'
contract: 'Label, description, validation, autocomplete and an IME-safe local value draft.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

A labelled single-line text input with description and validation feedback. The host can set `value`
to supply or revise the draft; user edits also update that local property and emit typed change and
commit events. The host decides what to retain or persist.

## When to use it

- You need one line of free text, such as a name, email, or title.
- The field needs a visible label, hint text, or validation message.
- The value benefits from browser autocomplete or IME composition.
- You want to supply an initial value and receive typed draft changes.

## When to use a different component

- Use [TextArea](/components/input.text-area/) when the value can span more than one line.
- Use [SearchField](/components/input.search-field/) when the text is a query the host runs.
- Use [NumberField](/components/input.number-field/) when the value must stay an exact number.

## Properties and defaults

{{varendo:properties}}

## Events

{{varendo:events}}

## States and failure handling

Relevant states:

{{varendo:states}}

{{varendo:outcome}}

## Keyboard, focus, and accessibility

Keyboard behavior:

{{varendo:keyboard}}

Exposed semantics:

{{varendo:semantics}}

## Responsive behavior

Keep the label, description, and error visible when the form narrows. Put the field on its own row when the label is long.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [TextArea](/components/input.text-area/)
- [SearchField](/components/input.search-field/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
