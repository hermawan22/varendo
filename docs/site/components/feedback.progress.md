---
component: 'feedback.progress'
title: 'Progress'
family: 'feedback'
contract: 'Determinate or unknown progress honestly; no invented completion percentages.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Reports an ongoing operation with native progress semantics. A bounded value shows determinate progress; no value stays indeterminate, so nothing is invented.

## When to use it

- The host knows how much of the operation is done.
- The operation is underway but completion is unknown.
- A persistent label should name what is progressing.

## When to use a different component

- Use [Skeleton](/components/feedback.skeleton/) when the shape of pending content matters more than progress.
- Use [EmptyState](/components/feedback.empty-state/) when the operation ended with nothing to show.

## Properties and defaults

{{aeliqo:properties}}

## Events

{{aeliqo:events}}

## States and failure handling

Relevant states:

{{aeliqo:states}}

{{aeliqo:outcome}}

With no finite `value`, the component renders an indeterminate progressbar.
For determinate progress, it clamps the displayed value to the range from zero
to `max`; an invalid or nonpositive `max` falls back to 100. The host should
report completion only when the underlying operation actually finishes.

## Keyboard, focus, and accessibility

Keyboard behavior:

{{aeliqo:keyboard}}

Exposed semantics:

{{aeliqo:semantics}}

## Responsive behavior

The bar follows its host width while the label remains readable. Do not use color alone to report the current value.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Skeleton](/components/feedback.skeleton/)
- [EmptyState](/components/feedback.empty-state/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
