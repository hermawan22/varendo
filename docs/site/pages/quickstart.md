---
id: 'quickstart'
path: '/start/'
section: 'Get started'
title: 'Quickstart: one dataset, four questions, four views'
description: 'Describe a People dataset once, then ask for a list, a filter, a monthly trend, and a per-team chart. Varendo picks the view for each question.'
---

<p class="lead">Describe your data once. Then ask questions about it — “show everyone”, “how many people joined each month?” — and Varendo picks a view that fits each answer: a table, cards on a narrow screen, a line chart, or a bar chart.</p>

<aside class="doc-callout" data-tone="note"><strong>Before you start</strong><p>You need Node.js 24. This tutorial registers one resource and uses a local data service. No account, backend, API key, or AI model is involved.</p></aside>

Choose this setup when the same data needs several views selected from typed
requests. For a complete read-only array already owned by React, start with
the [local surface API](/guides/local-data/). If your screen already chooses its
views and owns its interaction state, use [standalone components](/start/standalone-components/).

<varendo-release-status></varendo-release-status>

## 1. Create a React app

```bash
npm create vite@latest people -- --template react-ts
cd people
```

This creates a `people` project and moves you into it.

## 2. Install Varendo

Keep every Varendo package on the same exact version:

```bash
npm install --save-exact @varendo/core@0.2.0 @varendo/runtime@0.2.0 @varendo/web@0.2.0 @varendo/react@0.2.0 zod@4.5.4
```

You should see: all four Varendo packages at `0.2.0` in `package.json`.

## 3. Describe your data

Create `src/people.ts`. This file answers three questions, once:

- **What is a row?** A person with a stable `id`, a `name`, a `team`, and the date they `joined`.
- **What can be measured?** `hires` counts people. Because `joined` is a time field, hires can be grouped by month.
- **Who may read it?** Your app decides. This example has one local user who may read every row.

```ts
import { defineResource } from '@varendo/core';
import { createLocalDataService } from '@varendo/runtime/data';
import { createVarendoApp } from '@varendo/web/app';
import { z } from 'zod';

const rows = [
  { id: 'ada', name: 'Ada Chen', team: 'Design', joined: '2026-01-12' },
  { id: 'sam', name: 'Sam Rivera', team: 'Engineering', joined: '2026-02-03' },
  { id: 'jo', name: 'Jo Patel', team: 'Engineering', joined: '2026-02-24' },
  { id: 'kim', name: 'Kim Osei', team: 'Product', joined: '2026-03-15' },
  { id: 'max', name: 'Max Weber', team: 'Design', joined: '2026-05-06' },
];

const people = defineResource({
  id: 'people',
  revision: '1',
  label: 'People',
  identity: ['id'],
  schema: z.object({ id: z.string(), name: z.string(), team: z.string(), joined: z.iso.date() }),
  fields: {
    name: { label: 'Name' },
    team: { label: 'Team', role: 'dimension' },
    joined: { label: 'Joined', role: 'time' },
  },
  measures: { hires: { label: 'New hires', aggregate: 'count' } },
  presentation: { allowedViews: ['table', 'cards', 'trend', 'bar'] },
});

// Your app owns access. Return the same scope from the data and the app.
const access = { scopeDigest: 'people:all', policyRevision: '1' };

export function createPeopleApp() {
  const data = createLocalDataService({
    snapshot: { catalog: people.catalog, sourceRevision: '1', records: { people: rows } },
    authorize: () => ({ ok: true, value: access }),
  });
  return createVarendoApp({
    resources: [{ resource: people, data }],
    authority: {
      read: () => ({
        ok: true,
        value: {
          principalKey: 'local-user',
          ...access,
          experienceRevision: '1',
          grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
          readContext: {},
        },
      }),
    },
  });
}
```

`allowedViews` is the complete list of views Varendo may choose for this data.
It never shows a view you did not list.

## 4. Ask questions with intents

An **intent** is a small, typed request: what to show, from which resource.
It says nothing about markup. Replace `src/main.tsx` with this file:

