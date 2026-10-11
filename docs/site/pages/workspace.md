---
id: 'workspace'
path: '/guides/workspace/'
section: 'Guides'
title: 'From one view to a complete page'
description: 'Run one component, a three-output workspace, and a registered page through the same application facade.'
---

<p class="lead">Use one mounted Region for a result view, a workspace, or an entire registered page. The host supplies the allowed goals, data, views, and layout patterns. The same <code>app.render</code> call evaluates and commits each request.</p>
<aeliqo-release-status></aeliqo-release-status>

## Try the progression

Open the [Playground](/playground/) and choose **Browse people** in the People scenario, then **Analytical workspace** and **Entire page** in Guided demos. The workspace joins a summary, a daily trend, and an employee breakdown. The page adds a registered header and navigation around that workspace. Open **Inspect** to see the task, result outputs, and presentation nodes.

| Level     | What the host registers                                     | What the Region displays                                    |
| --------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Component | A resource and its allowed views                            | One table, card collection, form, or other eligible view    |
| Workspace | A goal with several required outputs and a matching pattern | One validated tree containing summary, trend, and breakdown |
| Page      | The workspace plus structural views and a page pattern      | Header, navigation, and workspace in one validated tree     |

A Region can fill the page content area. Your application still owns the URL, authentication, navigation destinations, and effects. The example below uses synthetic attendance records and makes no model call.

## 1. Create the local project

Create an empty Vite project and install matching package versions:

```bash
mkdir attendance-ui
cd attendance-ui
npm init -y
npm pkg set type=module scripts.dev=vite
npm install --save-dev --save-exact vite@8.2.2 typescript@7.0.2
npm install --save-exact @varendo/core@0.1.0 @varendo/runtime@0.1.0 @varendo/web@0.1.0 lit@3.3.3 zod@4.5.4
mkdir src
```

The complete source entry lives in `examples/vnext/page-goal/` in the repository.

The package versions shown here must be available on npm before this installation works. The [Playground](/playground/) also runs directly from the repository while a release is being prepared.

## 2. Register the attendance goal

Create `src/goal.ts` from this complete source. It registers the attendance resource, the reviewed `attendance.present-total` measure, and `attendance.overview`. The custom request accepts exactly `{ team: 'Engineering' }`.

The compiler declares three required outputs: `summary`, `trend`, and `breakdown`. Each output groups the same authorized observations at its declared grain. Two Engineering observations produce a summary of **2 present employee-days**, daily values of **1** and **1**, and per-person values of **1** for Ada and Sam. This fixture does not calculate unique headcount or infer attendance anomalies.

<aeliqo-source data-label="src/goal.ts" data-path="examples/vnext/workspace/goal.ts"></aeliqo-source>

`overviewPattern()` binds each child to the exact result for its output ID. An unknown goal, missing required output, or incompatible result is rejected before publication. The runnable single-goal entry is also available in `examples/vnext/workspace-goal/main.ts`.

## 3. Register the complete page

Create `src/page.ts` from the source below. Its `./goal.js` import points to the file from step 2; the remaining imports are public package exports.

<aeliqo-source data-label="src/page.ts" data-path="examples/vnext/workspace/page.ts"></aeliqo-source>

The page goal reuses the three registered data outputs. Its pattern wraps the existing workspace with four stable structural nodes: `page`, `page-header`, `page-body`, and `page-sidebar`. Each structural view declares its allowed child count and accepts no result of its own. `children()` renders the validated children supplied by the framework.

The host supplies the header text, navigation links, and responsive CSS. Replace the demonstration links with destinations your application owns. Below 600 pixels, the supplied page container stacks its sidebar and workspace. This CSS changes placement while keeping the registered child tree.

## 4. Wire the same facade for all three levels

Create `src/main.ts` from this runnable entry. Change its `../workspace/page.js` import to `./page.js` for the local file layout:

<aeliqo-source data-label="src/main.ts" data-path="examples/vnext/page-goal/main.ts"></aeliqo-source>

This authority is a synthetic demo identity. Replace it with your application's current identity and permission checks before connecting private data. The selected goal never supplies grants.

Replace `index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Attendance UI</title>
    <style>
      body {
        margin: 0;
        font: 16px/1.5 system-ui;
      }
      main {
        max-width: 72rem;
        margin: auto;
        padding: 1rem;
      }
      button {
        min-height: 44px;
        font: inherit;
        margin: 0.25rem;
      }
      #workspace {
        min-width: 0;
      }
    </style>
  </head>
  <body>
    <main>
      <h1 id="pg-result-title">Attendance UI</h1>
      <button id="component">One component</button>
      <button id="overview">Workspace</button>
      <button id="page">Entire page</button>
      <p id="status" role="status">Loading</p>
      <div id="workspace"></div>
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Run `npm run dev` and open the printed address. The three buttons send different registered intents to the same mounted Region. **One component** displays two Engineering observations. **Workspace** displays the three required outputs. **Entire page** adds the registered header and sidebar around those outputs.

## 5. Keep state and recover from failures

- Resize the same result: eligible presentations reuse current results and validated state mappings. Resizing does not request new data or call a model.
- The shared page registration includes `LAYOUT_STATE_MAPPINGS` for explicit identity transfers and for archiving structural page state when returning to a workspace. Register these mappings with its patterns.
- Stable child identities keep renderer ownership predictable. Selection and other semantic values transfer only when their fields, ports, result identity, and registered mappings remain compatible. A different query does not automatically inherit a selection from old results.
- Before leaving a dirty form, `onDraftExit` lets the host offer **Save**, **Discard**, or **Stay**. Without a handler, replacement returns `needs-input`. See the [application API](/reference/app-api/).
- An unsupported pattern, failed mandatory output, cancelled request, or renderer failure keeps the previous authorized UI and canonical Region. Forced revocation clears inaccessible content.
- `renderer-ready` reports the Region renderer publication boundary. It does not promise that every asynchronous custom child has finished loading or that the browser has painted.

For the failure journey, run the repository's `workspace-goal` example: **Request anomaly** rejects an unregistered goal; **Fail breakdown update** rejects a missing mandatory output while retaining the successful overview. A save already completed by your host remains a business effect even if a later presentation fails.

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/guides/scopes/"><span>Application scopes</span><small>Bind each workspace to the current authorized scope.</small><b aria-hidden="true">→</b></a><a href="/agents/mcp/"><span>Connect an agent</span><small>Expose these registered intents through bounded MCP tools.</small><b aria-hidden="true">→</b></a></nav>
