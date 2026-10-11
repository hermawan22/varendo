# Input primitives

The input family is a shared native form boundary for the web package. Each
field owns a labeled native control, participates in `ElementInternals` form
submission and reset, and emits typed user proposals. A host remains the
authority that accepts a proposal or performs an action.

The family includes text and number editing, checkbox/radio/switch/select
choices, bounded combobox loading, calendar dates and ranges, sliders, search,
file metadata, field groups and forms. Values that carry meaning stay typed:
number fields retain an exact canonical decimal string, date fields retain a
`YYYY-MM-DD` calendar value, and file events expose metadata without copying
file bytes into an agent payload.

`AeliqoComboboxElement` accepts a bounded `options` array or an
`optionsLoader(query, signal)` callback. Each request is abortable and a late
response is ignored. `AeliqoSearchFieldElement` emits `aeliqo-search` only on
Enter or after an explicit bounded debounce; IME composition never commits a
partial query.

Direct imports are available from `packages/web/src/input/index.ts`. The
package root and custom-element registration remain thin integration layers;
applications can register only the tags they use.

`<aeliqo-form>` is an explicit host boundary for its slotted controls. It
validates and serializes native controls that are owned by the boundary and
merges the `formValue` of slotted Varendo fields. A native control already
owned by an outer `<form>`, a disabled fieldset, or a nested `<aeliqo-form>`
remains with that owner and is not duplicated. Submit buttons respect their
`formNoValidate` flag; Enter is deferred long enough for a child combobox,
select, or textarea to keep its own keyboard behavior. Use an ordinary native
`<form>` when the browser should own submission directly.
