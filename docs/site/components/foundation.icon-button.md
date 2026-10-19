---
component: 'foundation.icon-button'
title: 'IconButton'
family: 'foundation'
contract: 'Named compact action with minimum target area; icon alone is never its accessible name.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

A compact icon button with a native target and a text name from `label`. Your app owns the emitted action and its pending state.

## When to use it

- Toolbar or row actions where space is tight.
- Icon actions that still need an accessible name via `label`.
- Repeated compact actions, like row-level edit or delete.

## When to use a different component

- Use Button when the action needs a visible text label.
- Use Tooltip to add a hint; it cannot replace the `label` name.

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

The icon target keeps its minimum hit area. Separate adjacent actions so their targets and focus outlines remain distinct.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Button](/components/foundation.button/)
- [Tooltip](/components/feedback.tooltip/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
