---
id: 'registered-app'
path: '/start/registered-app/'
section: 'Get started'
title: 'Connect your data'
description: 'Connect application-owned data and authority, then render a filtered table, semantic trend, reviewed form, and optional MCP tools.'
---

<p class="lead">Connect your own data and permissions to Varendo. You will render a filtered table, a trend chart, and a reviewed form in one region. The final section explains where to add an agent after the manual screen works.</p>

<div class="docs-inline-cta"><p><strong>New to Varendo?</strong> Run the small local quickstart first. Come back when you need real app data.</p><a href="/start/">Open the local React quickstart →</a></div>

<aside class="doc-callout" data-tone="note"><strong>Before you start</strong><p>You need Node.js 24, React 19.2, TypeScript, and an app that can provide rows plus the signed-in user's permissions. Keep every Varendo package on exactly version 0.1.0.</p></aside>

<aeliqo-release-status></aeliqo-release-status>

Start from the React TypeScript project created in the [quickstart](/start/).
You will add `src/app.ts` and `src/PeopleTutorial.tsx`, then replace the entry
file once. All records in this guide are synthetic; the authority function is
a demonstration principal that you must replace before using private data.

This tutorial uses the app-level API in `@varendo/react/app`. You mount a named region once, then send typed requests to it. The code below is the real, compiled tutorial source.

## 1. Install the packages

```bash
npm install --save-exact \
  @varendo/core@0.1.0 \
  @varendo/runtime@0.1.0 \
  @varendo/web@0.1.0 \
  @varendo/react@0.1.0 \
  @varendo/agent@0.1.0 \
  react@19.2.8 react-dom@19.2.8 zod@4.5.4
```

## 2. Register resources and data

Create `src/app.ts`. It defines two resources. `people` has a stable `id`, labeled fields, and two allowed views. `workforce-headcount` stores one month-end snapshot per month; its measure is marked semi-additive so it is never summed across months.

The same file creates two bounded local data services and an `authorize` check that checks the synthetic principal provided by the tutorial authority. `createAeliqoApp` wires resources, data, and authority into one app instance. Swap the local service for your HTTP adapter when your server owns the records — keep credentials and grants out of requests.

<aeliqo-source data-label="src/app.ts" data-path="examples/quickstart/src/app.ts"></aeliqo-source>

You should see: `createTutorialApp(records)` returns one app instance with two registered resources.

## 3. Build the screen

Create `src/PeopleTutorial.tsx` using the full source below. `AeliqoProvider`
shares the app; `AeliqoRegion` mounts `people-main` and renders the current
intent. The React buttons select a request and the form owns its draft.

<aeliqo-source data-label="src/PeopleTutorial.tsx" data-path="examples/quickstart/src/PeopleTutorial.tsx"></aeliqo-source>

## 4. Mount and run it

Replace `src/main.tsx` with this entry. Hot module replacement disposes this
example; a real route should perform the same cleanup in its teardown hook:

```tsx
import { createRoot } from 'react-dom/client';
import { createTutorialApp } from './app.js';
import { PeopleTutorial } from './PeopleTutorial.js';

const app = createTutorialApp([
  { id: 'ada', name: 'Ada Chen', team: 'Design' },
  { id: 'sam', name: 'Sam Rivera', team: 'Engineering' },
]);

const target = document.getElementById('root');
if (!target) throw new Error('Missing root container.');
const root = createRoot(target);
root.render(<PeopleTutorial app={app} />);
if (import.meta.hot) import.meta.hot.dispose(() => {
  root.unmount();
  app.dispose();
});
```

Run `npm run dev` and open the printed URL.

You should see: three buttons drive the region — a table of people, a filtered table, and a headcount trend — plus a review-only form.

## 5. Try each request

- **All employees** shows Ada and Sam. Narrow the container to see an allowed
  compact view.
- **Engineering** keeps Sam. The typed filter names a declared field; the view
  reflects the evaluated result rather than manually hidden DOM rows.
- **Monthly headcount** plots six month-end values, from 118 to 130. The measure
  is semi-additive and declares a monthly Gregorian time axis in UTC. It must
  not be summed across months.
- Enter a name and choose **Review employee**. The status asks for review;
  no employee is saved. A real write goes through a registered action and fresh
  server authorization.

## 6. Expose the region to an agent

Create `src/agent.ts`. `createAppToolEndpoint` pairs one mounted region with a transport and gives the agent three tools: `aeliqo_context`, `aeliqo_render`, `aeliqo_act`. The host picks the region, transport, expiry, and size limits. The agent cannot grant itself permissions or supply markup.

<aeliqo-source data-label="src/agent.ts" data-path="examples/quickstart/src/agent.ts"></aeliqo-source>

Attach the endpoint to the [local MCP transport](/agents/mcp/) and close it on disconnect or expiry. Keep every button and form working when no agent is connected.

## Check lifecycle behavior

<div class="doc-checklist"><ul><li>All employees renders a table on wide containers and an allowed compact view on narrow ones.</li><li>Engineering shows only the Engineering rows you passed in, with the filter visible.</li><li>Monthly headcount plots 118 through 130 by month and never sums them.</li><li>The form keeps its draft and writes nothing before host review.</li><li>The MCP endpoint expires, disconnects, and rechecks permissions on every tool call.</li><li>Unmounting the screen disposes the region; disposing the app cancels remaining work.</li></ul></div>

## Recover from an unsuccessful request

<div class="doc-table"><table><thead><tr><th>Status</th><th>Next action</th></tr></thead><tbody><tr><th><code>needs-input</code></th><td>Show the returned choice or form field and send a more specific request.</td></tr><tr><th><code>unsupported</code></th><td>Check the resource's requests, registered views, and presentation policy.</td></tr><tr><th><code>denied</code></th><td>Fix host authorization. Never put a grant inside the request.</td></tr><tr><th><code>failed</code></th><td>Show the diagnostic and keep the previous valid view.</td></tr><tr><th><code>cancelled</code></th><td>Treat unmount and superseded requests as normal. Retry only on a new user action.</td></tr></tbody></table></div>

<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/guides/resources/"><span>Resource guide</span><small>Review identity, meaning, forms, and presentation policy.</small><b aria-hidden="true">→</b></a><a href="/agents/quickstart/"><span>Agent quickstart</span><small>Pair one expiring session with your region.</small><b aria-hidden="true">→</b></a></nav>
