---
component: 'input.date-field'
title: 'DateField'
family: 'input'
contract: 'Calendar date rather than timezone-shifted timestamp; typed entry and picker agree.'
---

## Import and live example

{{varendo:fixture}}

{{varendo:example}}

## Purpose

A native date input for one calendar date, with typed entry and picker kept in agreement. The host
can set its date-only `value`; editing updates that local property and emits a typed change. The host
adds timezone and business meaning and decides what to persist.

## When to use it

- You need one calendar date, such as a birthday or report date.
- The value must stay a date, not a timezone-shifted timestamp.
- Valid dates fall inside a declared range.

## When to use a different component

- Use [DateRange](/components/input.date-range/) when the task needs a start and an end date.
- Use [Form](/components/input.form/) when the date submits alongside related fields.

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

Leave enough width for the localized date at 200% text. Keep the label and declared bounds available beside the field.

## Style hooks

{{varendo:style-hooks}}

{{varendo:performance}}

## Related components

- [DateRange](/components/input.date-range/)
- [Form](/components/input.form/)

## Generated TypeScript declaration

{{varendo:declaration}}

## Version

This page documents the Varendo 0.6 component contract.
