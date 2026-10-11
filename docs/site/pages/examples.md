---
id: 'examples'
path: '/examples/'
section: 'Examples'
title: 'Runnable examples'
description: 'Run four synthetic applications and the component, attendance, workspace, and registered-page journeys.'
---

<p class="lead">Four small apps — People, Products, Support, Knowledge — run in the playground with synthetic data. Each scenario exports a small local browsing starter with its resource, synthetic rows, and trusted host wiring.</p>
<aeliqo-release-status></aeliqo-release-status>
<h2>Run an example in the playground</h2>
<ol class="doc-steps"><li><span>1</span><div><h3>Open a scenario</h3><p>Open the <a href="/playground/">playground</a> and pick People, Products, Support, or Knowledge from the Scenario menu.</p></div></li><li><span>2</span><div><h3>Run a step</h3><p>Choose a task under Scenario steps. You should see the request, the result, and the chosen view update in the result panel — no model call.</p></div></li><li><span>3</span><div><h3>Inspect the run</h3><p>Choose <strong>Inspect</strong>. You should see the validated request, compiled task, result descriptor, view policy, and diagnostics.</p></div></li><li><span>4</span><div><h3>Shrink the region</h3><p>Resize the browser or result container. You should see an eligible compact view replace the wide one with the same data.</p></div></li></ol>
<h2>Run a starter locally</h2>
<ol class="doc-steps"><li><span>1</span><div><h3>Export the project</h3><p>With a scenario open, choose <strong>More → Export project</strong>. You should get an <code>aeliqo-&lt;scenario&gt;-example.zip</code> download.</p></div></li><li><span>2</span><div><h3>Install and start</h3><p>Unzip, then run <code>pnpm install</code> and <code>pnpm dev</code> in the extracted folder.</p></div></li><li><span>3</span><div><h3>Open the app</h3><p>Open the URL Vite prints. You should see one adaptive browse view with the scenario’s synthetic rows. The download provides the starting resource and data wiring; the Playground’s extra forms, actions, custom views, and analytics use additional registrations.</p></div></li></ol>
<p>If export is unavailable in a source checkout, each example page below lists the complete source inline. Copy it into files and run the same two commands.</p>
<h2>Pick a starter</h2>
<div class="decision-grid"><article><h3>People</h3><p>Browse and filter employees, open a detail view, chart a monthly measure. Table becomes cards on narrow containers.</p><a href="/examples/people/">Open example →</a></article><article><h3>Products</h3><p>Card browsing, detail, side-by-side comparison, and a schema-backed create form.</p><a href="/examples/products/">Open example →</a></article><article><h3>Support</h3><p>Ticket search, detail, an edit draft, and a status action with confirmation and recovery.</p><a href="/examples/support/">Open example →</a></article><article><h3>Knowledge</h3><p>Article search and reading, plus a custom request and view the app registers itself.</p><a href="/examples/knowledge/">Open example →</a></article></div>
<h2>Run the playground from source</h2>
<p>Use the pinned Node.js and pnpm versions listed in the repository. From the repository root:</p>

```bash
pnpm install --frozen-lockfile
pnpm --dir apps/site dev
```

<p>Open Vite's printed address with <code>/playground/</code>. Manual tasks work immediately. Enable WebMCP in a supported browser to let its agent use the same session.</p>

<h2>Try MCP or BYOK locally</h2>
<p><code>examples/local-agent/</code> is a standalone Vanilla/Vite app and Node host. It uses public packages and runs outside the monorepo. Follow the <a href="/agents/mcp/">MCP tutorial</a> for clone, install, startup, HTTP and stdio setup. Add optional model configuration with the <a href="/agents/byok/">BYOK tutorial</a>. Starting the example makes no model call.</p>

<h2>What each example includes</h2>

| Example | Playground journey | Downloaded starter |
| --- | --- | --- |
| People | Browse, Engineering filter, person detail, registered monthly headcount trend | Employee browse view with table/cards |
| Products | Cards, detail, comparison, create-form preview | Product browse view with table/cards |
| Support | Search, open-ticket filter, detail, edit and confirmed local action | Ticket browse view with table/cards |
| Knowledge | Search, registered article view, custom topic intent | Article-summary browse view with table/cards |

The four domains demonstrate application contracts with synthetic data. The exported starters contain no persistent backend or production authentication. Extend them with the [registered app tutorial](/start/registered-app/), [action guide](/guides/actions/), and [custom views guide](/guides/custom-views/).

<h2>Grow from one view to a page</h2>
<ol><li>Start with one result in <a href="/start/">Quickstart</a>.</li><li>Register data and actions in <a href="/start/registered-app/">Build a registered app</a>.</li><li>Join a summary, trend, and breakdown in the <a href="/guides/workspace/">workspace example</a>.</li><li>Continue the same <a href="/guides/workspace/">copyable workspace-to-page tutorial</a>: register a header, sidebar, and content layout, then run all three levels with <code>app.render</code>.</li><li>Add an agent through <a href="/agents/">the same bounded tools</a>.</li></ol>
<aside class="doc-callout" data-tone="note"><strong>Synthetic by design</strong><p>Demo data contains no customer records. Writes stay in your local session; Reset removes them.</p></aside>
<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/playground/"><span>Open playground</span><small>Run the scenarios and guided demos in one interface.</small><b aria-hidden="true">→</b></a><a href="/start/"><span>Build your own</span><small>Render a small React surface, then connect your own data.</small><b aria-hidden="true">→</b></a></nav>
