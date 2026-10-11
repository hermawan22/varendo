---
id: 'ship'
path: '/ship/'
section: 'Releases'
title: 'Ship an Varendo application'
description: 'Check authorization, bounded data, lifecycle, rendering, and performance in the application you will deploy.'
---

## Build from one known package set

Pin all installed Varendo packages to the same exact version. Build the actual
production application and exercise its deployed data adapters and host
lifecycle with synthetic test accounts. A successful local fixture establishes
only the paths and environments it exercised.

For Varendo repository contributions, use the canonical
[contributor guide](https://github.com/hermawan22/varendo/blob/main/AGENTS.md) and
`quality/commands.json`. Package publication and the public site release are
maintainer operations; deploying your own application follows your team's
approval and rollback process.

## Check access and business effects

Verify that unknown resources, fields, and views produce explicit outcomes.
Change permissions while work is pending and confirm revoked or stale results
cannot commit. Switch scopes away and back; an old controller must not become
authoritative again. Cancel source work when its owning screen ends.

For writes, run the actual registered action path with preview, confirmation,
fresh authorization, and revision checks. A rendered form or successful model
tool call does not establish that the business operation was authorized.

## Bound data and rendering work

Set source row and byte limits, use paging for large results, and preserve
cancellation through your adapter. Measure representative slow sources and the
largest result your application supports. Include filter changes, resizing,
selection, lazy view activation, and repeated mount/dispose cycles.

Use browser performance tools to inspect your production bundles, network
requests, long tasks, memory, and layout shifts. In this repository,
`pnpm test:performance:bundles` checks package bundle budgets; it does not measure
your backend or establish a maximum supported dataset. Avoid advertising a
capacity based only on a small local fixture.

## Check the interaction people receive

Test keyboard and focus behavior through loading, empty, denied, failed, and
successful states. Confirm a failed update keeps the last authorized result.
For dirty drafts, exercise Save, Discard, and Stay before a voluntary exit.

Review narrow containers as well as whole-page breakpoints. Check 360, 768, and
1440 pixel viewports, 320 pixel reflow, enlarged text, right-to-left content,
forced colors, and reduced motion. Preserve intentional accessible data
scrolling without introducing document-wide overflow.

For server rendering, use [SSR and hydration](/ship/ssr/) to check useful initial
HTML, request isolation, existing input values, and single event listeners.
For agents, separately verify available browser APIs, tool registration, actual
invocation, and the rendered result. A simulated tool call is not native WebMCP
evidence.

## Deploy and recover

Record the application source revision, package versions, test environment,
and artifact identity that passed your checks. Deploy that artifact and check
representative authenticated routes. Retain the previous deployable artifact
and data compatibility notes so rollback is possible.

Before an upgrade, read [release notes](/ship/release-notes/), the
[0.3 to 0.4 migration guide](/ship/migration-0.3/), and the
[0.5 migration guide](/ship/migration-0.4/). Confirm your intended profile in the
[support matrix](/ship/support-matrix/) and [browser support](/ship/browser-support/).
