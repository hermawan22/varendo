---
component: 'foundation.split-pane'
title: 'SplitPane'
family: 'foundation'
contract: 'Resize adjacent regions by pointer and keyboard while respecting minimum task requirements.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Two panes around a divider that users resize by pointer or keyboard. `min`, `max`, and `step` bound the range; changes emit a position request.

## When to use it

- A sidebar and detail view the user rebalances.
- Two regions that must stay usable within set limits.
- Layouts where keyboard users need the same resize control.

## When to use a different component

- Use Grid for a fixed responsive layout users can't resize.
- Use ScrollArea when one region needs bounded overflow scrolling.

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

`position` is the primary pane’s percentage of the available pane area, excluding the resize handle. The handle reserves its own space and is at least 44 CSS pixels wide (horizontal layout) or tall (vertical layout) for coarse pointers, including compact density. Ordinary text wraps within each pane; children can override wrapping for preformatted or intentionally scrollable content. Set pane limits so each side stays useful. On phones, use vertical orientation if two side-by-side panes become too narrow.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [ScrollArea](/components/foundation.scroll-area/)
- [Grid](/components/foundation.grid/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
