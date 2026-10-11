---
component: 'navigation.pagination'
title: 'Pagination'
family: 'navigation'
contract: 'Stable cursor/page scope; loaded rows are not misrepresented as global selection.'
---

## Import and live example

{{aeliqo:fixture}}

{{aeliqo:example}}

## Purpose

Shows the current page with previous and next controls from host-supplied data. Activation requests a page change; the component never fetches rows itself.

## When to use it

- Lists or tables split into discrete pages.
- Moving forward and back through paged results.
- Keeping loaded rows scoped to the requested page.

## When to use a different component

- Use Table when the task is comparing records in columns.
- Use SearchResults for a full query-results view with count and details.

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

Keep page controls large enough to operate. Let the host trim visible page links on narrow screens without hiding the current page.

## Style hooks

{{aeliqo:style-hooks}}

{{aeliqo:performance}}

## Related components

- [Table](/components/data.table/)
- [SearchResults](/components/compound.search-results/)

## Generated TypeScript declaration

{{aeliqo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
