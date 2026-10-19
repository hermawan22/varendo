---
component: 'feedback.drawer'
title: 'Drawer'
family: 'feedback'
contract: 'Inline or modal detail according to an explicit mode; do not mix the two focus models.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Shows secondary detail at a chosen edge, inline in the layout or as a modal overlay. The mode sets focus and dismissal behavior; closing emits a request, not an action.

## When to use it

- Detail or actions should sit beside the page they relate to.
- Inline mode keeps the surrounding content visible and usable.
- Modal mode applies only when a separate focus boundary is needed.

## When to use a different component

- Use [Dialog](/components/feedback.dialog/) for a blocking confirmation.
- Use [Popover](/components/feedback.popover/) for small content anchored to a trigger.

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

Inline mode uses its host column; give it the full row when that column is too narrow. Choose modal mode only when a separate focus boundary is needed.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Dialog](/components/feedback.dialog/)
- [Popover](/components/feedback.popover/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
