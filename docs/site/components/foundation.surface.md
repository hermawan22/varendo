---
component: 'foundation.surface'
title: 'Surface'
family: 'foundation'
contract: 'Provide consistent bounded chrome; never impose dashboard cards on every control.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Groups slotted content in a labelled section with a chosen surface tone. It adds visual containment, not card behavior or data meaning.

## When to use it

- Giving a section consistent chrome and an optional label.
- Applying a surface tone to a region of the page.
- Containing content without turning it into an action or card.

## When to use a different component

- Use Stack or Grid when the task is arranging children.
- Use CardCollection when each item is a data card, not a grouped section.

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

Surface follows the width of its parent and adds no columns. Put layout breakpoints on the containing Stack or Grid.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Stack](/components/foundation.stack/)
- [Grid](/components/foundation.grid/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
