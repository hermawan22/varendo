---
id: 'frameworks'
path: '/start/frameworks/'
section: 'Get started'
title: 'Framework setup'
description: 'Mount the same registered application in React, Vanilla, or Vue, and use the maintained Next.js path for server rendering.'
---

## Start with a working resource

The [React quickstart](/start/) registers a People resource backed by a local
array. To browse a complete read-only array already owned by React, use the
[local surface API](/guides/local-data/) for a smaller setup.

The examples here use the registered application from
[Connect your data](/start/registered-app/). First create that tutorial's
`src/app.ts` and install its packages. It exports `createTutorialApp` and
`mountPeople`, so every example below uses the same data and authority contract.

Choose one host. Each entry mounts two synthetic people into one named region.
Do not combine all three entries in the same page.

## React

Use the tutorial's `src/PeopleTutorial.tsx`, which contains fully typed
`VarendoProvider` and `VarendoRegion` usage. Put this in `src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { createTutorialApp } from './app.js';
import { PeopleTutorial } from './PeopleTutorial.js';

const target = document.getElementById('root');
if (!target) throw new Error('Missing root container.');
const app = createTutorialApp([
  { id: 'ada', name: 'Ada Chen', team: 'Design' },
  { id: 'sam', name: 'Sam Rivera', team: 'Engineering' },
]);
const root = createRoot(target);
root.render(<PeopleTutorial app={app} />);

if (import.meta.hot) import.meta.hot.dispose(() => {
  root.unmount();
  app.dispose();
});
```

Run `npm run dev`. **Engineering** leaves Sam visible; **All employees**
restores both. The tutorial also includes the trend and review-only form.
`VarendoRegion` owns its region's mount/unmount and cancels stale intent work.
`VarendoProvider` shares the app; its creator owns app disposal. In a router,
perform that cleanup when the owning route ends. When the intent switches
resources, the tutorial's `key={intent.resource}` closes the old region first.

## Vanilla TypeScript

Create a Vite Vanilla TypeScript project with
`npm create vite@latest people-vanilla -- --template vanilla-ts`, then install
the same tutorial packages and copy `src/app.ts`. Keep Vite's `#app` container
and replace `src/main.ts` with:

```ts
import { mountPeople } from './app.js';

const target = document.querySelector<HTMLElement>('#app');
if (!target) throw new Error('Missing app container.');
const screen = mountPeople(target, [
  { id: 'ada', name: 'Ada Chen', team: 'Design' },
  { id: 'sam', name: 'Sam Rivera', team: 'Engineering' },
]);
const receipt = await screen.render();
if (receipt.status !== 'renderer-ready') console.error(receipt.diagnostics);

if (import.meta.hot) import.meta.hot.dispose(() => screen.dispose());
```

Run `npm run dev`. The mounted container shows both people. If this is a route
inside a larger app, call `screen.dispose()` in its teardown hook. For a shared
app, `app.unmount(regionId)` removes one region; `app.dispose()` ends them all.

## Vue

Create a Vite Vue TypeScript project with
`npm create vite@latest people-vue -- --template vue-ts`, install the same
tutorial packages, and copy `src/app.ts`. Replace `src/main.ts` with this
composition API entry; it uses Vue's existing `#app` container:

```ts
import { createApp, h, onBeforeUnmount, onMounted, ref } from 'vue';
import { mountPeople } from './app.js';

const host = createApp({
  setup() {
    const target = ref<HTMLElement>();
    const status = ref('Loading people…');
    let screen: ReturnType<typeof mountPeople> | undefined;
    onMounted(async () => {
      if (!target.value) return;
      const mounted = mountPeople(target.value, [
        { id: 'ada', name: 'Ada Chen', team: 'Design' },
        { id: 'sam', name: 'Sam Rivera', team: 'Engineering' },
      ]);
      screen = mounted;
      const receipt = await mounted.render();
      if (screen === mounted) status.value = receipt.status;
    });
    onBeforeUnmount(() => {
      screen?.dispose();
      screen = undefined;
    });
    return () => h('section', [
      h('h1', 'People'),
      h('p', { role: 'status' }, status.value),
      h('div', { ref: target }),
    ]);
  },
});
host.mount('#app');
if (import.meta.hot) import.meta.hot.dispose(() => host.unmount());
```

Run `npm run dev`. You should see both people and `renderer-ready`. Vue owns
its container and lifecycle; Varendo owns the rendered children inside it.
For standalone custom elements, pass structured values as DOM properties and
listen for native events. Follow [standalone components](/start/standalone-components/)
for registration and a complete example.

## Next.js and other server-rendered hosts

Follow [SSR and hydration](/ship/ssr/) before importing a browser entry point.
The maintained `examples/next-platform` fixture and `pnpm test:next-platform`
exercise useful initial HTML and hydration. Framework consumers in
`tests/framework-consumers` exercise Vanilla, React, and Vue from clean tarballs.
These are separate verification paths; a client-only Vite example does not
establish server rendering support.

## Resolve common integration failures

- **Browser globals during server evaluation:** move registration and DOM access
  into the client boundary described in the SSR guide.
- **Duplicate regions or listeners:** create one app per owning context and
  balance every mount with unmount. Do not create a new app on every render.
- **Missing rows:** read the receipt. Confirm the resource ID, registered data,
  and current authority before investigating layout.
- **Values serialized as text:** assign arrays, objects, and callbacks as DOM
  properties rather than HTML attributes.

Continue to [App API](/reference/app-api/) for exact lifecycle signatures and
[existing applications](/start/existing-app/) for route and authorization wiring.
