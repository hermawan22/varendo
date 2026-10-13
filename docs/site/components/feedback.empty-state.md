---
component: 'feedback.empty-state'
title: 'EmptyState'
family: 'feedback'
contract: 'Distinguish no records, no matches, forbidden data, loading and failure.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Explains why a region has no content, with an explicit kind, heading, and message. An optional recovery button proposes a host action such as clearing filters.

## When to use it

- A list or panel has no records or no matches to show.
- The reason for the empty region should be named, not implied.
- Recovery needs a visible action, such as clearing filters.

## When to use a different component

- Use [Alert](/components/feedback.alert/) for a warning while data is still available.
- Use [Skeleton](/components/feedback.skeleton/) while the content is still loading.

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

Keep the recovery action visible when the page narrows. Let the explanation wrap within the host column.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Alert](/components/feedback.alert/)
- [Skeleton](/components/feedback.skeleton/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
