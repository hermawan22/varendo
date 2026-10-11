---
component: 'navigation.tabs'
title: 'Tabs'
family: 'navigation'
contract: 'Named panels with stable selection; automatic activation only when latency permits.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

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

Keep each tab label distinct at narrow widths. Ensure the selected state and keyboard focus remain visible when the tab row overflows.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Breadcrumb](/components/navigation.breadcrumb/)
- [Menu](/components/navigation.menu/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
