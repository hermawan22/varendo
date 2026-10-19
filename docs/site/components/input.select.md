---
component: 'input.select'
title: 'Select'
family: 'input'
contract: 'Bounded enumerated choice with native-first semantics; empty and unknown value are distinct.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

A bounded choice with a styled trigger and chevron; the option popup and keyboard stay native. The
host can set `value`; choosing an option updates that local property and emits a typed change. An
empty value is no selection, and an unknown value stays visible instead of picking another option;
the host decides what to persist.

## When to use it

- People pick one option from a short, fixed set.
- The choices fit a bounded list that does not need a query.
- Compact display matters more than keeping every option visible.
- Empty and unknown values must stay distinct from a real selection.

## When to use a different component

- Use [Combobox](/components/input.combobox/) when people need to search a longer list.
- Use [RadioGroup](/components/input.radio-group/) when the choices should stay visible.

## Properties and defaults

{{varendo:properties}}

## Events

{{varendo:events}}

## States and failure handling

Relevant states:

{{varendo:states}}

{{varendo:outcome}}

Changing `value` or replacing `validator` cancels validation for the
previous value and clears its validator-owned error. An independently supplied
host `error` survives the change. Late results after a reset or disconnect are
ignored.

## Keyboard, focus, and accessibility

Keyboard behavior:

{{varendo:keyboard}}

Exposed semantics:

{{varendo:semantics}}

## Responsive behavior

Give the field enough width to show its selected label. Keep options bounded so the list fits the visible viewport.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Combobox](/components/input.combobox/)
- [RadioGroup](/components/input.radio-group/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
