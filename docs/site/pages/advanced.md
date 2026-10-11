---
id: 'advanced'
path: '/advanced/'
section: 'Advanced'
title: 'Extend a working application'
description: 'Choose the next integration step after a resource renders successfully in a named region.'
---

Start here after [Connect your data](/start/registered-app/) produces a rendered
result. Keep one working request as a reference while adding each capability.
If a new request fails, inspect its receipt and preserve the last authorized
result while correcting the cause.

## Compose screens and preserve state

Use [workspaces](/guides/workspace/) for multiple coordinated surfaces and
host-owned layouts. Read [state ownership](/concepts/state-ownership/) before
moving a selection, focus, or a dirty draft between views. Follow
[custom views](/guides/custom-views/) when built-in presentations cannot express
the task, and [responsive behavior](/guides/responsive-behavior/) to understand
how available container space affects the choice.

## Connect production data

Define stable [resources](/guides/resources/), then replace local fixtures with
an [HTTP data adapter](/guides/http-data/). Check [permissions](/guides/permissions/)
and [scope changes](/guides/scopes/) before enabling writes. Add
[actions](/guides/actions/) through your existing business command path with
fresh authorization and explicit confirmation where required.

## Connect an agent or protocol

The [agent overview](/agents/) explains the shared request boundary.
[WebMCP](/agents/webmcp/) exposes a browser session to a compatible browser
agent; [MCP](/agents/mcp/) connects an external host. The
[model adapter guide](/agents/byok/) covers a host-owned model loop. Diagnose
expired, rejected, and interrupted requests with [agent recovery](/agents/recovery/).

## Prepare for production

Use [SSR and hydration](/ship/ssr/) for server-rendered hosts, including the
maintained Next.js fixture. The [shipping guide](/ship/) covers bounded data,
performance, lifecycle, and accessible interaction checks. Confirm the actual
[browser support](/ship/browser-support/) and [support matrix](/ship/support-matrix/)
for your environment; fixture results are not universal capacity claims.

## Look up a contract

Find entry points in the [package map](/reference/packages/), signatures in
[App API](/reference/app-api/), and outcomes in [diagnostics](/reference/diagnostics/).
Check [release notes](/ship/release-notes/) and the migration guides before an
upgrade. [Contribute](/contribute/) links to repository setup and reporting paths.
