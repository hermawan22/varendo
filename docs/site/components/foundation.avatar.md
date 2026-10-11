---
component: 'foundation.avatar'
title: 'Avatar'
family: 'foundation'
contract: 'Display optional identity image; fallback initials and privacy-safe alt policy.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Shows one person's image, with initials as fallback when the image is missing or fails. Set `alt` on meaningful images; mark it `decorative` only when nearby text already names the person.

## When to use it

- Showing who created or owns a record, comment, or message.
- A compact identity cue in a list row, header, or byline.
- Cases where a remote image may fail; initials cover the fallback.

## When to use a different component

- Use Text when the person's name must always stay visible.
- Use RecordList when each row needs record fields, not only identity.

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

Avatar uses its selected size. Pair it with wrapping identity text when initials alone do not fit the narrow layout.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Text](/components/foundation.text/)
- [RecordList](/components/data.record-list/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
