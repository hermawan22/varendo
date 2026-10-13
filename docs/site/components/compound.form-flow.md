---
component: 'compound.form-flow'
title: 'FormFlow'
family: 'compound'
contract: 'Task-based steps, draft continuity, validation and reversible navigation before commit.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

FormFlow walks users through named steps while retaining field drafts across navigation and
validating each step before commit. The host supplies `draft` and `activeStep` and owns durable
persistence.

## When to use it

- A task splits into named steps users move through forward and back.
- Each step must validate before the next step or the commit runs.
- Draft values must carry across steps and keep focus stable.
- Commit is a host proposal; the flow never applies the effect itself.

## When to use a different component

- Use Form when every field fits on one screen.
- Use RecordEditor when save must carry an existing record's key and revision.
- Use Dialog for a short confirmation, not a stepped task.

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

Keep the step label, validation, draft, and navigation in DOM order. Let the flow become one column as space decreases.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Form](/components/input.form/)
- [Dialog](/components/feedback.dialog/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
