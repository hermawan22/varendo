---
component: 'foundation.link'
title: 'Link'
family: 'foundation'
contract: 'Navigate to an application-approved destination; preserve browser open-in-new-tab behavior.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

A native link to a destination your app approves, preserving browser behavior like open-in-new-tab. The host sets `href` and `target`; a cancellable event lets it intercept activation.

## When to use it

- Navigating to another page or route.
- Destinations users may open in a new tab.
- Links your app must approve before they render as anchors.

## When to use a different component

- Use Button when activation changes state or submits a request.
- Use Breadcrumb for a trail of ancestor links ending at the current page.

## Properties and defaults

{{varendo:properties}}

## Events

{{varendo:events}}

## States and failure handling

Relevant states:

{{varendo:states}}

{{varendo:outcome}}

An empty or invalid `href` renders plain text, not an anchor. `disabled`
renders noninteractive text too. Approved `_blank` destinations get
`noopener noreferrer`; your app still decides which destinations users may
open.

## Keyboard, focus, and accessibility

Keyboard behavior:

{{varendo:keyboard}}

Exposed semantics:

{{varendo:semantics}}

## Responsive behavior

The label follows inline text flow and can wrap. Avoid fixed-width wrappers that clip the text or focus outline.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Button](/components/foundation.button/)
- [Breadcrumb](/components/navigation.breadcrumb/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
