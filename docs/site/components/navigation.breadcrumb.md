---
component: 'navigation.breadcrumb'
title: 'Breadcrumb'
family: 'navigation'
contract: 'Reversible context path; approved routes and current-location semantics.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Shows a path as an ordered list. Approved ancestor destinations are links; the current item is text.
Mark it with `current`; if none is marked, the final item is current.

## When to use it

- Pages nested under parents, like Reports → Weekly report.
- Letting users jump back up the hierarchy.
- Marking the current location inside a navigable trail.

## When to use a different component

- Use Tabs to switch between sibling views, not a path.
- Use TreeNav for a hierarchy users expand and browse.

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

Allow long path segments to wrap. Keep the current location clear when the host shortens ancestry for a small screen.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Tabs](/components/navigation.tabs/)
- [TreeNav](/components/navigation.tree-nav/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
