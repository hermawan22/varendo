---
component: 'compound.record-editor'
title: 'RecordEditor'
family: 'compound'
contract: 'Existing primitive form over a host-owned action with entity revision and explicit save/cancel.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

RecordEditor wraps slotted fields with a record key, revision, and save/cancel actions. Use it when edits must carry version evidence to a host-owned action.

## When to use it

- An existing record is edited and its revision must travel with the save.
- Save must validate the fields first and emit a proposal, never persist directly.
- Cancel must emit the same record context so the host can discard cleanly.
- The host owns the action, conflict handling, and resulting effect.

## When to use a different component

- Use Form for submissions without entity identity or revision.
- Use FormFlow for multi-step entry with drafts and review.
- Use Detail for read-only record display.

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

Stack fields at narrow widths. Keep the entity identity and revision associated with Save and Cancel.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Form](/components/input.form/)
- [Detail](/components/data.detail/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
