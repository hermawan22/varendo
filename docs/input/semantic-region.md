# Semantic input regions

The direct input components are ordinary native-friendly controls. A region adds a reviewed semantic binding around those controls. The presentation graph carries only a `bindingRef` and the immutable `bindingRevision`; it cannot provide the label, option list, semantic field, default, action, upload behavior or file schema.

```ts
import {createVarendoPresentationRegistry, type VarendoInputBindings} from "@varendo/web/region";

const bindings = {
  revision: "checkout-inputs-3",
  inputs: [{
    id: "email",
    ref: {id: "input.text-field", revision: "1"},
    config: {label: "Email", autocomplete: "email"},
    draft: {
      entity: "checkout",
      key: "cart-42",
      field: "email",
      entityRevision: "9",
      type: {value: "text", nullable: false},
    },
  }],
} satisfies VarendoInputBindings;

const registry = createVarendoPresentationRegistry({inputs: bindings});
```

The host validates and owns this table. A draft event contains the registered `entity`, `key`, `field` and `entityRevision`, with its value revalidated against the registered `SemanticType`. Text, date, number, checkbox, select, radio, combobox, search and slider proposals use the shared `draft` interaction payload. Number controls never emit an invalid value. Date ranges have separate registered `start` and `end` ports, so each side retains its own field identity. Slider and number units must match the registered unit exactly.

Forms have a host-registered action and immutable scalar parameters. A submit emits an `action-request`; the region does not execute the action and does not turn the draft store into form state. File inputs have a registered extension schema and emit file metadata only (`name`, `size`, `type`, `lastModified`). Bytes and upload callbacks never cross the presentation wire.

The adapter accepts only the typed input event classes emitted by the shared controls. Foreign `CustomEvent` objects, malformed details and composing drafts are ignored. Composition and ordinary typing therefore remain local control behavior; a host can decide when to commit or execute without an agent/model call on the input path.


Draft targets are not presented Result fields. These queryless nodes resolve an empty field-coverage list while retaining their registered field identity in the draft port and payload. The shared region uses the same owned controls as direct component consumers.
