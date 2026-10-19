---
component: 'feedback.dialog'
title: 'Dialog'
family: 'feedback'
contract: 'Native-first modal semantics, focus containment/return and escape policy.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

A modal dialog that contains focus while open. `closeOnEscape` controls Escape dismissal; the close
button always emits a close request. The host owns the action inside.

## When to use it

- The person must confirm or cancel before continuing.
- The content needs a modal focus boundary.
- Focus should return to the trigger when the dialog closes.

## When to use a different component

- Use [Drawer](/components/feedback.drawer/) for detail that should sit beside the current page.
- Use [Alert](/components/feedback.alert/) when the message belongs inline in the page.

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

Keep modal actions reachable within the viewport. Let long content scroll without covering the close or confirmation controls.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Drawer](/components/feedback.drawer/)
- [Alert](/components/feedback.alert/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
