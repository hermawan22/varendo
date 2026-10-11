---
component: 'input.search-field'
title: 'SearchField'
family: 'input'
contract: 'Explicit/debounced query policy; composition input is not submitted mid-IME.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

A search field whose local `value` is the query. The host can set it; user input updates it and emits
a search request on Enter or `submitQuery()`. With `queryOnInput`, typing debounces that request and
IME composition never submits early. The host decides whether to run or persist the query.

## When to use it

- People type a query the host runs against its own data.
- You want an explicit submit gesture, a debounce policy, or both.
- The query text is the value; nothing is picked from a list.

## When to use a different component

- Use [Combobox](/components/input.combobox/) when the query must resolve to a known option.
- Use [TextField](/components/input.text-field/) when the text is stored data, not a query.

## Properties and defaults

{{aeliqo:properties}}

## Events

{{aeliqo:events}}

## States and failure handling

Relevant states:

{{aeliqo:states}}

{{aeliqo:outcome}}

The default `queryOnInput` value is false. When enabled, `debounceMs` is
clamped to 0–10,000 milliseconds (250 by default); a host-driven value change
or disconnection cancels a pending timer. The component emits a query
proposal, never performs the search or decides whether zero results means
empty data, a denied source, or a failed request.

## Keyboard, focus, and accessibility

Keyboard behavior:

{{aeliqo:keyboard}}

Exposed semantics:

{{aeliqo:semantics}}

## Responsive behavior

Let the query field use the available row width. Keep search policy and empty feedback visible when the form stacks.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Combobox](/components/input.combobox/)
- [SearchResults](/components/compound.search-results/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
