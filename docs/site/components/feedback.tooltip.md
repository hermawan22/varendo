---
component: 'feedback.tooltip'
title: 'Tooltip'
family: 'feedback'
contract: 'Supplemental nonessential information; works on focus, dismisses, not the sole label.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

A short supplemental explanation shown when its built-in trigger gets focus or hover. Escape hides it; it never serves as the trigger's accessible name.

## When to use it

- An icon or control needs a short extra explanation.
- The trigger already has an accessible name and the text is supplemental.
- The tip should appear on focus and hover and dismiss on Escape.

## When to use a different component

- Use [Popover](/components/feedback.popover/) when the content needs interaction or richer structure.
- Use [Text](/components/foundation.text/) when the explanation is essential and must stay visible.

## Properties and defaults

{{aeliqo:properties}}

## Events

{{aeliqo:events}}

## States and failure handling

Relevant states:

{{aeliqo:states}}

{{aeliqo:outcome}}

The built-in trigger opens the tooltip on focus or pointer hover and closes
it on blur, pointer leave, or Escape. There is no `disabled` property and no
separate component event. Remove the trigger when the explanation must be
unavailable; setting `open` to false alone will not disable focus or hover.
Keep a concise visible trigger label, because
tooltip content is supplementary.

## Keyboard, focus, and accessibility

Keyboard behavior:

{{aeliqo:keyboard}}

Exposed semantics:

{{aeliqo:semantics}}

## Responsive behavior

Keep essential instructions outside the tooltip. The trigger remains the layout anchor when the viewport is narrow or zoomed.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Popover](/components/feedback.popover/)
- [Dialog](/components/feedback.dialog/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
