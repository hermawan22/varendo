---
component: 'data.key-value'
title: 'KeyValue'
family: 'data'
contract: 'Labeled facts with stable ordering, wrapping and semantic links.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Show a short ordered list of labeled facts as a definition list. Each fact can carry a description or a safe link.

## When to use it

- List a few stable facts like owner, status, or scope.
- Keep fact order fixed so labels stay predictable.
- Attach an approved link to a fact.

## When to use a different component

- Use Detail to show a selected record with identity and missing-field labels.
- Use RecordList when browsing and selecting records is the task.

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

Allow definition-list labels and values to wrap in reading order. Keep each label adjacent to its value.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Detail](/components/data.detail/)
- [RecordList](/components/data.record-list/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
