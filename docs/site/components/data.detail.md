---
component: 'data.detail'
title: 'Detail'
family: 'data'
contract: 'Selected entity facts including missing fields; identity visibility is explicit.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Show the declared fields of one selected record as labeled facts. Missing fields stay visible; set
`showIdentity` to display the record key alongside them.

## When to use it

- Show every declared field of the record a person selected.
- Keep missing fields visible instead of omitting them.
- Display record identity next to a list, table, or editor by setting `showIdentity`.

## When to use a different component

- Use KeyValue for a short fact list without record identity.
- Use RecordEditor when the task is editing the record through a form.

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

Long field values wrap within the detail region. Keep record identity visible when the host moves detail below the list.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [KeyValue](/components/data.key-value/)
- [RecordEditor](/components/compound.record-editor/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
