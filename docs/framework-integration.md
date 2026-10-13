# Framework integration

Varendo has one browser implementation. `@varendo/web` owns the Lit custom
elements and their properties, events, form behavior, and rendering. React
uses thin `@lit/react` wrappers around those same elements. Vue and other
frameworks use the custom-element surface directly. There is no second
component implementation per framework.

The maintained runnable recipes are indexed by
[`frameworkRecipes`](../examples/framework-recipes.ts). The source paths in
that index point at the fixtures used by the browser and installed-package
checks.

## Vanilla

Install `@varendo/web`, register elements once at the application boundary, and
set typed properties on the element. A normal DOM listener receives the typed
`varendo-input-change` event; a native `FormData` submission remains available.

```ts
import { registerVarendoElements } from '@varendo/web';
import { VarendoInputChangeEvent, type VarendoTextFieldElement } from '@varendo/web/inputs';

registerVarendoElements();
const input = document.querySelector<VarendoTextFieldElement>('varendo-text-field');
if (!input) throw new Error('Input is missing');
input.addEventListener('varendo-input-change', (event) => {
  if (event instanceof VarendoInputChangeEvent) {
    input.value = event.detail.value;
  }
});
```

## React

Import wrappers from their family subpaths. Call
`registerVarendoReactElements()` once in the browser entry. React properties
are controlled by the host and custom-element events become typed callback
props.

```tsx
import { useState } from 'react';
import { VarendoTextField } from '@varendo/react/inputs';
import { VarendoTable } from '@varendo/react/data';
import { registerVarendoReactElements } from '@varendo/react';

registerVarendoReactElements();

export function PeopleForm() {
  const [name, setName] = useState('Ada');
  return (
    <>
      <VarendoTextField label="Person" value={name} onValueChange={(event) => setName(event.detail.value)} />
      <VarendoTable caption="People" columns={[{ key: 'name', label: 'Name' }]} rows={[{ name }]} />
    </>
  );
}
```

The React package exports thin wrappers for all 71 catalog entries. The
`@varendo/react/foundation`, `/inputs`, `/navigation`, `/feedback`, `/data`,
`/plot`, `/visualization`, and `/compound` subpaths are available when a
consumer wants a narrower import boundary. A direct component stays direct:
it does not start a planner, a runtime region, an agent, or a model call.

### React server rendering and hydration

SSR is opt-in. Import `@varendo/react/ssr` before the bindings in the server
entry and in the client hydration entry. The server output contains Lit's
declarative shadow root; the host must preserve that markup and load Lit
hydration support before registering the browser elements. Ordinary imports do
not read browser globals or enable SSR as a side effect.

```tsx
// server entry
import '@varendo/react/ssr';
import { VarendoTextField } from '@varendo/react/inputs';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

const html = renderToString(createElement(VarendoTextField, { label: 'Person', value: 'Ada' }));
```

The production-shaped App Router recipe is in
[`examples/next-platform`](../examples/next-platform). Its client entry loads
`@lit-labs/ssr-client/lit-element-hydrate-support.js` before registering the
elements and retains the host-owned event/property boundary.

For request-specific pages, create the runtime, bindings, and public initial
snapshot inside the server request boundary. Do not keep principal-specific
records, credentials, or mutable result caches at module scope, and mark such
responses `private, no-store` unless the host has established a safe cache
policy. The client should reuse only a validated public snapshot and preserve
the server's initial direction/theme until hydration completes.

### Static/island embedding

[`examples/vnext/islands`](../examples/vnext/islands) is a framework-free
recipe: ordinary page content remains useful without JavaScript, while one
custom-element island registers on the client. It is a small embedding option,
not a new Varendo framework package or a claim that every framework is
qualified. Vanilla, React, Vue, and the Next App Router fixture are exercised
by the maintained framework checks; other adapters remain host-owned and
unqualified until they have their own runnable consumer evidence.

## Vue

Vue embeds the same registered custom element. Keep data in Vue state and pass
element properties through `h` or a template. Use the event name in its DOM
form (`onVarendo-input-change` for `varendo-input-change`).

```ts
import { createApp, h, ref } from 'vue';
import { registerVarendoElements } from '@varendo/web';
import { VarendoInputChangeEvent } from '@varendo/web/inputs';

registerVarendoElements();
const App = {
  setup() {
    const value = ref('Vue');
    return () =>
      h('varendo-text-field', {
        label: 'Person',
        value: value.value,
        'onVarendo-input-change': (event: Event) => {
          if (event instanceof VarendoInputChangeEvent) value.value = event.detail.value;
        },
      });
  },
};
createApp(App).mount(document.querySelector('#app')!);
```

## Meaning authoring is independent of the UI

Developer-authored meanings use `@varendo/core` and
`@varendo/runtime/meaning`. They reuse the application Catalog, preserve field
identity and type information, and return the same typed expression/evaluator
contracts used by other authoring surfaces. The path does not import a model,
chart, layout, or framework package.

```ts
import { type Catalog } from '@varendo/core';
import { createStandardFunctionRegistry } from '@varendo/core/expressions';
import { createMeaningAuthoring } from '@varendo/runtime/meaning';

const registry = createStandardFunctionRegistry('app-functions');
if (!registry.ok) throw new Error('Cannot create function registry');
const catalog = {
  version: '1',
  revision: 'app-catalog',
  functionRegistryDigest: registry.value.digest,
  entities: [
    {
      id: 'orders',
      label: 'Orders',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [
        { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
        { id: 'amount', label: 'Amount', role: 'measure', type: { value: 'integer', nullable: false } },
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
} as const satisfies Catalog;

const authoring = createMeaningAuthoring({ catalog, registry: registry.value });
if (!authoring.ok) throw new Error('Catalog is invalid');
const amount = authoring.value.field('orders', 'amount');
if (!amount.ok) throw new Error('Amount field is unavailable');
const total = authoring.value.call({ id: 'core.aggregate.sum', revision: '1' }, [amount]);
if (!total.ok) throw new Error('Meaning is invalid');
const definition = authoring.value.defineMeaning({
  id: 'orders.total',
  label: 'Order total',
  description: 'Sum of order amounts',
  expression: total.value,
});
if (!definition.ok) throw new Error('Meaning definition is invalid');
```

With a literal Catalog, the field helper also gives useful compile-time
feedback:

```ts
// @ts-expect-error `missing` is not a field in the reused `orders` schema.
authoring.value.field('orders', 'missing');
```

Meaning definitions contain semantic identity, units, grain, and dependencies;
they do not choose a chart or layout. The same definition can feed a table,
ranking, or trend after the host has authorized and evaluated the relevant
result.

## Verification

Run the focused external proof after dependencies are installed:

```sh
node tests/framework-consumers/framework-tarballs.mjs
```

It packs `@varendo/core`, `@varendo/runtime`, `@varendo/web`, and `@varendo/react`,
installs those exact tarballs in a temporary directory outside the workspace,
strictly type-checks vanilla/React/Vue plus the meaning quickstart, renders a
React SSR fixture, and exercises properties/events in Chromium. Existing
platform and Next fixtures add CSP, native form, and App Router hydration
coverage.
