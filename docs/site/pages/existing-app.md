---
id: 'existing-app'
path: '/start/existing-app/'
section: 'Get started'
title: 'Add Varendo to an existing application'
description: 'Adopt one read-only screen using your existing data and host lifecycle, then connect authorization and actions.'
---

## Choose a small first screen

Start with a list whose records have stable IDs and a clear permission boundary.
For example, add a People panel inside an existing route. Your router owns the
URL, your backend owns real data access, and the route owns the panel's lifetime.
Keep those responsibilities while introducing one adaptive region.

First complete [Connect your data](/start/registered-app/). It supplies a
working `src/app.ts`, including `mountPeople`, using synthetic records. Reuse
that file for the integration below before replacing its data source.

## 1. Give the route a container

Place this in the route's HTML or host template:

```html
<section aria-labelledby="people-title">
  <h2 id="people-title">People</h2>
  <p id="people-status" role="status">Loading people…</p>
  <div id="people-region"></div>
</section>
```

## 2. Mount and render from the route lifecycle

Create `src/people-screen.ts`. Call `openPeopleScreen()` after the container is
in the DOM. Keep its returned cleanup function and call it when the route leaves.

```ts
import { mountPeople } from './app.js';

export function openPeopleScreen() {
  const target = document.querySelector<HTMLElement>('#people-region');
  const status = document.querySelector<HTMLElement>('#people-status');
  if (!target || !status) throw new Error('People route containers are missing.');

  const screen = mountPeople(target, [
    { id: 'ada', name: 'Ada Chen', team: 'Design' },
    { id: 'sam', name: 'Sam Rivera', team: 'Engineering' },
  ]);
  let active = true;
  void screen.render().then((receipt) => {
    if (!active) return;
    status.textContent = receipt.status === 'renderer-ready'
      ? 'People loaded.'
      : `People could not render: ${receipt.status}`;
  });
  return () => {
    active = false;
    screen.dispose();
  };
}
```

You should see Ada and Sam, followed by **People loaded.** in the status.
Resize the container to exercise its allowed compact presentation. This app
instance belongs to this screen; a shared app shell should instead unmount only
the leaving region and dispose the app when the whole shell ends.

## 3. Replace the demonstration data boundary

The tutorial authority is a synthetic user, not an authentication integration.
Read your current principal and policy from trusted host state. Replace the
local fixture service with an [HTTP adapter](/guides/http-data/) whose server
reauthorizes each request. Keep scope and policy evidence consistent between
authority and data. Do not copy a user's grants from a URL or model request.

Pass an abort signal through remote work, cancel when the route leaves, and
handle authorization changes explicitly. A workspace selector does not grant
access. Follow [scopes](/guides/scopes/) before introducing tenant switching.

## 4. Add interaction in stages

Use your existing router through a [navigation adapter](/guides/navigation/).
Keep each form draft under one owner. Add [registered actions](/guides/actions/)
only after reads and lifecycle behavior are correct; route the effect through
your existing command path with fresh authorization and revision checks.

## Check transitions and recover

- Navigate away while a request is pending. Its work must be cancelled and the
  old region must not update a newly mounted screen.
- If rendering reports `denied`, inspect host authority and server policy.
  Adding a grant to an intent cannot fix access.
- If an update fails, show its diagnostic and retain the last authorized
  result. Forced revocation must fence the old scope instead.
- Navigate back and use keyboard focus. There should be one active screen and
  one event handler for each interaction.

Continue with [framework setup](/start/frameworks/) for lifecycle wiring in
React or Vue and the explicit Next.js server rendering path.
