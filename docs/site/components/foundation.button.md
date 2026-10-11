---
component: 'foundation.button'
title: 'Button'
family: 'foundation'
contract: 'Trigger one explicit action; native button semantics; disabled and pending never double-submit.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

A native button for one explicit action. It emits a cancellable action event; your app performs the work and clears `pending`.

## When to use it

- Submitting a form, saving a record, or confirming a step.
- An action your app must be able to cancel before it runs.
- Actions that must not double-submit while `pending` or `disabled`.

## When to use a different component

- Use Link when activation navigates to another page.
- Use IconButton for a compact icon action with its own accessible name.

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

Its target keeps the component minimum hit area. Give long action labels a full row in narrow forms and leave room for the focus outline.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [IconButton](/components/foundation.icon-button/)
- [Link](/components/foundation.link/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
