---
component: 'input.combobox'
title: 'Combobox'
family: 'input'
contract: 'Searchable choice with APG behavior; stale remote options cannot overwrite current input.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

A searchable choice field with separate local `query` and selected `value` properties. The host can
set the selected `value`; typing clears it, while choosing an option updates it and emits a typed
change. Late remote responses are ignored, so stale options do not replace current results; the host
owns query sourcing and persistence.

## When to use it

- People pick one option from a list too long to read at once.
- Typing a query should filter the option list.
- Options may load remotely and responses can arrive late.
- The query draft and the committed value must stay separate.

## When to use a different component

- Use [Select](/components/input.select/) for a short list that needs no query.
- Use [SearchField](/components/input.search-field/) when the query itself is the value and no option is committed.

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

With a static `options` array, the component filters the bounded list as the
query changes. `optionsLoader(query, signal)` is the optional remote path: the
host owns the request and its authorization, while the component aborts the
previous load and ignores an older completion. At most 500 options are
accepted. A loader failure keeps the field visible, reports “Options could
not be loaded”, and never commits a different value. `minQueryLength` delays
loading until enough characters are typed.

## Keyboard, focus, and accessibility

Keyboard behavior:

{{varendo:keyboard}}

Exposed semantics:

{{varendo:semantics}}

## Responsive behavior

Keep the query draft and selected value distinct at narrow widths. Test long option names against the visible viewport.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Select](/components/input.select/)
- [SearchField](/components/input.search-field/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
