---
component: 'foundation.heading'
title: 'Heading'
family: 'foundation'
contract: 'Preserve logical document hierarchy independent of visual size.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

A heading at the document level you set, with visual size chosen separately. Changing `size` never changes the level announced to assistive technology.

## When to use it

- Titling a section in the document outline.
- Keeping the outline truthful when the design needs a different size.
- Any heading screen readers should announce at a fixed level.

## When to use a different component

- Use Text for body copy and non-heading strings.
- Use Separator for a visual boundary that isn't a title.

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

Headings wrap with the reading column. Preserve their document order if the host changes the visual size or section layout.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Text](/components/foundation.text/)
- [Separator](/components/foundation.separator/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
