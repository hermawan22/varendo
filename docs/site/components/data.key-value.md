---
component: 'data.key-value'
title: 'KeyValue'
family: 'data'
contract: 'Labeled facts with stable ordering, wrapping and semantic links.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

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

Allow definition-list labels and values to wrap in reading order. Keep each label adjacent to its value.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Detail](/components/data.detail/)
- [RecordList](/components/data.record-list/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
