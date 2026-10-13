---
component: 'compound.quality-panel'
title: 'QualityPanel'
family: 'compound'
contract: 'Source, freshness, completeness, provenance and unsupported claims displayed honestly.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

QualityPanel reports a view's source, freshness, completeness, provenance, and unsupported claims. Use it when people must judge how much to trust the data.

## When to use it

- A view must disclose where its data came from and when it refreshed.
- Completeness and provenance need a dedicated, labeled surface.
- Unsupported claims must stay visible as cautions, never as facts.
- Missing metadata should appear as not supplied rather than disappear.

## When to use a different component

- Use Alert for one warning that needs immediate attention.
- Use Badge for a single freshness or status label.
- Use KeyValue or Detail for general record fields, not quality metadata.

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

Let provenance and unsupported claims wrap inside the panel. Keep freshness and completeness labels visible before the evidence.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [Table](/components/data.table/)
- [Alert](/components/feedback.alert/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
