---
component: 'navigation.tabs'
title: 'Tabs'
family: 'navigation'
contract: 'Named panels with stable selection; automatic activation only when latency permits.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

Switches between named panels with one selected value. `activation='manual'` waits for Enter or Space when changing panels is expensive.

## When to use it

- Switching between sibling views inside one page.
- Panels keyed by stable IDs your app controls.
- Costly panel loads that call for `activation='manual'`.

## When to use a different component

- Use Breadcrumb to show a path to the current location.
- Use Menu for a list of commands, not panel switching.

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

Keep each tab label distinct at narrow widths. Ensure the selected state and keyboard focus remain visible when the tab row overflows.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Breadcrumb](/components/navigation.breadcrumb/)
- [Menu](/components/navigation.menu/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
