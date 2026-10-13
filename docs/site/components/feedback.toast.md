---
component: 'feedback.toast'
title: 'Toast'
family: 'feedback'
contract: 'Bounded transient feedback; essential errors remain persistently available elsewhere.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Transient feedback shown while `open`. Non-danger tones can dismiss on a timer or by request; danger
tones remain open until dismissed. Keep important failures available in a persistent place too.

## When to use it

- Confirming an action that already finished, such as a save.
- The feedback is brief and can disappear without loss.
- Anything important also lives in a persistent place.

## When to use a different component

- Use [Alert](/components/feedback.alert/) for a message that must stay in the reading flow.
- Use [EmptyState](/components/feedback.empty-state/) when a region needs a lasting explanation.

## Properties and defaults

{{varendo:properties}}

## Events

{{varendo:events}}

## States and failure handling

Relevant states:

{{varendo:states}}

{{varendo:outcome}}

Set `duration` to zero for a notification that remains visible until the host
or user dismisses it. Timed notifications are capped at 60 seconds; a
`danger` tone never dismisses on the timer. Keep a durable status or error
elsewhere if a user may need to read or act on it after the toast closes.

## Keyboard, focus, and accessibility

Keyboard behavior:

{{varendo:keyboard}}

Exposed semantics:

{{varendo:semantics}}

## Responsive behavior

Allow long messages to wrap within the available width. Place transient feedback where it does not cover fixed task controls.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Alert](/components/feedback.alert/)
- [EmptyState](/components/feedback.empty-state/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
