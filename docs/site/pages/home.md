---
id: 'home'
path: '/'
section: 'Get started'
title: 'Build interfaces that adapt to the task'
description: 'Create your first adaptive view. Connect your data, register your views, and keep control of what your application can do.'
---

<section class="docs-landing-hero"><div><p class="docs-steps-label">Start here</p><p class="lead">Build your first adaptive view with five local records and four questions. Then connect your own data.</p><div class="docs-landing-actions"><a class="primary" href="/start/">Open the quickstart <span aria-hidden="true">→</span></a><a href="/playground/">Try the playground</a></div></div><dl class="docs-facts"><div><dt>01</dt><dd>Provide data</dd></div><div><dt>02</dt><dd>Request a task</dd></div><div><dt>03</dt><dd>Render an allowed view</dd></div></dl></section>

## Choose your next step

<div class="doc-paths"><a href="/start/registered-app/"><span class="doc-card-index">01 · Data</span><h3>Connect your application</h3><p>Define a resource and render requests against your own data.</p><strong>Connect your data ↗</strong></a><a href="/components/"><span class="doc-card-index">02 · Components</span><h3>Explore the catalog</h3><p>Try live examples and inspect properties, events, and accessibility.</p><strong>Browse components ↗</strong></a><a href="/agents/quickstart/"><span class="doc-card-index">03 · Agents</span><h3>Add an agent</h3><p>Expose a working surface through a bounded tool endpoint.</p><strong>Agent quickstart ↗</strong></a><a href="/guides/workspace/"><span class="doc-card-index">04 · Workspaces</span><h3>Compose your views</h3><p>Coordinate multiple results and register application layouts.</p><strong>Build a workspace ↗</strong></a></div>

## Start with one useful result

The [React quickstart](/start/) describes five local People records once, then
asks four questions about them: everyone, one team, hires per month, and hires
per team. Varendo answers with a table, a filtered table, a line chart, and a bar
chart, without any table or chart markup from you. You need Node.js 24; no
account, backend, or model key is needed.

Use [What is Varendo?](/start/what-is-aeliqo/) for the concepts, or choose an
[integration path](/start/frameworks/) for React, Vanilla, Vue, and the explicit
Next.js server-rendering setup.

## When to use Varendo

Use it for data interfaces where the same records need different presentations:
lists and details, comparisons, forms, dashboards, or workspaces controlled by
application intent. It also supplies [standalone components](/start/standalone-components/)
when your screen already owns its interaction state.

Varendo becomes useful when validation, data identity, view selection, and state
preservation are recurring application work. A fixed marketing page or a one-off
illustration usually needs authored HTML and CSS.

## What your application registers

A resource describes the data and its meaning. A data adapter reads it. Your
application supplies current authority and allowed actions. Registered views
and recipes define how approved results appear. An adaptive region is the
container where a result is mounted.

Every request passes through validation, authorization, bounded data evaluation,
and rendering. An agent submits the same kind of request as application code;
it cannot supply executable UI or grant itself access. Your server still
checks real data access and business effects.

For production integration, continue with [existing applications](/start/existing-app/)
and the [advanced guides](/advanced/).
