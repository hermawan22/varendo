---
component: 'navigation.tree-nav'
title: 'TreeNav'
family: 'navigation'
contract: 'Hierarchical navigation with stable node identities, expansion and keyboard semantics.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

A bounded tree of navigation nodes with stable IDs and tree keyboard semantics. It tracks expansion locally and emits selection or expansion requests.

## When to use it

- Navigating sections nested more than one level deep.
- Trees users expand, collapse, and select by keyboard.
- Hierarchies keyed by stable, unique node IDs.

## When to use a different component

- Use Breadcrumb for a short path to one current location.
- Use Menu for a flat list of commands, not a hierarchy.

## Properties and defaults

{{aeliqo:properties}}

## Events

{{aeliqo:events}}

## States and failure handling

Relevant states:

{{aeliqo:states}}

{{aeliqo:outcome}}

Node IDs must be unique, nonempty, and at most 160 characters. Cycles,
invalid shapes, duplicate IDs, or more than 512 nodes render a status
message instead of the tree. `expandedIds` sets the expansion set; after an
uncancelled expand event, the element also updates it locally. An
uncancelled selection event updates `selectedId`. Watch those events to
keep routing aligned, and pass new props to reconcile external navigation
changes.

## Keyboard, focus, and accessibility

Keyboard behavior:

{{aeliqo:keyboard}}

Exposed semantics:

{{aeliqo:semantics}}

## Responsive behavior

Allow long node labels to wrap inside the tree. Keep the selected item and expansion state visible after the host narrows the panel.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Menu](/components/navigation.menu/)
- [Breadcrumb](/components/navigation.breadcrumb/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
