---
component: 'compound.record-editor'
title: 'RecordEditor'
family: 'compound'
contract: 'Existing primitive form over a host-owned action with entity revision and explicit save/cancel.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

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

Stack fields at narrow widths. Keep the entity identity and revision associated with Save and Cancel.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Form](/components/input.form/)
- [Detail](/components/data.detail/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