```tsx
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Intent } from '@varendo/core';
import { VarendoProvider, VarendoRegion } from '@varendo/react/app';
import { createPeopleApp } from './people';
import './people.css';

const questions = {
  Everyone: { version: '1', id: 'everyone', kind: 'browse', resource: 'people' },
  'Engineering only': {
    version: '1',
    id: 'engineering',
    kind: 'browse',
    resource: 'people',
    filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
  },
  'Hires per month': {
    version: '1',
    id: 'hires-per-month',
    kind: 'analyze',
    resource: 'people',
    measures: [{ id: 'hires', revision: '1' }],
    time: { field: 'joined', grain: 'month' },
  },
  'Hires per team': {
    version: '1',
    id: 'hires-per-team',
    kind: 'analyze',
    resource: 'people',
    measures: [{ id: 'hires', revision: '1' }],
    dimensions: ['team'],
  },
} satisfies Record<string, Intent>;

type Question = keyof typeof questions;
const app = createPeopleApp();

function App() {
  const [question, setQuestion] = useState<Question>('Everyone');
  return (
    <VarendoProvider app={app}>
      <main>
        <h1>People</h1>
        <div className="questions" role="group" aria-label="Ask about people">
          {(Object.keys(questions) as Question[]).map((name) => (
            <button key={name} type="button" aria-pressed={name === question} onClick={() => setQuestion(name)}>
              {name}
            </button>
          ))}
        </div>
        <VarendoRegion regionId="people" resourceId="people" intent={questions[question]} />
      </main>
    </VarendoProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Then create `src/people.css` for the page layout and buttons. Varendo's views
bring their own styles and follow your system's light or dark theme.

```css
:root {
  color-scheme: light dark;
  font:
    100% / 1.5 system-ui,
    sans-serif;
}
main {
  max-width: 60rem;
  margin: auto;
  padding: clamp(1rem, 4vw, 3rem);
}
.questions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-block: 1.5rem;
}
.questions button {
  min-height: 44px;
  padding: 0.625rem 1rem;
  border: 1px solid ButtonText;
  border-radius: 0.5rem;
  font: inherit;
}
.questions button[aria-pressed='true'] {
  color: HighlightText;
  background: Highlight;
}
.questions button:focus-visible {
  outline: 3px solid Highlight;
  outline-offset: 3px;
}
```

## 5. Run it and ask

```bash
npm run dev
```

Open the URL printed by Vite, then press each button:

<div class="doc-table quickstart-results" role="region" aria-label="Questions, intents, and expected views" tabindex="0"><table><thead><tr><th scope="col">Question</th><th scope="col">Intent</th><th scope="col">What you see</th></tr></thead><tbody><tr><th scope="row">Everyone</th><td><code>browse</code></td><td>A table of five people.</td></tr><tr><th scope="row">Engineering only</th><td><code>browse</code> + <code>filter</code></td><td>Sam and Jo. Varendo evaluated the filter; it did not hide rows in the DOM.</td></tr><tr><th scope="row">Hires per month</th><td><code>analyze</code> + <code>time</code></td><td>A line chart of hires from January to May.</td></tr><tr><th scope="row">Hires per team</th><td><code>analyze</code> + <code>dimensions</code></td><td>A bar chart: Design 2, Engineering 2, Product 1.</td></tr></tbody></table></div>

In your running React app, narrow the browser window while **Everyone** is selected. The same table
becomes cards when its container is compact, and returns when it widens.

You never chose a component. Each answer came from one data definition, and
Varendo selected an allowed view that fits the result and the available space.

## What just happened

1. **Validate.** Varendo checked each intent against `people`: the resource,
   fields, filter, and `hires` measure must all exist.
2. **Evaluate.** It asked your data service for the permitted rows and computed
   the answer, such as hires grouped by month.
3. **Present.** It picked a view from `allowedViews` that suits the answer —
   a time series becomes a trend, one category per bar becomes a bar chart.

The same intent can come from your code, a button, a URL, or an AI agent. An
agent gets exactly the same checks and can never send HTML, code, or
permissions. See [Connect an agent](/agents/) when you are ready.

## If the result differs

- **A blank page:** inspect the browser console and the Vite terminal. Confirm
  `index.html` contains `<div id="root"></div>`.
- **An import fails:** check that the four Varendo packages use the exact same
  version and that `zod` is installed.
- **A status of `unsupported` or `denied` in the console:** compare the intent
  with `src/people.ts`. Field, measure, and resource names must match exactly,
  and `authorize` must return the same `access` as the app authority.
- **The view stays a table:** narrow the window further. Cards appear only when
  the container is compact.

## What to add next

- [Connect your data](/start/registered-app/): replace the local array with
  your server, per-user permissions, and a reviewed form.
- [Analytics and time](/guides/analytics/): semi-additive measures such as
  month-end headcount, periods, and time zones.
- [Render a local array](/guides/local-data/): the smallest read-only table
  when React already owns the rows and you need no questions or charts.
- [Framework setup](/start/frameworks/): the same app in Vanilla and Vue. For
  Next.js, follow [SSR and hydration](/ship/ssr/).

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/start/registered-app/"><span>Connect your data</span><small>Server data, permissions, and forms.</small><b aria-hidden="true">→</b></a><a href="/agents/quickstart/"><span>Add an agent</span><small>Let MCP or WebMCP send the same intents.</small><b aria-hidden="true">→</b></a></nav>
