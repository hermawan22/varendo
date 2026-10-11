---
component: 'compound.search-results'
title: 'SearchResults'
family: 'compound'
contract: 'Query state, collection, scoped result count and details with stale-result protection.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

SearchResults binds a query, its result collection, a scoped count, and selected detail. Use it when results can go stale and that must stay visible.

## When to use it

- A query drives a result list, a scoped count, and an optional detail pane.
- Query and result revisions can diverge, so stale results need labeling.
- Selection must stay an identity request for a supplied row.
- The host owns running the search; the component reflects query state.

## When to use a different component

- Use RecordList when query revisions and stale handling are unnecessary.
- Use Explorer when filtering and browsing matter more than a query string.
- Use SearchField alone for query entry without a managed result view.

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

Keep query and revision state above results when detail moves below them. Show stale status with text as well as tone.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [SearchField](/components/input.search-field/)
- [RecordList](/components/data.record-list/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
