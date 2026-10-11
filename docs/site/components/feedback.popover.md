---
component: 'feedback.popover'
title: 'Popover'
family: 'feedback'
contract: 'Contextual nonmodal surface with explicit focus/dismiss behavior and viewport containment.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

A contextual surface anchored to a trigger, with an explicit open state and dismissal policy. The host picks nonmodal or modal behavior; the component emits a close request, not an action.

## When to use it

- Small content or actions belong next to the element that opened them.
- The surrounding page should stay usable while the surface is open.
- Open, close, and dismissal need explicit host control.

## When to use a different component

- Use [Tooltip](/components/feedback.tooltip/) for a short explanation with no interaction.
- Use [Dialog](/components/feedback.dialog/) for a blocking decision that needs modal focus.

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

Keep the popover inside the viewport and its trigger visible. Choose Dialog if the content cannot fit beside the current task.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Tooltip](/components/feedback.tooltip/)
- [Dialog](/components/feedback.dialog/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
