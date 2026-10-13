---
component: 'feedback.skeleton'
title: 'Skeleton'
family: 'feedback'
contract: 'Stable reserved geometry with reduced motion and a named loading state.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Reserves a visible shape for content that is still loading. Line count and variant describe the expected geometry; the host replaces it with the real result.

## When to use it

- Content is loading and its rough shape is already known.
- You want to reserve space so the layout does not jump.
- Reduced-motion settings should stop the pulse animation.

## When to use a different component

- Use [Progress](/components/feedback.progress/) when the host can measure real progress.
- Use [EmptyState](/components/feedback.empty-state/) once the result is known to be empty.

## Properties and defaults

{{varendo:properties}}

## Events

{{varendo:events}}

## States and failure handling

Relevant states:

{{varendo:states}}

{{varendo:outcome}}

The text variant renders between one and twelve lines, clamping an out-of-range
`lines` value; rectangular and circular variants render one shape. Reduced
motion turns off the pulse animation. The skeleton carries a loading status,
but it cannot tell whether a request later became empty, denied, or failed.

## Keyboard, focus, and accessibility

Keyboard behavior:

{{varendo:keyboard}}

Exposed semantics:

{{varendo:semantics}}

## Responsive behavior

Match the width of the content it replaces without forcing horizontal scroll. Reduced-motion settings stop its animation.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Progress](/components/feedback.progress/)
- [EmptyState](/components/feedback.empty-state/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
