---
component: 'input.field-group'
title: 'FieldGroup'
family: 'input'
contract: 'Group related controls with legend, descriptions and coordinated validation.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Groups related controls under one legend with shared description and error text. It can disable the whole fieldset while each child keeps its own value and validation.

## When to use it

- Several controls answer one question, such as the parts of an address.
- The group needs one legend plus shared description or error text.
- You want to disable a whole set of controls at once.

## When to use a different component

- Use [Form](/components/input.form/) when the controls also need submit and reset behavior.
- Use [TextField](/components/input.text-field/) or another single control when there is nothing to group.

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

Allow child controls to stack under the legend. Keep the legend and description visible above those controls.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Form](/components/input.form/)
- [TextField](/components/input.text-field/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
