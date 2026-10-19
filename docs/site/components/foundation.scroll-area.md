---
component: 'foundation.scroll-area'
title: 'ScrollArea'
family: 'foundation'
contract: 'Preserve native scrolling, focus visibility, zoom and platform affordances.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

A native scroll viewport with an accessible label for overflow content. `axis` sets scroll direction; `tabIndex` controls whether keyboard users can enter the region.

## When to use it

- A panel or sidebar whose content overflows its bounds.
- Content that scrolls independently of the page.
- Regions keyboard users enter and scroll with arrow keys.

## When to use a different component

- Use SplitPane when two regions need a resizable divider instead.
- Use Surface for a labelled section that doesn't scroll on its own.

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

Bound its height only when independent scrolling is needed. Keep enough visible space for keyboard scrolling at high zoom.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [SplitPane](/components/foundation.split-pane/)
- [Surface](/components/foundation.surface/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
