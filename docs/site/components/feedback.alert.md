---
component: 'feedback.alert'
title: 'Alert'
family: 'feedback'
contract: 'Persistent status/error with severity semantics and actionable recovery.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

A persistent status or warning with a heading and message. Optional action and dismiss buttons emit separate proposals; tone supports the text, never replaces it.

## When to use it

- A status or error must stay visible until the host changes it.
- The message offers a recovery action or a dismissal.
- The information belongs inside the page's reading flow.

## When to use a different component

- Use [Toast](/components/feedback.toast/) for brief feedback that can disappear.
- Use [EmptyState](/components/feedback.empty-state/) when a region has no content to show.

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

Let the message and its actions wrap together. Keep dismissal available without separating it from the alert content.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Toast](/components/feedback.toast/)
- [EmptyState](/components/feedback.empty-state/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
