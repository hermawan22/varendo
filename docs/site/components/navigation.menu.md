---
component: 'navigation.menu'
title: 'Menu'
family: 'navigation'
contract: 'Action menu with focus return and keyboard behavior; no layout-generated business actions.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

A short list of app-supplied commands with roving keyboard focus. Selecting an item emits its ID; your app performs the action and controls open state.

## When to use it

- An overflow or actions button on a row or record.
- A few explicit commands, some possibly disabled.
- Command lists that must stay fully keyboard operable.

## When to use a different component

- Use Popover for details or content that isn't a command list.
- Use TreeNav for hierarchical navigation instead of flat commands.

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

Use Home and End to move focus to the first or last enabled command.

## Responsive behavior

Keep the menu within the visible viewport and its commands keyboard reachable. Avoid relying on hover to expose actions.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [TreeNav](/components/navigation.tree-nav/)
- [Popover](/components/feedback.popover/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
