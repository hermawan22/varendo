---
component: 'foundation.text'
title: 'Text'
family: 'foundation'
contract: 'Render trusted/plain text with locale and wrapping; no untrusted HTML interpolation.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Renders a trusted string in the element you choose, with optional muted styling. The value is inserted as text, never parsed as HTML.

## When to use it

- Body copy, captions, or any ordinary trusted string.
- Text that must never be interpreted as markup.
- Strings needing muted styling or a specific element via `as`.

## When to use a different component

- Use Heading for a section title in the document outline.
- Use Badge for a short status or category marker.

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

Text follows its parent width. Allow long values to wrap and avoid fixed-height containers when zoom or localization adds lines.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Heading](/components/foundation.heading/)
- [Badge](/components/foundation.badge/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
